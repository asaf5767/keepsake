#!/usr/bin/env node
// Keepsake step 1: clean out a folder of photos. Drops blurry, badly exposed,
// tiny, screenshot/document and duplicate shots; reads date, place (offline) and
// "the owner cared" signals (ratings, edited copies); writes cull.json and
// contact sheets of the rejects so they can be rescued.
//
// node cull.mjs <photo-folder> [--work <dir>] [--recursive] [--strict] [--no-ai]
//   --work defaults to "<photo-folder>-keepsake" next to the photo folder.

import fs from "fs/promises";
import path from "path";
import sharp from "sharp";
import ExifReader from "exifreader";
import { findPlace } from "./places.mjs";
import { embed, classify, pack } from "./vision.mjs";
import { loadTaste, tasteMatch } from "./taste.mjs";

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const SOURCE = args.find((a, i) => !a.startsWith("--") && !["--work"].includes(args[i - 1]));
if (!SOURCE) {
  console.error("usage: node cull.mjs <photo-folder> [--work <dir>] [--recursive] [--strict] [--no-ai]");
  process.exit(1);
}
const SRC = path.resolve(SOURCE);
const WORK = path.resolve(opt("--work", SRC + "-keepsake"));
const STRICT = flag("--strict");

const EXTS = new Set([".jpg", ".jpeg", ".png", ".heic", ".heif", ".webp", ".tif", ".tiff"]);
const T = {
  blurAbs: STRICT ? 60 : 35,          // Laplacian variance of the sharpest tile, 512px raster
  blurRel: STRICT ? 0.2 : 0.12,       // ...or this fraction of the folder median
  dupHamming: STRICT ? 14 : 12,       // dHash bits for burst duplicates
  dupSeconds: STRICT ? 180 : 90,
  exactHamming: 3,                    // same picture saved twice, any time
  minLongSide: 800,
  lowresLongSide: 2000,
};

// ─── helpers ────────────────────────────────────────────────────────────────

async function scan(dir) {
  const out = [];
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory() && flag("--recursive") && path.resolve(p) !== WORK) out.push(...(await scan(p)));
    else if (e.isFile() && EXTS.has(path.extname(e.name).toLowerCase())) out.push(p);
  }
  return out;
}

async function pool(items, n, fn) {
  const res = new Array(items.length);
  let i = 0, done = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) {
      const k = i++;
      res[k] = await fn(items[k], k);
      if (++done % 25 === 0 || done === items.length) process.stdout.write(`\r  analyzed ${done}/${items.length}`);
    }
  }));
  process.stdout.write("\n");
  return res;
}

const hamming = (a, b) => { let x = a ^ b, c = 0; while (x) { x &= x - 1n; c++; } return c; };
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const hex = (bytes) => Buffer.from(bytes.map((v) => Math.max(0, Math.min(255, Math.round(v))))).toString("hex");

