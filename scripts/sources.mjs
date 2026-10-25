// Keepsake photo source resolver: turns a local folder, a .zip archive, or a
// shared album link (Google Photos, Apple iCloud Shared Album, or Google Drive
// folder) into a local directory of photo files ready for cull.mjs.

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import zlib from "node:zlib";

export const PHOTO_EXTS = new Set([
  ".jpg", ".jpeg", ".png", ".heic", ".heif", ".webp", ".tif", ".tiff",
]);

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const CONTENT_TYPE_EXT = {
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/heic": ".heic",
  "image/heif": ".heif",
  "image/tiff": ".tif",
};

function sanitizeName(name, fallback = "photo") {
  const cleaned = String(name || "")
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || fallback;
}

function slugFromSource(input) {
  const kind = detectSourceKind(input);
  if (kind === "google-photos") return "google-photos-keepsake";
  if (kind === "icloud-shared") return "icloud-photos-keepsake";
  if (kind === "google-drive") return "drive-photos-keepsake";
  if (kind === "zip") {
    const base = path.basename(input, path.extname(input));
    return path.resolve(path.dirname(input), `${base}-keepsake`);
  }
  return path.resolve(`${input}-keepsake`);
}

export function detectSourceKind(input) {
  const raw = String(input || "").trim();
  if (!raw) return "unknown";
  if (/^https?:\/\//i.test(raw)) {
    let url;
    try { url = new URL(raw); } catch { return "unknown"; }
    const host = url.hostname.toLowerCase();
    if (host === "photos.app.goo.gl" || (host.endsWith("google.com") && url.pathname.startsWith("/share"))) {
      return "google-photos";
    }
    if (host.endsWith("icloud.com") && (url.pathname.includes("sharedalbum") || url.hash.length > 1)) {
      return "icloud-shared";
    }
    if (host === "drive.google.com" || host === "docs.google.com") {
      return "google-drive";
    }
    if (url.pathname.toLowerCase().endsWith(".zip")) {
      return "remote-zip";
    }
    return "url";
  }
  if (raw.toLowerCase().endsWith(".zip")) return "zip";
  return "folder";
}

// ─── Concurrency helper ─────────────────────────────────────────────────────

async function downloadPool(items, concurrency, worker, progressLabel = "downloaded") {
  const results = new Array(items.length);
  let next = 0, completed = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const idx = next++;
      results[idx] = await worker(items[idx], idx);
      completed++;
      if (completed % 10 === 0 || completed === items.length) {
        process.stdout.write(`\r  ${progressLabel} ${completed}/${items.length}`);
      }
    }
  }));
  if (items.length) process.stdout.write("\n");
  return results;
}

// ─── Pure Node.js ZIP Extractor (Central Directory + Store/Deflate) ─────────

