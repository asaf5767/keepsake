#!/usr/bin/env node
// Review contact sheets plus large, uncropped views of named photo codes.
// node review.mjs <work> [--codes P001,P002] [--out folder]
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import sharp from "sharp";

export async function reviewPhotos(work, { codes, out = path.join(work, "review") } = {}) {
  const cull = JSON.parse(await fs.readFile(path.join(work, "cull.json"), "utf8"));
  const byCode = new Map(cull.photos.map(photo => [photo.code, photo]));
  const requested = codes ? [...new Set(codes)] : cull.photos.filter(photo => photo.status === "keep").map(photo => photo.code);
  if (!requested.length) throw new Error("No photographs to review.");
  const missing = requested.filter(code => !byCode.has(code));
  if (missing.length) throw new Error(`Unknown photo codes: ${missing.join(", ")}`);
  await fs.mkdir(out, { recursive: true });
  const reviewed = [];
  const escape = value => String(value).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const cell = 480, gap = 12, caption = 62, columns = 3, perSheet = 12;
  const images = [];
  for (const code of requested) {
    if (!/^[PR]\d+$/.test(code)) throw new Error(`Unsafe photo code "${code}"`);
    const photo = byCode.get(code);
    const input = sharp(photo.decodePath || photo.path).rotate();
    const large = path.join(out, `${code}.jpg`);
    await input.clone().resize(1800, 1800, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 94 }).toFile(large);
    const thumb = await input.clone().resize(cell, cell, { fit: "contain", background: "#fff" }).jpeg({ quality: 90 }).toBuffer();
    const text = `${code} | ${photo.date || "date unknown"} | ${photo.status}`;
    const info = `${photo.width} x ${photo.height} | ${photo.dateSource || "unknown"} date | ${(photo.flags || []).join(", ")}`;
    images.push({ thumb, label: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${cell}" height="${caption}">
      <rect width="100%" height="100%" fill="white"/>
      <text x="8" y="22" font-family="sans-serif" font-size="17" font-weight="bold">${escape(text)}</text>
      <text x="8" y="46" font-family="sans-serif" font-size="14">${escape(info)}</text></svg>`) });
    reviewed.push({ code, image: `${code}.jpg`, source: photo.file, dateSource: photo.dateSource, status: photo.status });
  }
  const sheets = [];
  for (let start = 0; start < images.length; start += perSheet) {
    const batch = images.slice(start, start + perSheet);
    const name = `review-${String(sheets.length + 1).padStart(2, "0")}.jpg`;
    const rows = Math.ceil(batch.length / columns);
    await sharp({ create: { width: columns * (cell + gap) + gap, height: rows * (cell + caption + gap) + gap,
      channels: 3, background: "#dedede" } }).composite(batch.flatMap((image, i) => {
      const left = gap + i % columns * (cell + gap), top = gap + Math.floor(i / columns) * (cell + caption + gap);
      return [{ input: image.thumb, left, top }, { input: image.label, left, top: top + cell }];
    })).jpeg({ quality: 92 }).toFile(path.join(out, name));
    sheets.push(name);
  }
  const manifest = { photos: reviewed, sheets, warning: "Generated for review, not proof that a person or agent viewed them." };
  await fs.writeFile(path.join(out, "review.json"), JSON.stringify(manifest, null, 2));
  return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [work, ...args] = process.argv.slice(2);
  if (!work || work.startsWith("--")) throw new Error("Usage: node review.mjs <work> [--codes P001,P002] [--out folder]");
  const values = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!["--codes", "--out"].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith("--")) throw new Error(`Invalid review option: ${args[i]}`);
    values[args[i]] = args[i + 1];
  }
  const manifest = await reviewPhotos(path.resolve(work), {
    codes: values["--codes"]?.split(",").map(code => code.trim()),
    ...(values["--out"] ? { out: path.resolve(values["--out"]) } : {}),
  });
  console.log(`Prepared ${manifest.photos.length} uncropped views and ${manifest.sheets.length} contact sheets.`);
  console.log(`Review folder: ${path.resolve(values["--out"] || path.join(work, "review"))}`);
}
