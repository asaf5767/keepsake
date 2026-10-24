// Keepsake photo source resolver: turns a local folder, a .zip archive, or a
// shared album link (Google Photos, Apple iCloud Shared Album, or Google Drive
// folder) into a local directory of photo files ready for cull.mjs.

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
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

async function downloadPool(items, concurrency, worker) {
  const results = new Array(items.length);
  let next = 0, completed = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const idx = next++;
      results[idx] = await worker(items[idx], idx);
      completed++;
      if (completed % 10 === 0 || completed === items.length) {
        process.stdout.write(`\r  downloaded ${completed}/${items.length}`);
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

// Walk nested AF_initDataCallback arrays to extract Google Photos image items:
// Each photo item typically contains a base URL ("https://lh3.googleusercontent.com/pw/...")
// along with [url, width, height, ...] and a parent record carrying creation timestamp in ms.
export function parseGooglePhotosSharedHtml(html) {
  const items = [];
  const seenUrls = new Set();

  function walk(node, parent) {
    if (!Array.isArray(node)) return;
    if (
      typeof node[0] === "string" &&
      /^https:\/\/lh3\.googleusercontent\.com\/(pw\/|[A-Za-z0-9_-]{24,})/.test(node[0]) &&
      typeof node[1] === "number" &&
      typeof node[2] === "number" &&
      node[1] >= 200 &&
      node[2] >= 200
    ) {
      const baseUrl = node[0].replace(/=[^/]*$/, "");
      if (!seenUrls.has(baseUrl)) {
        seenUrls.add(baseUrl);
        let timestampMs = null;
        if (Array.isArray(parent)) {
          const tsCandidate = parent.find(
            (v) => typeof v === "number" && v >= 946684800000 && v <= 4102444800000
          );
          if (tsCandidate) timestampMs = tsCandidate;
        }
        items.push({
          baseUrl,
          width: node[1],
          height: node[2],
          timestampMs,
        });
      }
      return;
    }
    for (const child of node) {
      if (Array.isArray(child)) walk(child, node);
    }
  }

  const blockRe = /AF_initDataCallback\(\s*\{[\s\S]*?data\s*:\s*(\[[\s\S]*?\])\s*(?:,\s*sideChannel\s*:[\s\S]*?)?\}\s*\)\s*;/g;
  for (const match of String(html || "").matchAll(blockRe)) {
    try {
      const parsed = JSON.parse(match[1]);
      walk(parsed, null);
    } catch {}
  }

  // Fallback regex if Google changes wrapper formatting around lh3.googleusercontent.com/pw/ URLs
  if (!items.length) {
    const urlRe = /"(https:\/\/lh3\.googleusercontent\.com\/pw\/[A-Za-z0-9_-]+)"\s*,\s*(\d{3,5})\s*,\s*(\d{3,5})/g;
    for (const m of String(html || "").matchAll(urlRe)) {
      const baseUrl = m[1];
      if (seenUrls.has(baseUrl)) continue;
      seenUrls.add(baseUrl);
      items.push({
        baseUrl,
        width: Number(m[2]),
        height: Number(m[3]),
        timestampMs: null,
      });
    }
  }

  return items;
}

async function fetchGooglePhotosAlbum(url, destDir, fetchImpl = fetch) {
  const resp = await fetchImpl(url, {
    redirect: "follow",
    headers: {
      "User-Agent": USER_AGENT,
      "Accept-Language": "en-US,en;q=0.9",
    },
  });
  if (!resp.ok) {
    throw new Error(`Google Photos album link returned HTTP ${resp.status}. Make sure link sharing is enabled.`);
  }
  const html = await resp.text();
  const items = parseGooglePhotosSharedHtml(html);
  if (!items.length) {
    throw new Error(
      "Could not find photos in this Google Photos link. In Google Photos, open the album → Share → Create link, and paste that link."
    );
  }

  await fs.mkdir(destDir, { recursive: true });
  console.log(`Downloading ${items.length} photos from Google Photos shared album...`);

  const files = await downloadPool(items, 6, async (item, idx) => {
    const num = String(idx + 1).padStart(4, "0");
    // Try `=d` first (original file with EXIF intact), then fall back to `=w4096-h4096`
    let imgResp = await fetchImpl(`${item.baseUrl}=d`, { headers: { "User-Agent": USER_AGENT } });
    let ctype = (imgResp.headers?.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (!imgResp.ok || !ctype.startsWith("image/")) {
      imgResp = await fetchImpl(`${item.baseUrl}=w4096-h4096`, { headers: { "User-Agent": USER_AGENT } });
      ctype = (imgResp.headers?.get("content-type") || "").split(";")[0].trim().toLowerCase();
    }
    if (!imgResp.ok) throw new Error(`Failed to download Google Photos item #${idx + 1} (${imgResp.status}).`);
    const ext = CONTENT_TYPE_EXT[ctype] || ".jpg";
    const outPath = path.join(destDir, `gphoto-${num}${ext}`);
    const buf = Buffer.from(await imgResp.arrayBuffer());
    await fs.writeFile(outPath, buf);
    if (item.timestampMs) {
      const dt = new Date(item.timestampMs);
      try { await fs.utimes(outPath, dt, dt); } catch {}
    }
    return outPath;
  });

  return files.filter(Boolean);
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
    await fetchGooglePhotosAlbum(sourceInput, destDir, fetchImpl);
    return { kind, srcDir: destDir, workDir, sourceLabel: sourceInput };
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