function dosDateTimeToDate(dosTime, dosDate) {
  if (!dosDate) return null;
  const year = ((dosDate >> 9) & 0x7f) + 1980;
  const month = Math.max(1, Math.min(12, (dosDate >> 5) & 0x0f)) - 1;
  const day = Math.max(1, Math.min(31, dosDate & 0x1f));
  const hours = (dosTime >> 11) & 0x1f;
  const minutes = (dosTime >> 5) & 0x3f;
  const seconds = (dosTime & 0x1f) * 2;
  const d = new Date(year, month, day, hours, minutes, seconds);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function extractZipPhotos(zipFilePath, destDir) {
  const buf = await fs.readFile(zipFilePath);
  // Find End of Central Directory (EOCD) signature 0x06054b50 near the end of the file
  const minPos = Math.max(0, buf.length - 65557);
  let eocdPos = -1;
  for (let i = buf.length - 22; i >= minPos; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocdPos = i;
      break;
    }
  }
  if (eocdPos < 0) throw new Error(`"${path.basename(zipFilePath)}" is not a valid ZIP archive.`);

  const totalEntries = buf.readUInt16LE(eocdPos + 10);
  const cdSize = buf.readUInt32LE(eocdPos + 12);
  const cdOffset = buf.readUInt32LE(eocdPos + 16);
  if (cdOffset + cdSize > buf.length) {
    throw new Error(`ZIP central directory in "${path.basename(zipFilePath)}" is truncated.`);
  }

  await fs.mkdir(destDir, { recursive: true });
  const extracted = [];
  const usedNames = new Set();
  let ptr = cdOffset;

  for (let i = 0; i < totalEntries && ptr + 46 <= buf.length; i++) {
    const sig = buf.readUInt32LE(ptr);
    if (sig !== 0x02014b50) break;
    const method = buf.readUInt16LE(ptr + 10);
    const dosTime = buf.readUInt16LE(ptr + 12);
    const dosDate = buf.readUInt16LE(ptr + 14);
    const compSize = buf.readUInt32LE(ptr + 20);
    const uncompSize = buf.readUInt32LE(ptr + 24);
    const nameLen = buf.readUInt16LE(ptr + 28);
    const extraLen = buf.readUInt16LE(ptr + 30);
    const commentLen = buf.readUInt16LE(ptr + 32);
    const localHeaderOffset = buf.readUInt32LE(ptr + 42);
    const entryName = buf.subarray(ptr + 46, ptr + 46 + nameLen).toString("utf8");
    ptr += 46 + nameLen + extraLen + commentLen;

    const normalized = entryName.replace(/\\/g, "/");
    if (normalized.endsWith("/")) continue;
    if (normalized.startsWith("__MACOSX/") || normalized.split("/").some((p) => p.startsWith("."))) continue;
    const ext = path.extname(normalized).toLowerCase();
    if (!PHOTO_EXTS.has(ext) || uncompSize === 0) continue;

    if (localHeaderOffset + 30 > buf.length || buf.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
      continue;
    }
    const localNameLen = buf.readUInt16LE(localHeaderOffset + 26);
    const localExtraLen = buf.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
    const dataEnd = dataStart + compSize;
    if (dataEnd > buf.length) continue;

    const slice = buf.subarray(dataStart, dataEnd);
    let data;
    if (method === 0) {
      data = slice;
    } else if (method === 8) {
      data = zlib.inflateRawSync(slice);
    } else {
      continue;
    }

    let baseName = sanitizeName(path.basename(normalized), `photo-${i + 1}${ext}`);
    if (usedNames.has(baseName.toLowerCase())) {
      const stem = path.basename(baseName, ext);
      baseName = `${stem}-${i + 1}${ext}`;
    }
    usedNames.add(baseName.toLowerCase());
    const outPath = path.join(destDir, baseName);
    await fs.writeFile(outPath, data);
    const mtime = dosDateTimeToDate(dosTime, dosDate);
    if (mtime) {
      try { await fs.utimes(outPath, mtime, mtime); } catch {}
    }
    extracted.push(outPath);
  }

  if (!extracted.length) {
    throw new Error(`No supported photos found inside "${path.basename(zipFilePath)}".`);
  }
  return extracted;
}

// ─── Google Drive Shared Folder ─────────────────────────────────────────────

export function parseGoogleDriveFolderId(urlOrId) {
  const raw = String(urlOrId || "").trim();
  const folderMatch = raw.match(/\/folders\/([A-Za-z0-9_-]{10,})/);
  if (folderMatch) return folderMatch[1];
  try {
    const u = new URL(raw);
    const idParam = u.searchParams.get("id");
    if (idParam && /^[A-Za-z0-9_-]{10,}$/.test(idParam)) return idParam;
  } catch {}
  return null;
}

export function parseGoogleDriveEmbeddedListHtml(html) {
  const entries = [];
  const seen = new Set();
  const re = /id="entry-([A-Za-z0-9_-]+)"[\s\S]*?<div class="flip-entry-title">([^<]+)<\/div>/g;
  for (const match of String(html || "").matchAll(re)) {
    const id = match[1];
    const title = match[2]
      .replace(/&#39;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, "&")
      .trim();
    if (!id || seen.has(id)) continue;
    const ext = path.extname(title).toLowerCase();
    if (ext && !PHOTO_EXTS.has(ext)) continue;
    seen.add(id);
    entries.push({ id, name: sanitizeName(title, `${id}.jpg`) });
  }
  return entries;
}

async function fetchGoogleDriveFolder(url, destDir, fetchImpl = fetch) {
  const folderId = parseGoogleDriveFolderId(url);
  if (!folderId) throw new Error(`Could not find a Google Drive folder ID in "${url}".`);
  const listUrl = `https://drive.google.com/embeddedfolderview?id=${encodeURIComponent(folderId)}#list`;
  const resp = await fetchImpl(listUrl, { headers: { "User-Agent": USER_AGENT } });
  if (!resp.ok) {
    throw new Error(`Google Drive folder request failed (${resp.status}). Make sure the folder is shared as "Anyone with the link".`);
  }
  const html = await resp.text();
  const entries = parseGoogleDriveEmbeddedListHtml(html);
  if (!entries.length) {
    throw new Error(
      `No photos found in Google Drive folder "${folderId}". Make sure the folder contains photos and is shared as "Anyone with the link can view".`
    );
  }

  await fs.mkdir(destDir, { recursive: true });
  console.log(`Downloading ${entries.length} photos from Google Drive folder...`);

  const files = await downloadPool(entries, 6, async (entry, idx) => {
    const ext = path.extname(entry.name).toLowerCase() || ".jpg";
    const fileName = path.extname(entry.name) ? entry.name : `${entry.name}${ext}`;
    const outPath = path.join(destDir, fileName);
    if (existsSync(outPath)) {
      const st = await fs.stat(outPath);
      if (st.size > 1024) return outPath;
    }
    const dlUrl = `https://drive.usercontent.google.com/download?id=${encodeURIComponent(entry.id)}&export=download`;
    const r = await fetchImpl(dlUrl, { headers: { "User-Agent": USER_AGENT } });
    if (!r.ok) throw new Error(`Failed to download "${entry.name}" (${r.status}).`);
    const buf = Buffer.from(await r.arrayBuffer());
    await fs.writeFile(outPath, buf);
    return outPath;
  });

  return files.filter(Boolean);
}

// ─── Google Photos Shared Album ─────────────────────────────────────────────

function readJsonArray(text, start) {
  let depth = 0, inString = false, escaped = false;
  if (text[start] !== "[") throw new Error("Missing JSON array.");
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === "[") depth++;
    else if (c === "]" && --depth === 0) {
      try { return { data: JSON.parse(text.slice(start, i + 1)), end: i + 1 }; }
      catch { throw new Error("Invalid JSON array in album response."); }
    }
  }
  throw new Error("Truncated JSON array.");
}