function lab(r, g, b) {
  const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const R = lin(r), G = lin(g), B = lin(b);
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const x = f((0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047), y = f(0.2126 * R + 0.7152 * G + 0.0722 * B), z = f((0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

async function decodable(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext !== ".heic" && ext !== ".heif") return file;
  try { await sharp(file).resize(8).toBuffer(); return file; } catch {}
  const cache = path.join(WORK, "heic-cache", path.basename(file) + ".jpg");
  try { await fs.access(cache); return cache; } catch {}
  const convert = (await import("heic-convert")).default;
  const out = await convert({ buffer: await fs.readFile(file), format: "JPEG", quality: 0.95 });
  await fs.mkdir(path.dirname(cache), { recursive: true });
  await fs.writeFile(cache, Buffer.from(out));
  return cache;
}

function exifDate(tags) {
  const raw = tags.exif?.DateTimeOriginal?.description || tags.exif?.DateTimeDigitized?.description || tags.exif?.DateTime?.description;
  const m = raw && raw.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  return m && m[1] !== "0000" ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}` : null;
}

async function analyze(file) {
  const rec = { file: path.relative(SRC, file), path: file, flags: [], reasons: [] };
  try {
    const buf = await fs.readFile(file);
    let tags = {};
    try { tags = ExifReader.load(buf, { expanded: true }); } catch {}
    const st = await fs.stat(file);
    rec.date = exifDate(tags);
    rec.dateSource = rec.date ? "exif" : "file";
    if (!rec.date) rec.date = new Date(st.mtimeMs - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 19);
    if (tags.gps?.Latitude !== undefined && tags.gps?.Longitude !== undefined) rec.gps = { lat: tags.gps.Latitude, lng: tags.gps.Longitude };
    if (rec.gps && rec.gps.lat === 0 && rec.gps.lng === 0) delete rec.gps;
    rec.camera = [tags.exif?.Make?.description, tags.exif?.Model?.description].filter(Boolean).join(" ") || null;
    const software = (tags.exif?.Software?.description || "").toLowerCase();

    // Signs the owner cared about a photo, or did not take it themselves. -1 is a "reject" star rating.
    rec.rating = Math.max(-1, Math.min(5, Math.round(Number(tags.xmp?.Rating?.value ?? tags.xmp?.Rating?.description ?? tags.exif?.Rating?.value ?? 0) || 0)));
    const lname = path.basename(file).toLowerCase();
    if (/^img_e\d/.test(lname) || /[-_ (]edit(ed)?\b/.test(lname) || /lightroom|photoshop|snapseed|vsco|darktable|capture one|affinity/.test(software)) rec.flags.push("edited");
    if (/front/i.test(tags.exif?.LensModel?.description || "")) rec.flags.push("selfie");
    if (/-wa\d{3,}|^received_|telegram/.test(lname)) rec.flags.push("received");
    if (!rec.camera && rec.dateSource === "file") rec.flags.push("no-metadata");

    rec.decodePath = await decodable(file);
    const meta = await sharp(rec.decodePath).metadata();
    const swap = (meta.orientation || 1) >= 5;
    rec.width = swap ? meta.height : meta.width;
    rec.height = swap ? meta.width : meta.height;
    rec.aspect = +(rec.width / rec.height).toFixed(4);
    rec.orientation = rec.aspect > 1.1 ? "L" : rec.aspect < 0.9 ? "P" : "S";

    const { data, info } = await sharp(rec.decodePath).rotate().resize(512, 512, { fit: "inside" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const { width: w, height: h } = info;
    const lum = new Float32Array(w * h);
    let sat = 0, nearWhite = 0, rgS = 0, rgQ = 0, ybS = 0, ybQ = 0;
    const buckets = new Map();
    const hist = new Float64Array(64);
    for (let i = 0, p = 0; p < w * h; p++, i += 3) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      lum[p] = 0.299 * r + 0.587 * g + 0.114 * b;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      sat += mx === 0 ? 0 : (mx - mn) / mx;
      if (mn > 225) nearWhite++;
      const q = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
      buckets.set(q, (buckets.get(q) || 0) + 1);
      hist[((r >> 6) << 4) | ((g >> 6) << 2) | (b >> 6)]++;
      const rg = r - g, yb = 0.5 * (r + g) - b;
      rgS += rg; rgQ += rg * rg; ybS += yb; ybQ += yb * yb;
    }
    const n = w * h;
    // Colourfulness (Hasler & Suesstrunk); people prefer vivid photos to dull ones.
    const mRg = rgS / n, mYb = ybS / n;
    const colorful = Math.sqrt(Math.max(0, rgQ / n - mRg ** 2) + Math.max(0, ybQ / n - mYb ** 2)) + 0.3 * Math.hypot(mRg, mYb);
    rec.col = hex([...hist].map((c) => Math.sqrt(c / n) * 255));
    const sorted = Float32Array.from(lum).sort();
    const pct = (x) => sorted[Math.min(n - 1, Math.floor(n * x))];
    const flat = Math.max(...buckets.values()) / n;

    // Laplacian variance per tile of a 4x4 grid; the sharpest tiles stand for the subject.
    const tiles = Array.from({ length: 16 }, () => ({ s: 0, s2: 0, c: 0 }));
    let edges = 0;
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const k = y * w + x;
      const l = lum[k - 1] + lum[k + 1] + lum[k - w] + lum[k + w] - 4 * lum[k];
      const t = tiles[Math.min(3, Math.floor((y * 4) / h)) * 4 + Math.min(3, Math.floor((x * 4) / w))];
      t.s += l; t.s2 += l * l; t.c++;
      if (Math.abs(l) > 40) edges++;
    }
    const vars = tiles.filter((t) => t.c).map((t) => t.s2 / t.c - (t.s / t.c) ** 2).sort((a, b) => b - a);
    rec.metrics = {
      sharp: +((vars[0] + vars[1]) / 2).toFixed(1),
      p05: Math.round(pct(0.05)), p50: Math.round(pct(0.5)), p95: Math.round(pct(0.95)), p99: Math.round(pct(0.99)),
      saturation: +(sat / n).toFixed(3), nearWhite: +(nearWhite / n).toFixed(3),
      flat: +flat.toFixed(3), edges: +(edges / n).toFixed(3), colorful: +colorful.toFixed(1),
    };

    const hraw = await sharp(rec.decodePath).rotate().greyscale().resize(9, 8, { fit: "fill" }).raw().toBuffer();
    let hash = 0n;
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) hash = (hash << 1n) | (hraw[y * 9 + x] > hraw[y * 9 + x + 1] ? 1n : 0n);
    rec.hash = hash;

    // Colour layout: the average colour of a 4x4 grid, so a reframed shot of the same view still matches.
    const tiny = await sharp(rec.decodePath).rotate().resize(32, 32, { fit: "fill" }).removeAlpha().raw().toBuffer();
    const lay = [];
    for (let cy = 0; cy < 4; cy++) for (let cx = 0; cx < 4; cx++) {
      let L = 0, A = 0, Bb = 0;
      for (let y = cy * 8; y < cy * 8 + 8; y++) for (let x = cx * 8; x < cx * 8 + 8; x++) {
        const i = (y * 32 + x) * 3;
        const [l, a, b] = lab(tiny[i], tiny[i + 1], tiny[i + 2]);
        L += l; A += a; Bb += b;
      }
      lay.push((L / 64) * 2.55, A / 64 + 128, Bb / 64 + 128);
    }
    rec.lay = hex(lay);

    rec.thumb = await sharp(rec.decodePath).rotate().resize(300, 300, { fit: "inside" }).jpeg({ quality: 78 }).toBuffer();

    const m = rec.metrics;
    const name = path.basename(file).toLowerCase();
    if (name.includes("screenshot") || name.includes("screen shot") || name.includes("צילום מסך") || software.includes("screenshot"))
      rec.reasons.push("screenshot");
    else if (!rec.camera && (path.extname(name) === ".png" || m.flat > 0.35))
      rec.reasons.push("screenshot or graphic");
    if (!rec.reasons.length && m.saturation < 0.12 && m.nearWhite > 0.4 && m.edges > 0.06) rec.reasons.push("document or receipt");
    // Night shots keep bright highlights (lamps, windows); a dud is dark all the way up.
    if (m.p50 < 35 && m.p95 < 70 && m.p99 < 130) rec.reasons.push("too dark");
    if (m.p50 > 232 && m.p05 > 170) rec.reasons.push("washed out");
    if (Math.max(rec.width, rec.height) < T.minLongSide) rec.reasons.push("too small to print");
    if (Math.max(rec.width, rec.height) < T.lowresLongSide) rec.flags.push("lowres");
    if (rec.rating === -1) rec.reasons.push("marked as rejected");
  } catch (e) {
    rec.reasons.push(`unreadable (${e.message.split("\n")[0]})`);
  }
  return rec;
}

function qualityScores(recs) {
  const ok = recs.filter((r) => r.metrics);
  const bySharp = [...ok].sort((a, b) => a.metrics.sharp - b.metrics.sharp);
  bySharp.forEach((r, i) => (r._sharpRank = ok.length > 1 ? i / (ok.length - 1) : 1));
  for (const r of ok) {
    const { p05, p50, p95 } = r.metrics;
    const exposure = Math.max(0, 1 - Math.abs(p50 - 120) / 140 - (p95 < 150 ? 0.25 : 0) - (p05 > 90 ? 0.25 : 0));
    const res = Math.min(1, (r.width * r.height) / 12e6);
    r.quality = +(0.6 * r._sharpRank + 0.25 * exposure + 0.15 * res).toFixed(3);
    delete r._sharpRank;
  }
}

async function contactSheet(items, label, out) {
  const COLS = 6, CW = 300, LH = 46, GAP = 8;
  const rows = Math.ceil(items.length / COLS);
  const W = COLS * CW + (COLS + 1) * GAP, H = rows * (CW + LH) + (rows + 1) * GAP;
  const comps = [];
  for (const [i, r] of items.entries()) {
    const x = GAP + (i % COLS) * (CW + GAP), y = GAP + Math.floor(i / COLS) * (CW + LH + GAP);
    const tm = await sharp(r.thumb).metadata();
    comps.push({ input: r.thumb, left: x + Math.round((CW - tm.width) / 2), top: y + Math.round((CW - tm.height) / 2) });
    const [l1, l2] = label(r);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${CW}" height="${LH}"><rect width="100%" height="100%" fill="#111"/>
      <text x="8" y="19" font-family="Consolas,Menlo,monospace" font-size="17" font-weight="bold" fill="#fff">${esc(l1)}</text>
      <text x="8" y="39" font-family="Consolas,Menlo,monospace" font-size="14" fill="#f5c26b">${esc(l2)}</text></svg>`;
    comps.push({ input: Buffer.from(svg), left: x, top: y + CW });
  }
  await sharp({ create: { width: W, height: H, channels: 3, background: "#2a2a2a" } }).composite(comps).jpeg({ quality: 82 }).toFile(out);
}

// ─── main ───────────────────────────────────────────────────────────────────

const files = await scan(SRC);
if (!files.length) { console.error(`No photos found in ${SRC}`); process.exit(1); }
await fs.mkdir(path.join(WORK, "sheets"), { recursive: true });
for (const f of await fs.readdir(path.join(WORK, "sheets"))) await fs.rm(path.join(WORK, "sheets", f));
console.log(`Culling ${files.length} files from ${SRC}`);

const recs = await pool(files, 4, analyze);
const readable = recs.filter((r) => r.metrics);
const med = median(readable.map((r) => r.metrics.sharp));
for (const r of readable) if (r.metrics.sharp < Math.max(T.blurAbs, T.blurRel * med)) r.reasons.push("blurry");
qualityScores(recs);
recs.sort((a, b) => a.date.localeCompare(b.date) || a.file.localeCompare(b.file));

// Duplicates: bursts (close in time and look), identical copies saved at any time,
// and an edited copy next to its original (IMG_E1234 / "-edited" beside IMG_1234).
const t = (r) => Date.parse(r.date) / 1000;
const stem = (r) => path.basename(r.file).toLowerCase().replace(/\.[^.]+$/, "").replace(/^img_e(\d)/, "img_$1").replace(/[-_ ]*\(?edit(ed)?\)?$/, "");
const live = recs.filter((r) => r.metrics);
const groups = [];
for (const r of live) {
  const g = groups.find((g) => g.some((o) =>
    hamming(o.hash, r.hash) <= T.exactHamming ||
    (Math.abs(t(o) - t(r)) <= T.dupSeconds && hamming(o.hash, r.hash) <= T.dupHamming) ||
    (stem(o) === stem(r) && (Math.abs(t(o) - t(r)) <= 3600 || hamming(o.hash, r.hash) <= 20))));
  if (g) g.push(r); else groups.push([r]);
}
// The kept frame: technically best, but the owner's edited or starred version wins.
const rank = (r) => (r.reasons.length ? -1 : 0) + r.quality + (r.flags.includes("edited") ? 0.3 : 0) + (r.rating >= 3 ? 0.3 : 0) + 0.02 * Math.max(0, r.rating);
for (const g of groups.filter((g) => g.length > 1)) {
  const best = [...g].sort((a, b) => rank(b) - rank(a))[0];
  for (const r of g) if (r !== best && !r.reasons.length) { r.reasons.push("duplicate"); r.dupOf = best; }
}

// Photo understanding: a local model reads what each surviving photo shows. Photos it is
// sure are information, not moments (passports, tickets, screenshots), and photos like
// ones the user removed before, are rejected; unsure ones are flagged for the suspects sheet.
const JUNK_REJECT = 0.8, JUNK_SUSPECT = 0.6;
let visionOn = false;
if (!flag("--no-ai")) {
  const survivors = recs.filter((r) => !r.reasons.length);
  console.log(`  understanding ${survivors.length} photos (local model, nothing is uploaded)...`);
  const vecs = await embed(survivors.map((r) => r.decodePath), (i, n) => { if (i % 25 === 0 || i === n) process.stdout.write(`\r  understood ${i}/${n}`); });
  process.stdout.write("\n");
  if (vecs) {
    visionOn = true;
    const labels = await classify(vecs);
    const taste = await loadTaste();
    survivors.forEach((r, i) => {
      if (!vecs[i]) return;
      r.emb = pack(vecs[i]);
      r.vision = labels[i];
      const liked = tasteMatch(taste, vecs[i]);
      if (liked) r.reasons.push(`like removed: ${liked.note}`);
      else if (r.vision.junk >= JUNK_REJECT) r.reasons.push(`looks like: ${r.vision.junkLabel}`);
      else if (r.vision.junk >= JUNK_SUSPECT) r.flags.push("suspect");
    });
  }
}

const kept = recs.filter((r) => !r.reasons.length);
const rejected = recs.filter((r) => r.reasons.length);
// Rejects most worth a second look come first; duplicates (best frame kept) come last.
const rejectOrder = (r) => (r.reasons.includes("duplicate") ? 3 : r.reasons.some((x) => /screenshot|document/.test(x)) ? 2 : r.reasons.some((x) => /^(looks like|like removed|marked as rejected)/.test(x)) ? 1 : 0);
rejected.sort((a, b) => rejectOrder(a) - rejectOrder(b) || a.date.localeCompare(b.date));
kept.forEach((r, i) => (r.code = `P${String(i + 1).padStart(3, "0")}`));
rejected.forEach((r, i) => (r.code = `R${String(i + 1).padStart(3, "0")}`));
const topCut = [...kept].sort((a, b) => b.quality - a.quality)[Math.floor(kept.length * 0.15)]?.quality ?? 1;

// Place names come from the bundled offline list, so no location leaves the computer.
for (const r of recs) if (r.gps) Object.assign(r, findPlace(r.gps.lat, r.gps.lng));

const day = (r) => r.date.slice(0, 10);
const PER = 36;
const has = (r, f) => r.flags.includes(f);
for (let i = 0; i * PER < rejected.length; i++)
  await contactSheet(rejected.slice(i * PER, (i + 1) * PER).filter((r) => r.thumb), (r) => [
    `${r.code}${r.dupOf ? " dup of " + r.dupOf.code : ""}`, r.reasons.join(", "),
  ], path.join(WORK, "sheets", `rejected-${String(i + 1).padStart(2, "0")}.jpg`));

const days = [...new Set(kept.map(day))].map((d) => {
  const ps = kept.filter((r) => day(r) === d);
  return { day: d, count: ps.length, first: ps[0].code, last: ps.at(-1).code, places: [...new Set(ps.map((r) => r.place).filter(Boolean))] };
});
const reasonCounts = {};
for (const r of rejected) for (const why of r.reasons) reasonCounts[why.replace(/ \(.*/, "")] = (reasonCounts[why.replace(/ \(.*/, "")] || 0) + 1;

const clean = (r) => ({
  code: r.code, file: r.file, path: r.path, decodePath: r.decodePath, width: r.width, height: r.height,
  aspect: r.aspect, orientation: r.orientation, date: r.date, dateSource: r.dateSource, gps: r.gps, place: r.place, local: r.local || undefined, country: r.country,
  camera: r.camera, rating: r.rating || undefined, quality: r.quality, top: r.quality >= topCut || undefined, flags: r.flags,
  status: r.reasons.length ? "reject" : "keep", reasons: r.reasons.length ? r.reasons : undefined, dupOf: r.dupOf?.code, metrics: r.metrics,
  hash: r.hash?.toString(16).padStart(16, "0"), lay: r.lay, col: r.col, emb: r.emb, vision: r.vision,
});
await fs.writeFile(path.join(WORK, "cull.json"), JSON.stringify({
  source: SRC, createdAt: new Date().toISOString(), strict: STRICT,
  stats: { total: recs.length, kept: kept.length, rejected: rejected.length, reasons: reasonCounts },
  days, photos: [...kept, ...rejected].map(clean),
}, null, 1));

console.log(`\n${recs.length} files -> ${kept.length} kept, ${rejected.length} rejected`);
for (const [k, v] of Object.entries(reasonCounts)) console.log(`  ${String(v).padStart(4)}  ${k}`);
console.log(`Days: ${days.map((d) => `${d.day} (${d.count}, ${d.first}-${d.last})`).join(" | ")}`);
const placeCounts = {};
for (const r of kept) if (r.place) placeCounts[r.place] = (placeCounts[r.place] || 0) + 1;
console.log(`Places: ${Object.entries(placeCounts).sort((a, b) => b[1] - a[1]).map(([p, c]) => `${p} (${c})`).join(", ") || "none"}  ·  no GPS: ${kept.filter((r) => !r.gps).length}  ·  no camera date: ${kept.filter((r) => r.dateSource !== "exif").length}`);
const flagCount = (f) => kept.filter((r) => has(r, f)).length;
console.log(`Owner signals: rated ${kept.filter((r) => r.rating >= 3).length}, edited ${flagCount("edited")}, selfies ${flagCount("selfie")}, received ${flagCount("received")}  ·  low-res: ${flagCount("lowres")}`);
console.log(visionOn ? `Photo understanding: on · ${flagCount("suspect")} kept photos flagged as suspects` : "Photo understanding: OFF (only measurements were used; documents and screenshots may slip through)");
console.log(`Work dir: ${WORK}\n  cull.json, sheets/rejected-*.jpg\nNext: node pick.mjs "${WORK}"`);