// snAcKc uses the same tuple in bootstrap and continuation responses:
// [unused, media records, continuation, album metadata]. Count includes videos.
function parseGooglePhotosPage(data) {
  if (!Array.isArray(data) || data.length < 3 ||
      !(Array.isArray(data[1]) || data[1] === null) ||
      !(data[2] === null || typeof data[2] === "string")) {
    throw new Error("Unrecognized album page or missing continuation/completion marker.");
  }
  const metadata = data[3];
  const count = metadata?.[21];
  if (count != null && (!Number.isSafeInteger(count) || count < 0)) {
    throw new Error("Unrecognized expected album item count.");
  }
  const items = (data[1] || []).map((row, idx) => {
    const media = row?.[1];
    if (!Array.isArray(row) || typeof row[0] !== "string" || !row[0] ||
        !Array.isArray(media) || typeof media[0] !== "string" ||
        !/^https:\/\/lh[3-6]\.googleusercontent\.com\//.test(media[0]) ||
        !Number.isFinite(media[1]) || media[1] <= 0 ||
        !Number.isFinite(media[2]) || media[2] <= 0) {
      throw new Error(`Unrecognized media record #${idx + 1}; refusing to skip an unknown item.`);
    }
    return {
      remoteId: row[0],
      baseUrl: media[0].replace(/=[^/]*$/, ""),
      width: media[1],
      height: media[2],
      timestampMs: Number.isFinite(row[2]) && Number.isFinite(new Date(row[2]).getTime()) ? row[2] : null,
      isVideo: row.some((part) => part && !Array.isArray(part) && Array.isArray(part["76647426"])),
    };
  });
  return {
    items,
    nextPageToken: data[2] || null,
    expectedItems: count ?? null,
    albumId: typeof metadata?.[0] === "string" ? metadata[0] : null,
    authKey: typeof metadata?.[19] === "string" ? metadata[19] : null,
  };
}

export function parseGooglePhotosSharedPage(html) {
  const text = String(html || "");
  const callbacks = /AF_initDataCallback\(\s*\{[^<]*?\bdata\s*:\s*/g;
  for (const match of text.matchAll(callbacks)) {
    const { data } = readJsonArray(text, match.index + match[0].length);
    if (Array.isArray(data[1]) || (data[1] === null && Array.isArray(data[3]))) {
      return parseGooglePhotosPage(data);
    }
  }
  throw new Error("Could not find structured Google Photos album data. Use an already-public shared album link or export the album as a ZIP.");
}

export function parseGooglePhotosSharedHtml(html) {
  const seen = new Set();
  return parseGooglePhotosSharedPage(html).items.filter((item) => {
    if (item.isVideo || seen.has(item.remoteId)) return false;
    seen.add(item.remoteId);
    return true;
  });
}

export function parseGooglePhotosBatchResponse(body) {
  const text = String(body || "").replace(/^\s*\)\]\}'/, "");
  const payloads = [];
  let pos = 0;
  while (pos < text.length) {
    // batchexecute includes XSSI protection and decimal length lines between JSON frames.
    const prefix = text.slice(pos).match(/^\s*(?:\d+\s+)?/)[0];
    pos += prefix.length;
    if (pos === text.length) break;
    const { data, end } = readJsonArray(text, pos);
    for (const row of data) {
      if (Array.isArray(row) && row[0] === "wrb.fr" && row[1] === "snAcKc") {
        if (typeof row[2] !== "string") throw new Error("Album continuation was rejected by Google Photos.");
        try { payloads.push(JSON.parse(row[2])); }
        catch { throw new Error("Invalid JSON payload in album continuation."); }
      }
    }
    pos = end;
  }
  if (payloads.length !== 1) throw new Error("Missing or ambiguous snAcKc album continuation response.");
  return parseGooglePhotosPage(payloads[0]);
}

function googlePhotosRequestContext(html, finalUrl, page) {
  const url = new URL(finalUrl);
  if (url.hostname !== "photos.google.com" || !/^\/share\/[^/]+\/?$/.test(url.pathname)) {
    throw new Error("The shared link did not resolve to a public photos.google.com/share/ album.");
  }
  const globalData = html.match(/(?:window\.)?WIZ_global_data\s*=\s*(\{[^\n]*?\});/);
  let wiz = {};
  try { if (globalData) wiz = JSON.parse(globalData[1]); }
  catch { throw new Error("Invalid public-page request context."); }
  if (typeof wiz.FdrFJe !== "string" || typeof wiz.cfb2h !== "string") {
    throw new Error("Missing public-page request context required to continue the album.");
  }
  return {
    albumId: page.albumId || url.pathname.split("/")[2],
    authKey: page.authKey || url.searchParams.get("key"),
    sourcePath: url.pathname,
    sessionId: wiz.FdrFJe,
    build: wiz.cfb2h,
  };
}

async function fetchGooglePhotosPage(context, token, fetchImpl) {
  const endpoint = new URL("https://photos.google.com/_/PhotosUi/data/batchexecute");
  endpoint.search = new URLSearchParams({
    rpcids: "snAcKc", "source-path": context.sourcePath,
    "f.sid": context.sessionId, bl: context.build, hl: "en-US", rt: "c",
  }).toString();
  const body = new URLSearchParams({
    "f.req": JSON.stringify([[["snAcKc", JSON.stringify([
      context.albumId, token, null, context.authKey,
    ]), null, "generic"]]]),
  });
  let resp;
  try {
    resp = await fetchImpl(endpoint.toString(), {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        "User-Agent": USER_AGENT, "X-Same-Domain": "1",
      },
      body: body.toString(),
      signal: AbortSignal.timeout(60000),
    });
  } catch {
    throw new Error("Continuation request failed (network error or timeout).");
  }
  if (!resp.ok) throw new Error(`Continuation request returned HTTP ${resp.status}.`);
  let text;
  try { text = await resp.text(); }
  catch { throw new Error("Continuation response could not be read completely."); }
  return parseGooglePhotosBatchResponse(text);
}

function supportedImageBytes(buf, type) {
  if (type === "image/jpeg" || type === "image/jpg") return buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  if (type === "image/png") return buf.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (type === "image/webp") return buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP";
  if (type === "image/tiff") return ["49492a00", "4d4d002a"].includes(buf.subarray(0, 4).toString("hex"));
  if (type === "image/heic" || type === "image/heif") return buf.toString("ascii", 4, 8) === "ftyp";
  return false;
}

async function downloadGooglePhoto(item, index, stagingDir, fetchImpl) {
  const attempts = [];
  let downloaded;
  for (const [suffix, quality] of [["=d", "download-endpoint"], ["=w4096-h4096", "fallback-4096"]]) {
    try {
      const response = await fetchImpl(`${item.baseUrl}${suffix}`, {
        headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(120000),
      });
      const type = (response.headers?.get("content-type") || "").split(";")[0].trim().toLowerCase();
      if (!response.ok || !CONTENT_TYPE_EXT[type]) {
        attempts.push(`${quality}: HTTP ${response.status}, ${CONTENT_TYPE_EXT[type] ? "image" : "unsupported/non-image response"}`);
        try { await response.body?.cancel(); } catch {}
        continue;
      }
      const buf = Buffer.from(await response.arrayBuffer());
      if (!supportedImageBytes(buf, type)) {
        attempts.push(`${quality}: empty or invalid image bytes`);
        continue;
      }
      downloaded = { buf, type, quality };
      break;
    } catch {
      attempts.push(`${quality}: network or response-read failure`);
    }
  }
  if (!downloaded) throw new Error(`Photo #${index + 1} download failed (${attempts.join("; ")}).`);
  const { buf, type, quality } = downloaded;
  const file = `gphoto-${String(index + 1).padStart(4, "0")}${CONTENT_TYPE_EXT[type]}`;
  const outPath = path.join(stagingDir, file);
  try {
    await fs.writeFile(outPath, buf, { flag: "wx" });
    if (item.timestampMs !== null) {
      const dt = new Date(item.timestampMs);
      await fs.utimes(outPath, dt, dt);
    }
  } catch {
    throw new Error(`Photo #${index + 1} could not be saved locally; check work-directory permissions and free disk space.`);
  }
  return {
    remoteId: item.remoteId, file, quality, sourceWidth: item.width, sourceHeight: item.height,
    bytes: buf.length, sha256: createHash("sha256").update(buf).digest("hex"),
    ...(quality === "fallback-4096" ? { fallbackReason: attempts.join("; ") } : {}),
  };
}

async function publishGooglePhotos(stagingDir, destDir, ownershipPath, downloads, commitReport) {
  let existing = null;
  try { existing = await fs.lstat(destDir); } catch (error) { if (error.code !== "ENOENT") throw error; }
  let previousOwnership = null, owned;
  try {
    previousOwnership = await fs.lstat(ownershipPath);
    if (previousOwnership.isFile() && !previousOwnership.isSymbolicLink()) {
      try { owned = JSON.parse(await fs.readFile(ownershipPath, "utf8")); } catch {}
    }
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  const refuseMixed = () => {
    throw new Error('The work directory already contains photos or ownership metadata not owned by this importer. Use a fresh "--work" directory to avoid mixing albums.');
  };
  if (previousOwnership && (owned?.kind !== "google-photos" || !Array.isArray(owned.files) || !owned.sha256)) refuseMixed();
  if (existing) {
    const entries = existing.isDirectory() && !existing.isSymbolicLink()
      ? await fs.readdir(destDir, { withFileTypes: true }) : null;
    if (!entries || !owned ||
        entries.length !== owned.files.length ||
        !entries.every((entry) => entry.isFile() && owned.files.includes(entry.name))) {
      refuseMixed();
    }
    for (const entry of entries) {
      const digest = createHash("sha256").update(await fs.readFile(path.join(destDir, entry.name))).digest("hex");
      if (owned.sha256[entry.name] !== digest) refuseMixed();
    }
  }
  const backup = `${stagingDir}-previous`;
  const stagedOwnership = `${stagingDir}-ownership.json`;
  const ownershipBackup = `${stagingDir}-previous-ownership.json`;
  let savedPhotos = false, savedOwnership = false, installedPhotos = false, installedOwnership = false;
  try {
    await fs.writeFile(stagedOwnership, JSON.stringify({
      kind: "google-photos", files: downloads.map((item) => item.file),
      sha256: Object.fromEntries(downloads.map((item) => [item.file, item.sha256])),
    }, null, 2), { flag: "wx" });
    if (previousOwnership) {
      await fs.rename(ownershipPath, ownershipBackup);
      savedOwnership = true;
    }
    if (existing) {
      await fs.rename(destDir, backup);
      savedPhotos = true;
    }
    await fs.rename(stagingDir, destDir);
    installedPhotos = true;
    await fs.rename(stagedOwnership, ownershipPath);
    installedOwnership = true;
    await commitReport();
  } catch (cause) {
    try {
      if (installedOwnership) await fs.rm(ownershipPath);
      if (installedPhotos) await fs.rename(destDir, stagingDir);
      if (savedPhotos) await fs.rename(backup, destDir);
      if (savedOwnership) await fs.rename(ownershipBackup, ownershipPath);
    } catch {
      throw new Error(`Publication rollback could not finish. Previous album backups were preserved as ${path.basename(backup)} and ${path.basename(ownershipBackup)}; preserve them and use a fresh "--work" directory.`);
    }
    throw cause;
  } finally {
    await fs.rm(stagedOwnership, { force: true });
  }
  const warnings = [];
  for (const [needed, location] of [[savedPhotos, backup], [savedOwnership, ownershipBackup]]) {
    if (!needed) continue;
    try { await fs.rm(location, { recursive: true, force: true }); }
    catch {
      warnings.push(`The completed import is ready, but a previous import backup could not be removed: ${path.basename(location)}.`);
    }
  }
  return warnings;
}

async function fetchGooglePhotosAlbum(url, destDir, fetchImpl = fetch) {
  const workDir = path.dirname(destDir);
  await fs.mkdir(workDir, { recursive: true });
  const lockPath = path.join(workDir, ".google-photos-import.lock");
  let lock;
  try { lock = await fs.open(lockPath, "wx"); }
  catch (error) {
    if (error.code !== "EEXIST") throw error;
    throw new Error('Another Google Photos import may be using this "--work" directory. Use a fresh "--work" directory, or remove .google-photos-import.lock only after confirming no import is running.');
  }
  const reportPath = path.join(workDir, "source-import.json");
  const report = {
    schemaVersion: 1, kind: "google-photos", status: "enumerating",
    expectedItems: null, discoveredItems: 0, duplicateItems: 0, pages: [],
    paginationComplete: false, completenessEvidence: null,
    photoItems: 0, skippedVideos: 0, downloadedItems: 0,
    downloadQuality: { downloadEndpoint: 0, fallback4096: 0, originalQualityVerified: false },
    downloads: [], failures: [], warnings: [],
  };
  let stagingDir, stage = "enumeration", pageNumber = 1;
  try {
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
    let resp, html;
    try {
      resp = await fetchImpl(url, {
        redirect: "follow",
        headers: { "User-Agent": USER_AGENT, "Accept-Language": "en-US,en;q=0.9" },
        signal: AbortSignal.timeout(60000),
      });
      if (resp.ok) html = await resp.text();
    } catch { throw new Error("Public album request failed (network error, timeout or unreadable response)."); }
    if (!resp.ok) throw new Error(`Public album returned HTTP ${resp.status}; check that this link is already publicly accessible.`);
    let page = parseGooglePhotosSharedPage(html);
    const context = page.nextPageToken ? googlePhotosRequestContext(html, resp.url || url, page) : null;
    const seenTokens = new Set(), items = new Map();
    while (true) {
      if (page.expectedItems !== null) {
        if (report.expectedItems !== null && page.expectedItems !== report.expectedItems) {
          throw new Error("Album expected item count changed during pagination; retry after album edits finish.");
        }
        report.expectedItems = page.expectedItems;
      }
      if (context && page.albumId && page.albumId !== context.albumId) {
        throw new Error("Continuation returned a different album.");
      }
      let duplicates = 0;
      for (const item of page.items) {
        if (items.has(item.remoteId)) {
          if (items.get(item.remoteId).isVideo !== item.isVideo) {
            throw new Error("A remote item changed media type during pagination; retry after album edits finish.");
          }
          duplicates++;
        }
        else items.set(item.remoteId, item);
      }
      report.discoveredItems = items.size;
      report.duplicateItems += duplicates;
      report.pages.push({
        page: pageNumber, items: page.items.length, uniqueItems: page.items.length - duplicates,
        duplicateItems: duplicates, hasContinuation: Boolean(page.nextPageToken),
      });
      report.skippedVideos = [...items.values()].filter((item) => item.isVideo).length;
      report.photoItems = items.size - report.skippedVideos;
      if (report.expectedItems !== null && items.size > report.expectedItems) {
        throw new Error(`Album count mismatch: expected ${report.expectedItems} items but discovered ${items.size} unique IDs.`);
      }
      if (!page.nextPageToken) break;
      if (!page.items.length) throw new Error("Empty album page still advertises a continuation; completeness cannot be established.");
      if (seenTokens.has(page.nextPageToken)) throw new Error("Repeated album continuation token; refusing a truncated or looping import.");
      if (duplicates === page.items.length) throw new Error("Album continuation made no progress (only duplicate IDs); completeness cannot be established.");
      seenTokens.add(page.nextPageToken);
      await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
      pageNumber++;
      page = await fetchGooglePhotosPage(context, page.nextPageToken, fetchImpl);
    }
    if (report.expectedItems !== null && items.size !== report.expectedItems) {
      throw new Error(`Album count mismatch: expected ${report.expectedItems} items but discovered ${items.size} unique IDs at the terminal page.`);
    }
    report.paginationComplete = true;
    report.completenessEvidence = report.expectedItems === null
      ? "terminal-page; expected count unavailable" : "expected-count-and-terminal-page";
    const photos = [...items.values()].filter((item) => !item.isVideo);
    if (!photos.length) throw new Error(`No supported still photos found (${report.skippedVideos} video items skipped).`);
    stage = "download";
    report.status = "downloading";
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
    stagingDir = await fs.mkdtemp(path.join(workDir, ".google-photos-import-"));
    console.log(`Downloading ${photos.length} photos from ${report.pages.length} Google Photos album page(s); ${report.skippedVideos} videos skipped...`);
    const results = await downloadPool(photos, 6, async (item, idx) => {
      try { return await downloadGooglePhoto(item, idx, stagingDir, fetchImpl); }
      catch (error) {
        report.failures.push({ stage, item: idx + 1, message: error.message });
        return null;
      }
    }, "processed");
    report.downloads = results.filter(Boolean);
    report.downloadedItems = report.downloads.length;
    report.downloadQuality.downloadEndpoint = report.downloads.filter((item) => item.quality === "download-endpoint").length;
    report.downloadQuality.fallback4096 = report.downloads.filter((item) => item.quality === "fallback-4096").length;
    if (report.failures.length) throw new Error(`${report.failures.length} photo download(s) failed; ${report.downloadedItems}/${report.photoItems} downloaded. No partial album was published.`);
    stage = "publish";
    report.warnings = await publishGooglePhotos(stagingDir, destDir, path.join(workDir, ".google-photos-ownership.json"),
      report.downloads, async () => {
        report.status = "complete";
        await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
      });
    stagingDir = null;
    if (report.warnings.length) {
      for (const warning of report.warnings) console.warn(warning);
      try { await fs.writeFile(reportPath, JSON.stringify(report, null, 2)); }
      catch { console.warn("Could not add backup-cleanup warnings to the completed source-import.json report."); }
    }
    return { report, reportPath };
  } catch (cause) {
    report.status = "failed";
    report.failures.push({ stage, ...(stage === "enumeration" ? { page: pageNumber } : {}), message: cause.message });
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
    const error = new Error(`Google Photos import incomplete: ${cause.message} Retry with the public shared link or export the album from Google Photos as a ZIP. See source-import.json for counts and failures.`);
    error.importReport = report;
    error.importReportPath = reportPath;
    throw error;
  } finally {
    try {
      if (stagingDir) await fs.rm(stagingDir, { recursive: true, force: true });
    } finally {
      try { await lock.close(); }
      finally { await fs.rm(lockPath, { force: true }); }
    }
  }
}

// ─── Apple Photos / iCloud Shared Album ─────────────────────────────────────

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

export function parseIcloudSharedAlbumToken(url) {
  const raw = String(url || "").trim();
  const hashMatch = raw.match(/#([A-Za-z0-9]+)$/);
  if (hashMatch) return hashMatch[1];
  const pathMatch = raw.match(/\/sharedalbum\/#?([A-Za-z0-9]+)/i);
  return pathMatch ? pathMatch[1] : null;
}

export function icloudPartitionHost(token) {
  const first = BASE62.indexOf(token[0]);
  const serverPartition = token[0] === "A"
    ? BASE62.indexOf(token[1])
    : first * 62 + BASE62.indexOf(token[1]);
  const part = Number.isFinite(serverPartition) && serverPartition >= 1 && serverPartition <= 99
    ? String(serverPartition).padStart(2, "0")
    : "01";
  return `p${part}-sharedstreams.icloud.com`;
}

export function selectIcloudPhotoAssets(webstream, webasseturls) {
  const photos = Array.isArray(webstream?.photos) ? webstream.photos : [];
  const items = webasseturls?.items || {};
  const selected = [];

  for (const photo of photos) {
    if (photo.mediaAssetType && String(photo.mediaAssetType).toLowerCase().includes("video")) continue;
    const derivatives = Object.values(photo.derivatives || {}).filter((d) => d && d.checksum);
    if (!derivatives.length) continue;
    derivatives.sort((a, b) => {
      const areaA = (Number(a.width) || 0) * (Number(a.height) || 0);
      const areaB = (Number(b.width) || 0) * (Number(b.height) || 0);
      return (areaB - areaA) || ((Number(b.fileSize) || 0) - (Number(a.fileSize) || 0));
    });
    const best = derivatives.find((d) => items[d.checksum]) || derivatives[0];
    const asset = items[best.checksum];
    if (!asset?.url_location || !asset?.url_path) continue;
    selected.push({
      photoGuid: photo.photoGuid,
      checksum: best.checksum,
      url: `https://${asset.url_location}${asset.url_path}`,
      dateCreated: photo.dateCreated || photo.batchDateCreated || null,
    });
  }
  return selected;
}

async function postIcloudJson(host, token, endpoint, body, fetchImpl) {
  const url = `https://${host}/${encodeURIComponent(token)}/sharedstreams/${endpoint}`;
  const resp = await fetchImpl(url, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "User-Agent": USER_AGENT,
    },
    body: JSON.stringify(body),
  });
  if (resp.status === 330) {
    const redirectedHost = resp.headers?.get("X-Apple-MMe-Host") || resp.headers?.get("x-apple-mme-host");
    if (redirectedHost) {
      return postIcloudJson(redirectedHost, token, endpoint, body, fetchImpl);
    }
  }
  if (!resp.ok) {
    throw new Error(`iCloud Shared Album ${endpoint} returned HTTP ${resp.status}. Make sure "Public Website" is enabled in the Shared Album settings.`);
  }
  const data = await resp.json();
  if (data?.["X-Apple-MMe-Host"]) {
    return postIcloudJson(data["X-Apple-MMe-Host"], token, endpoint, body, fetchImpl);
  }
  return { host, data };
}

async function fetchIcloudSharedAlbum(url, destDir, fetchImpl = fetch) {
  const token = parseIcloudSharedAlbumToken(url);
  if (!token) {
    throw new Error(`Could not find an iCloud Shared Album token in "${url}". Expected a link like https://www.icloud.com/sharedalbum/#B0z...`);
  }
  const initialHost = icloudPartitionHost(token);
  const { host, data: webstream } = await postIcloudJson(initialHost, token, "webstream", { streamCtag: null }, fetchImpl);
  const guids = (webstream.photos || [])
    .filter((p) => !p.mediaAssetType || !String(p.mediaAssetType).toLowerCase().includes("video"))
    .map((p) => p.photoGuid)
    .filter(Boolean);
  if (!guids.length) {
    throw new Error("No photos found in this iCloud Shared Album.");
  }
  const { data: webasseturls } = await postIcloudJson(host, token, "webasseturls", { photoGuids: guids }, fetchImpl);
  const assets = selectIcloudPhotoAssets(webstream, webasseturls);
  if (!assets.length) {
    throw new Error("Could not resolve photo download URLs from this iCloud Shared Album.");
  }

  await fs.mkdir(destDir, { recursive: true });
  console.log(`Downloading ${assets.length} photos from Apple iCloud Shared Album...`);

  const files = await downloadPool(assets, 6, async (asset, idx) => {
    const num = String(idx + 1).padStart(4, "0");
    const r = await fetchImpl(asset.url, { headers: { "User-Agent": USER_AGENT } });
    if (!r.ok) throw new Error(`Failed to download iCloud photo #${idx + 1} (${r.status}).`);
    const ctype = (r.headers?.get("content-type") || "").split(";")[0].trim().toLowerCase();
    const ext = CONTENT_TYPE_EXT[ctype] || ".jpg";
    const outPath = path.join(destDir, `icloud-${num}${ext}`);
    const buf = Buffer.from(await r.arrayBuffer());
    await fs.writeFile(outPath, buf);
    if (asset.dateCreated) {
      const dt = new Date(asset.dateCreated);
      if (!Number.isNaN(dt.getTime())) {
        try { await fs.utimes(outPath, dt, dt); } catch {}
      }
    }
    return outPath;
  });

  return files.filter(Boolean);
}

// ─── Unified Entry Point ────────────────────────────────────────────────────

export async function resolvePhotoSource(sourceInput, { workDir: explicitWorkDir = null, fetchImpl = fetch } = {}) {
  const kind = detectSourceKind(sourceInput);
  const workDir = path.resolve(explicitWorkDir || slugFromSource(sourceInput));

  if (kind === "folder") {
    const srcDir = path.resolve(sourceInput);
    return { kind, srcDir, workDir, sourceLabel: srcDir };
  }

  const destDir = path.join(workDir, "photos");

  if (kind === "zip") {
    const zipPath = path.resolve(sourceInput);
    console.log(`Extracting photos from ${path.basename(zipPath)}...`);
    await extractZipPhotos(zipPath, destDir);
    return { kind, srcDir: destDir, workDir, sourceLabel: zipPath };
  }

  if (kind === "google-drive") {
    await fetchGoogleDriveFolder(sourceInput, destDir, fetchImpl);
    return { kind, srcDir: destDir, workDir, sourceLabel: sourceInput };
  }

  if (kind === "google-photos") {
    const { report: importReport, reportPath: importReportPath } = await fetchGooglePhotosAlbum(sourceInput, destDir, fetchImpl);
    return { kind, srcDir: destDir, workDir, sourceLabel: sourceInput, importReport, importReportPath };
  }

  if (kind === "icloud-shared") {
    await fetchIcloudSharedAlbum(sourceInput, destDir, fetchImpl);
    return { kind, srcDir: destDir, workDir, sourceLabel: sourceInput };
  }

  if (kind === "remote-zip") {
    await fs.mkdir(workDir, { recursive: true });
    const tmpZip = path.join(workDir, "downloaded-photos.zip");
    const r = await fetchImpl(sourceInput, { headers: { "User-Agent": USER_AGENT } });
    if (!r.ok) throw new Error(`Failed to download ZIP from "${sourceInput}" (${r.status}).`);
    await fs.writeFile(tmpZip, Buffer.from(await r.arrayBuffer()));
    await extractZipPhotos(tmpZip, destDir);
    return { kind, srcDir: destDir, workDir, sourceLabel: sourceInput };
  }

  throw new Error(
    `Unsupported photo source "${sourceInput}". Pass a local photo folder, a .zip archive, a Google Photos shared album link, an Apple iCloud Shared Album link, or a Google Drive shared folder link.`
  );
}
