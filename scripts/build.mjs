#!/usr/bin/env node
// Keepsake step 3: render reviewed scenes with subject-safe crops and compact
// photo-first pages. Explicit legacy chapter styles remain available.
// Writes a reading PDF, print components, preview and placement evidence.
//
// node build.mjs <work>/album.json [--project album.project.json] [--out book-folder]

import fs from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { pathToFileURL, fileURLToPath } from "url";
import sharp from "sharp";
import puppeteer from "puppeteer-core";
import { PDFDocument } from "pdf-lib";
import { createHash } from "node:crypto";
import { imagePlacement, placementCost, validateProtection, focusPoint } from "./composition.mjs";
import { DECOR_MODES, GRAPHICS, buildSpreadDecor, graphicSvgMarkup, washSvgMarkup } from "./editor-decor.mjs";
import { albumFingerprint, loadEditorProject } from "./editor-project.mjs";
import { placementWarnings, protectedBounds, resolveFramePlacement } from "./editor-placement.mjs";
import { makeEditorLayouts } from "./editor-layouts.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FONTS = path.join(HERE, "..", "assets", "fonts");
const ALBUM_PATH = path.resolve(process.argv[2] || "album.json");
const WORK = path.dirname(ALBUM_PATH);
const option = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const PROJECT_PATH = option("--project") ? path.resolve(option("--project")) : null;
const OUT = option("--out") ? path.resolve(option("--out")) : path.join(WORK, "book");
const sourceAlbum = JSON.parse(await fs.readFile(ALBUM_PATH, "utf8"));
const cull = JSON.parse(await fs.readFile(path.resolve(WORK, sourceAlbum.cull || "cull.json"), "utf8"));
const photoCodes = new Set(cull.photos.map((photo) => photo.code));
const editorProject = PROJECT_PATH
  ? await loadEditorProject(PROJECT_PATH, { album: sourceAlbum, photoCodes })
  : null;
const album = structuredClone(sourceAlbum);
if (editorProject) {
  album.title = editorProject.book.title;
  album.subtitle = editorProject.book.subtitle;
  album.theme = editorProject.book.theme;
  album.decor = editorProject.book.decor || album.decor || "crafted";
  album.font = editorProject.book.font;
  album.showHeadings = editorProject.book.showHeadings ?? album.showHeadings;
  album.callouts = editorProject.book.callouts ?? album.callouts;
}
const DECOR_MODE = DECOR_MODES.includes(album.decor) ? album.decor : "crafted";
const SHOW_HEADINGS = album.showHeadings !== false;
const CALLOUTS = album.callouts === true;
for (const key of ["showHeadings", "callouts"]) {
  if (album[key] !== undefined && typeof album[key] !== "boolean") throw new Error(`${key} must be true or false`);
}

// ─── book geometry (mm) ─────────────────────────────────────────────────────

const TW = album.trimWidthMm ?? album.trimMm ?? 300;
const TH = album.trimHeightMm ?? album.trimMm ?? 300;
const B = album.bleedMm ?? 3;
const W = TW + 2 * B, H = TH + 2 * B;
const M = album.marginMm ?? 12;           // grid margin from the trim edge
const IE = album.bindingMm ?? 3;          // extra margin on the binding side
const G = album.gutterMm ?? 3;            // space between photos
const SAFE = 14;                          // text distance from the trim edge
const RTL = album.direction === "rtl";
const LAYFLAT = !!album.layflat;
const MIN_PAGES = album.minPages ?? 24;
const MULTIPLE = album.pageMultiple ?? 2;
const DENSITY = ["airy", "balanced", "full"].includes(album.density) ? album.density : "balanced";
const DENS = { airy: { target: 2.6, maxGrid: 3 }, balanced: { target: 4.5, maxGrid: 5 }, full: { target: 7, maxGrid: 9 } }[DENSITY];
const CHAPTER_STYLE = album.chapterStyle ?? "compact";
if (!["compact", "page", "color", "overlay"].includes(CHAPTER_STYLE)) throw new Error("Unknown chapterStyle");
const PHOTO_FIRST = CHAPTER_STYLE === "compact";
if (editorProject && !PHOTO_FIRST) throw new Error("Editor projects require chapterStyle: compact");
if (![TW, TH, M, G].every((v) => Number.isFinite(v) && v > 0) ||
    !Number.isFinite(B) || B < 0 || !Number.isFinite(IE) || IE < 0 ||
    !Number.isInteger(MIN_PAGES) || MIN_PAGES < 0 ||
    !Number.isInteger(MULTIPLE) || MULTIPLE < 2 || MULTIPLE % 2 ||
    2 * M + IE >= TW || 2 * M + 20 >= TH) {
  throw new Error("Invalid page geometry: use positive trim/margins, nonnegative bleed, and an even pageMultiple");
}
const FOLIOS = album.folios !== false;
const DPI_OK = 240, DPI_WARN = 200, DPI_FAIL = 150;
const THEMES = {
  white: { bg: "#ffffff", ink: "#141414", muted: "#7c7c7c" },
  cream: { bg: "#f6f2ea", ink: "#1b1a18", muted: "#857e72" },
  dark: { bg: "#121212", ink: "#f3f3f3", muted: "#9b9b9b" },
};
const theme = THEMES[album.theme] || THEMES.white;
const BOOK_FONT = ["Montserrat", "Heebo"].includes(album.font)
  ? album.font
  : RTL ? "Heebo" : "Montserrat";
const PAGE_ASPECT = TW / TH;
const BLEED_BOX = { x: 0, y: 0, w: W, h: H };
const FRAME_SIDE = PHOTO_FIRST ? M : TW * 0.1, FRAME_TOP = PHOTO_FIRST ? M : TH * 0.12;

// Page 1 faces the inside front cover: a right-hand page in LTR books, a left-hand page in RTL books.
const physLeft = (no) => (RTL ? no % 2 === 1 : no % 2 === 0);
function contentBox(no) {
  const left = physLeft(no);
  const l = left ? M : M + IE, r = left ? M + IE : M;
  const header = PHOTO_FIRST && SHOW_HEADINGS ? 18 : 0;
  return { x: B + l, y: B + M + header, w: TW - l - r, h: TH - 2 * M - header };
}
function frameBox(no) {
  const left = physLeft(no);
  const l = left ? FRAME_SIDE : FRAME_SIDE + IE, r = left ? FRAME_SIDE + IE : FRAME_SIDE;
  const header = PHOTO_FIRST && SHOW_HEADINGS ? 18 : 0;
  return { x: B + l, y: B + FRAME_TOP + header, w: TW - l - r, h: TH - 2 * FRAME_TOP - header };
}
const CANON = contentBox(2);
const CANON_FRAME = frameBox(2);

// ─── grid templates ─────────────────────────────────────────────────────────
// [id, columns, rows, cells]; a cell is [col, row, colSpan, rowSpan] and "t" marks a text block.

const grid = (c, r) => Array.from({ length: c * r }, (_, i) => [i % c, Math.floor(i / c), 1, 1]);
const PHOTO_TEMPLATES = [
  ["1", 1, 1, [[0, 0, 1, 1]]],
  ["2c", 2, 1, grid(2, 1)],
  ["2r", 1, 2, grid(1, 2)],
  ["2L", 3, 1, [[0, 0, 2, 1], [2, 0, 1, 1]]],
  ["2T", 1, 3, [[0, 0, 1, 2], [0, 2, 1, 1]]],
  ["2short-long", 1, 5, [[0, 0, 1, 2], [0, 2, 1, 3]]],
  ["2long-short", 1, 5, [[0, 0, 1, 3], [0, 3, 1, 2]]],
  ["3L", 3, 2, [[0, 0, 2, 2], [2, 0, 1, 1], [2, 1, 1, 1]]],
  ["3T", 2, 3, [[0, 0, 2, 2], [0, 2, 1, 1], [1, 2, 1, 1]]],
  ["3c", 3, 1, grid(3, 1)],
  ["3r", 1, 3, grid(1, 3)],
  ["3P", 2, 2, [[0, 0, 1, 2], [1, 0, 1, 1], [1, 1, 1, 1]]],
  ["3B", 2, 2, [[0, 0, 1, 1], [1, 0, 1, 1], [0, 1, 2, 1]]],
  ["4g", 2, 2, grid(2, 2)],
  ["4T", 3, 3, [[0, 0, 3, 2], [0, 2, 1, 1], [1, 2, 1, 1], [2, 2, 1, 1]]],
  ["4L", 3, 3, [[0, 0, 2, 3], [2, 0, 1, 1], [2, 1, 1, 1], [2, 2, 1, 1]]],
  ["4m", 2, 3, [[0, 0, 1, 2], [1, 0, 1, 1], [1, 1, 1, 1], [0, 2, 2, 1]]],
  ["5a", 6, 2, [[0, 0, 3, 1], [3, 0, 3, 1], [0, 1, 2, 1], [2, 1, 2, 1], [4, 1, 2, 1]]],
  ["5L", 3, 2, [[0, 0, 1, 2], [1, 0, 1, 1], [2, 0, 1, 1], [1, 1, 1, 1], [2, 1, 1, 1]]],
  ["5T", 4, 3, [[0, 0, 4, 2], [0, 2, 1, 1], [1, 2, 1, 1], [2, 2, 1, 1], [3, 2, 1, 1]]],
  ["6g", 3, 2, grid(3, 2)],
  ["6r", 2, 3, grid(2, 3)],
  ["6B", 3, 3, [[0, 0, 2, 2], [2, 0, 1, 1], [2, 1, 1, 1], [0, 2, 1, 1], [1, 2, 1, 1], [2, 2, 1, 1]]],
  ["7", 4, 3, [[0, 0, 2, 2], [2, 0, 1, 1], [3, 0, 1, 1], [2, 1, 1, 1], [3, 1, 1, 1], [0, 2, 2, 1], [2, 2, 2, 1]]],
  ["8", 4, 3, [[0, 0, 2, 2], [2, 0, 1, 1], [3, 0, 1, 1], [2, 1, 1, 1], [3, 1, 1, 1], [0, 2, 1, 1], [1, 2, 1, 1], [2, 2, 2, 1]]],
  ["9", 3, 3, grid(3, 3)],
];
const TEXT_TEMPLATES = [
  ["t1", 1, 3, [[0, 0, 1, 2], [0, 2, 1, 1, "t"]]],
  ["t2", 2, 2, [[0, 0, 1, 2], [1, 0, 1, 1], [1, 1, 1, 1, "t"]]],
  ["t3", 2, 2, [[0, 0, 1, 1], [1, 0, 1, 1], [0, 1, 1, 1], [1, 1, 1, 1, "t"]]],
  ["t3T", 3, 3, [[0, 0, 3, 2], [0, 2, 1, 1], [1, 2, 1, 1], [2, 2, 1, 1, "t"]]],
  ["t4", 3, 2, [[0, 0, 1, 1], [1, 0, 1, 1], [2, 0, 1, 1], [0, 1, 1, 1], [1, 1, 2, 1, "t"]]],
  ["t5", 3, 3, [[0, 0, 2, 2], [2, 0, 1, 1], [2, 1, 1, 1], [0, 2, 1, 1], [1, 2, 1, 1], [2, 2, 1, 1, "t"]]],
  ["t8", 3, 3, [[0, 0, 1, 1], [1, 0, 1, 1], [2, 0, 1, 1], [0, 1, 1, 1], [1, 1, 1, 1, "t"], [2, 1, 1, 1], [0, 2, 1, 1], [1, 2, 1, 1], [2, 2, 1, 1]]],
];
const TITLE_TEMPLATE = ["T3", 2, 2, [[0, 0, 1, 1], [1, 0, 1, 1, "t"], [0, 1, 1, 1], [1, 1, 1, 1]]];

function cellsOf([, c, r, cells], bx) {
  const cw = (bx.w - G * (c - 1)) / c, ch = (bx.h - G * (r - 1)) / r;
  return cells.map(([col, row, cs, rs, t]) => {
    let x = bx.x + col * (cw + G);
    const w = cs * cw + (cs - 1) * G;
    if (RTL) x = bx.x + bx.w - (x - bx.x) - w;
    return { x, y: bx.y + row * (ch + G), w, h: rs * ch + (rs - 1) * G, text: t === "t" };
  });
}

// ─── photos ─────────────────────────────────────────────────────────────────

const byKey = new Map();
for (const p of cull.photos) {
  byKey.set(p.code, p);
  byKey.set(p.file, p);
  byKey.set(path.basename(p.file), p);
}
const errors = [], warnings = [];
const used = new Set();
function item(raw, track = true) {
  const input = typeof raw === "string" ? { id: raw } : { ...raw };
  const o = { ...album.photoSettings?.[input.id], ...input };
  o.p = byKey.get(o.id);
  if (!o.p) { errors.push(`Unknown photo "${o.id}"`); return null; }
  try {
    validateProtection(o.protect);
    focusPoint(o.focus);
    if (o.fit !== undefined && !["cover", "contain"].includes(o.fit)) throw new Error("fit must be cover or contain");
    if (o.role !== undefined && !["main", "support", "detail"].includes(o.role)) throw new Error("role must be main, support or detail");
  } catch (e) {
    errors.push(`${o.id}: ${e.message}`);
    return null;
  }
  if (!track) return o;
  if (used.has(o.p.code)) warnings.push(`${o.p.code} is used more than once`);
  used.add(o.p.code);
  return o;
}
const coverSpec = typeof album.cover === "string" ? { photo: album.cover } : album.cover || {};
const coverItems = (coverSpec.photos || [coverSpec.photo]).filter(Boolean).map((x) => item(x, false)).filter(Boolean);
const titleSpec = album.titlePage || {};
const titleItems = (titleSpec.photos || (titleSpec.photo ? [titleSpec.photo] : [])).map((x) => item(x, false)).filter(Boolean);
const chapters = (album.chapters || []).map((c, chapterIndex) => {
  const chapterId = c.id || `chapter-${String(chapterIndex + 1).padStart(2, "0")}`;
  if (c.scenes && c.photos) errors.push(`Chapter "${c.title}" must use scenes or photos, not both`);
  if (c.scenes && !PHOTO_FIRST) errors.push("Scenes require chapterStyle: compact");
  const scenes = c.scenes?.map((scene, sceneIndex) => {
    const sceneId = scene.id || `${chapterId}-scene-${String(sceneIndex + 1).padStart(2, "0")}`;
    const items = (scene.photos || []).map((x, photoIndex) => {
      const result = item(x);
      if (result) {
        result.editorId = `${sceneId}-frame-${String(photoIndex + 1).padStart(2, "0")}`;
        result.sceneId = sceneId;
        result.chapterId = chapterId;
      }
      return result;
    }).filter(Boolean);
    if (items.length < 2 || items.length > 10) errors.push(`Scene "${scene.title}" needs 2-10 photos`);
    if (album.order !== "as-listed") items.sort((a, b) => a.p.date.localeCompare(b.p.date));
    return { ...scene, id: sceneId, chapterId, items };
  });
  const items = scenes ? scenes.flatMap((s) => s.items) : (c.photos || []).map((x) => item(x)).filter(Boolean);
  // Date order by default, so photos can be added to album.json anywhere in a chapter.
  if (album.order !== "as-listed") items.sort((a, b) => a.p.date.localeCompare(b.p.date));
  return { ...c, id: chapterId, items, scenes };
});
const closingItem = album.closing?.photo ? item(album.closing.photo, false) : null;
if (closingItem) used.add(closingItem.p.code);
const editorItems = editorProject
  ? [...new Set(editorProject.order.flatMap((id) =>
    editorProject.spreads[id].frames.filter((frame) => !frame.hidden).map((frame) => frame.photo),
  ))].map((code) => item(code, false)).filter(Boolean)
  : [];
if (editorProject) {
  used.clear();
  for (const editorItem of editorItems) used.add(editorItem.p.code);
  if (closingItem) used.add(closingItem.p.code);
}
if (!chapters.length) errors.push("album.json has no chapters");
if (!coverItems.length) errors.push("album.json needs cover.photo (or cover.photos for a grid cover)");
if (chapters.some((c) => !c.items.length)) errors.push("every chapter needs at least one photo");
if (errors.length) { console.error(errors.join("\n")); process.exit(1); }

// ─── scoring ────────────────────────────────────────────────────────────────

const loss = (a, c) => 1 - Math.min(a, c) / Math.max(a, c);
const q = (it) => it.p.quality ?? 0.5;
const dpiCover = (p, w, h) => 25.4 / Math.max(w / p.width, h / p.height);
const dpiPenalty = (d) => (d >= DPI_OK ? 0 : d >= DPI_WARN ? 0.08 : d >= 170 ? 0.25 : d >= DPI_FAIL ? 0.6 : 3);
const fitIn = (p, bx) => { const w = Math.min(bx.w, bx.h * p.aspect); return { w, h: w / p.aspect }; };
function fullPageFits(it) {
  const placement = imagePlacement(it, BLEED_BOX);
  const subject = protectedBounds({
    width: it.p.width, height: it.p.height, what: it.p.vision?.what,
    protect: it.protect, subject: it.subject, sourceFit: it.fit,
  }, placement);
  return placement.fill >= 0.98 && (!subject ||
    (subject.x >= IE && subject.x + subject.w <= W - IE));
}
const mainPenalty = (it) => it.role === "detail" || it.role === "support" ? 4 : it.role === "main" || it.hero ? -0.5 : 0.3;
const bleedCost = (it) => PHOTO_FIRST
  ? placementCost(it, BLEED_BOX) + mainPenalty(it) + 0.2 * (1 - q(it))
  : 0.5 * (1 - q(it)) + 0.5 * loss(it.p.aspect, PAGE_ASPECT) ** 1.5 + dpiPenalty(dpiCover(it.p, W, H)) - (it.p.top ? 0.1 : 0);
// A framed photo needs presence on the page: very wide shots shrink to a strip, so they go to grids or panoramas instead.
const frameCost = (it) => PHOTO_FIRST
  ? placementCost(it, CANON_FRAME) + mainPenalty(it) + 0.2 * (1 - q(it))
  : 0.3 * (1 - q(it)) + dpiPenalty(it.p.width / (fitIn(it.p, CANON_FRAME).w / 25.4)) + (it.p.aspect > 2.4 ? 0.9 : it.p.aspect > 1.8 ? 0.45 : 0);

function* permutations(xs) {
  if (xs.length <= 1) { yield xs; return; }
  for (let i = 0; i < xs.length; i++)
    for (const rest of permutations([...xs.slice(0, i), ...xs.slice(i + 1)])) yield [xs[i], ...rest];
}
function assign(cells, items) {
  const area = cells.reduce((s, c) => s + c.w * c.h, 0);
  const cellCost = (it, cell) => {
    if (PHOTO_FIRST) return placementCost(it, cell) -
      0.15 * ((cell.w * cell.h) / area) * q(it);
    const l = loss(it.p.aspect, cell.w / cell.h);
    return l ** 1.5 + (l > 0.5 ? 1 : 0) + 0.5 * dpiPenalty(dpiCover(it.p, cell.w, cell.h)) - 0.25 * ((cell.w * cell.h) / area) * q(it);
  };
  const score = (order) => {
    let cost = 0, inversions = 0;
    order.forEach((it, i) => (cost += cellCost(it, cells[i])));
    for (let i = 0; i < order.length; i++) for (let j = i + 1; j < order.length; j++) if (order[i].idx > order[j].idx) inversions++;
    return cost / order.length + 0.015 * inversions;
  };
  const indexed = items.map((it, idx) => ({ ...it, idx }));
  if (indexed.length <= 5) {
    let best = null;
    for (const perm of permutations(indexed)) { const s = score(perm); if (!best || s < best.cost) best = { cost: s, order: perm }; }
    return best;
  }
  // Large pages: match photo shapes to cell shapes by rank.
  const cellRank = cells.map((c, i) => [c.w / c.h, i]).sort((a, b) => a[0] - b[0]).map(([, i]) => i);
  const photoRank = [...indexed].sort((a, b) => a.p.aspect - b.p.aspect);
  const order = new Array(cells.length);
  cellRank.forEach((ci, k) => (order[ci] = photoRank[k]));
  return { cost: score(order), order };
}
function compositions(n, maxPart = 3) {
  if (n === 0) return [[]];
  const out = [];
  for (let k = 1; k <= Math.min(maxPart, n); k++) for (const rest of compositions(n - k, maxPart)) out.push([k, ...rest]);
  return out;
}
// No-crop fallback: rows of whole photos sharing one width, centred, white around them.
function justified(items, bx) {
  if (items.length > 6) return null;
  let best = null;
  for (const comp of compositions(items.length)) {
    let i = 0;
    const rows = comp.map((k) => { const r = items.slice(i, i + k); i += k; return r; });
    const A = rows.map((r) => r.reduce((s, x) => s + x.p.aspect, 0));
    const fixed = G * (rows.length - 1) - rows.reduce((s, r, j) => s + (G * (r.length - 1)) / A[j], 0);
    const s = Math.min(bx.w, (bx.h - fixed) / A.reduce((acc, a) => acc + 1 / a, 0));
    const hs = rows.map((r, j) => (s - G * (r.length - 1)) / A[j]);
    if (hs.some((h) => h <= 0)) continue;
    const total = hs.reduce((a, b) => a + b, 0) + G * (rows.length - 1);
    let y = bx.y + (bx.h - total) / 2;
    const cells = [];
    rows.forEach((r, j) => {
      let x = bx.x + (bx.w - s) / 2;
      for (const it of r) {
        const w = hs[j] * it.p.aspect;
        cells.push({ x: RTL ? 2 * bx.x + bx.w - x - w : x, y, w, h: hs[j] });
        x += w + G;
      }
      y += hs[j] + G;
    });
    const areas = cells.map((c) => c.w * c.h);
    const fill = areas.reduce((a, b) => a + b, 0) / (bx.w * bx.h);
    const cost = (PHOTO_FIRST ? 2.5 : 0.8) * (1 - fill) + (Math.min(...areas) / (bx.w * bx.h) < 0.05 ? 0.5 : 0);
    if (!best || cost < best.cost) best = { cost, tpl: ["J"], cells, order: items };
  }
  return best;
}
function chooseTemplate(items, bx, { text = false, avoid } = {}) {
  let best = null;
  for (const t of text ? TEXT_TEMPLATES : PHOTO_TEMPLATES) {
    const cells = cellsOf(t, bx);
    const photoCells = cells.filter((c) => !c.text);
    if (photoCells.length !== items.length) continue;
    const a = assign(photoCells, items);
    const cost = a.cost + (t[0] === avoid ? (PHOTO_FIRST ? 0.015 : 0.12) : 0);
    if (!best || cost < best.cost) best = { cost, tpl: t, cells, order: a.order };
  }
  if (!text) {
    const j = justified(items, bx);
    if (j && (!best || j.cost < best.cost)) best = j;
  }
  return best;
}

// ─── spread planner ─────────────────────────────────────────────────────────
// A recipe is a spread: two page slots, or one picture across both pages.
// bleed = full-bleed photo · frame = one whole photo on white · grid = thin-gutter
// mosaic · gridBleed = mosaic to the page edge · band = row of photos aligned with
// the facing page's row.

const RECIPES = {
  BG: { pages: ["bleed", "grid"], bias: -0.12 },
  GB: { pages: ["grid", "bleed"], bias: -0.12 },
  BF: { pages: ["bleed", "frame"], bias: -0.1, airy: true },
  FB: { pages: ["frame", "bleed"], bias: -0.1, airy: true },
  FG: { pages: ["frame", "grid"], bias: 0 },
  GF: { pages: ["grid", "frame"], bias: 0 },
  FF: { pages: ["frame", "frame"], bias: 0, airy: true },
  GG: { pages: ["grid", "grid"], bias: 0.15 },
  BAND: { pages: ["band", "band"], bias: -0.05 },
  MOSAIC: { pages: ["gridBleed", "gridBleed"], bias: DENSITY === "full" ? 0.05 : 0.4 },
  PANO: { double: "pano", bias: 0 },
  SPREAD: { double: "spread", bias: 0 },
  BX: { pages: ["bleed", "blank"], bias: 1.5 },
  FX: { pages: ["frame", "blank"], bias: 1.5 },
};
const COMPACT_RECIPES = {
  BG: { pages: ["bleed", "grid"], bias: 0 },
  GB: { pages: ["grid", "bleed"], bias: 0.02 },
  FG: { pages: ["frame", "grid"], bias: 0.02 },
  GF: { pages: ["grid", "frame"], bias: 0.04 },
  GG: { pages: ["grid", "grid"], bias: 0.1 },
  FF: { pages: ["frame", "frame"], bias: 0.08 },
};
const OPEN_RECIPES = {
  OG: { pages: ["opener", "grid"], bias: 0 },
  OF: { pages: ["opener", "frame"], bias: 0.1 },
};
const isSingle = (s) => s === "bleed" || s === "frame";
const isMulti = (s) => s === "grid" || s === "gridBleed" || s === "band";
const maxFor = (s) => (s === "band" ? 3 : s === "gridBleed" ? 9 : DENS.maxGrid);
const minFor = (s) => (s === "gridBleed" ? 3 : 2);
const bleedSide = (rid) => RECIPES[rid]?.pages?.indexOf("bleed") ?? -1;

const hasFrame = (rid) => !!RECIPES[rid]?.pages?.includes("frame");
function rhythm(prev, rid, c, T, usage) {
  const rec = RECIPES[rid] || OPEN_RECIPES[rid];
  let r = 0.07 * (c - T) ** 2 + (rec.bias || 0) + (PHOTO_FIRST ? 0.02 : 0.2) * (usage?.get(rid) || 0);
  if (prev === rid) r += 0.5;
  else if (bleedSide(prev) >= 0 && bleedSide(prev) === bleedSide(rid)) r += 0.15;
  if (RECIPES[prev]?.airy && rec.airy) r += 0.3;
  else if (hasFrame(prev) && hasFrame(rid)) r += 0.2;
  return r;
}

const costMemo = new Map();
function pageCost(kind, items, note) {
  const key = JSON.stringify([kind, !!note, items.map((x) => [
    x.p.code, x.protect, x.fit, x.focus, x.subject, x.role,
  ])]);
  if (!costMemo.has(key)) {
    const r = chooseTemplate(items, kind === "gridBleed" ? BLEED_BOX : CANON, { text: !!note });
    costMemo.set(key, r ? r.cost : Infinity);
  }
  return costMemo.get(key);
}
const rowHeight = (xs) => (CANON.w - G * (xs.length - 1)) / xs.reduce((s, x) => s + x.p.aspect, 0);
const bandHeight = (a, b) => Math.min(rowHeight(a), rowHeight(b), TH * 0.55);
function bandCost(a, b) {
  const h = bandHeight(a, b);
  if (h < TH * 0.28) return Infinity;
  const all = [...a, ...b];
  const short = h < TH * 0.36 ? (TH * 0.36 - h) / (TH * 0.06) : 0;
  return 0.1 + short + all.reduce((s, x) => s + 0.5 * dpiPenalty(dpiCover(x.p, h * x.p.aspect, h)), 0) / all.length;
}
function splitMulti(slots, items, note) {
  if (!slots.length) return items.length ? null : { cost: 0, groups: [] };
  const lo = note ? 1 : minFor(slots[0]);
  if (slots.length === 1) {
    if (items.length < lo || items.length > maxFor(slots[0])) return null;
    const c = pageCost(slots[0], items, note);
    return Number.isFinite(c) ? { cost: c, groups: [items] } : null;
  }
  const [s0, s1] = slots;
  let best = null;
  for (let k = lo; k <= Math.min(maxFor(s0), items.length - minFor(s1)); k++) {
    const a = items.slice(0, k), b = items.slice(k);
    if (b.length > maxFor(s1)) continue;
    const c = s0 === "band" ? bandCost(a, b) : pageCost(s0, a, note) + pageCost(s1, b);
    if (Number.isFinite(c) && (!best || c < best.cost)) best = { cost: c, groups: [a, b] };
  }
  return best;
}
function evalSpread(slots, seg, ctx = {}) {
  if (seg.some((x) => x.hero === "spread")) return null;
  const singleIdx = slots.flatMap((s, i) => (isSingle(s) ? [i] : []));
  const multis = slots.filter(isMulti);
  if (seg.length < singleIdx.length || (ctx.note && !multis.length)) return null;
  const tuples = singleIdx.length === 0 ? [[]]
    : singleIdx.length === 1 ? seg.map((x) => [x])
    : seg.flatMap((x) => seg.filter((y) => y !== x).map((y) => [x, y]));
  let best = null;
  for (const tup of tuples) {
    let cost = 0, ok = true;
    tup.forEach((it, j) => {
      const s = slots[singleIdx[j]];
      if ((s === "bleed" && (it.solo || (PHOTO_FIRST && !fullPageFits(it)))) ||
          (s === "frame" && it.hero && !PHOTO_FIRST)) ok = false;
      if (PHOTO_FIRST && (it.role === "detail" || it.role === "support")) ok = false;
      cost += s === "bleed" ? bleedCost(it) : frameCost(it);
    });
    if (!ok) continue;
    if (tup.length === 2 && slots[singleIdx[0]] === slots[singleIdx[1]] && seg.indexOf(tup[0]) > seg.indexOf(tup[1])) continue;
    const rest = seg.filter((x) => !tup.includes(x));
    if (rest.some((x) => x.hero || x.solo || (PHOTO_FIRST && x.role === "main"))) continue;
    const m = splitMulti(multis, rest, ctx.note);
    if (!m) continue;
    cost += m.cost;
    if (!best || cost < best.cost) best = { cost, tup, groups: m.groups };
  }
  if (!best) return null;
  let si = 0, mi = 0;
  const pages = slots.map((s) => {
    if (s === "opener") return { kind: "openerBleed", item: ctx.opener, chapter: ctx.chapter, index: ctx.index };
    if (s === "blank") return { kind: "blank" };
    if (isSingle(s)) return { kind: s, item: best.tup[si++] };
    const items = best.groups[mi++];
    return { kind: s, items, note: mi === 1 ? ctx.note : undefined };
  });
  const bands = pages.filter((p) => p.kind === "band");
  if (bands.length === 2) bands.forEach((p) => (p.bandH = bandHeight(bands[0].items, bands[1].items)));
  const frames = pages.filter((p) => p.kind === "frame");
  if (frames.length === 2 && loss(frames[0].item.p.aspect, frames[1].item.p.aspect) < 0.25) {
    const h = Math.min(...frames.map((p) => fitIn(p.item.p, CANON_FRAME).h));
    frames.forEach((p) => (p.pairH = h));
  }
  return { cost: best.cost, pages };
}
function evalDouble(kind, seg) {
  if (seg.length !== 1) return null;
  const it = seg[0];
  if (kind === "spread") return it.hero === "spread" ? { cost: -0.3, double: { kind: "spread", item: it } } : null;
  if (it.hero || it.p.aspect < 1.9) return null;
  const bw = 2 * TW - 2 * M, bh = Math.min(bw / it.p.aspect, TH - 2 * M - 20);
  const cost = dpiPenalty(dpiCover(it.p, bw, bh)) - (it.p.aspect >= 2.2 ? 0.6 : 0.15) + (LAYFLAT ? 0 : 0.2);
  return { cost, double: { kind: "pano", item: it } };
}

// Dynamic programme over the chapter's photos in date order: each step places the
// next run of photos on one spread; costs reward good fits and a varied rhythm.
// `usage` counts spread types already used earlier in the book, so chapters vary too.
const titleSpread = (open) => ({ rid: "OT", pages: [{ kind: "opener", chapter: open.chapter, index: open.index }, { kind: "bleed", item: open.opener }] });
function planBody(items, T, prev, open, usage) {
  const N = items.length;
  // Nothing to share the opener spread with: a title page faces the photo instead.
  if (open && N === 0) return { spreads: [titleSpread(open)], last: "OT" };
  if (!N) return { spreads: [], last: prev };
  const MAXC = DENSITY === "full" ? 18 : 2 * DENS.maxGrid;
  const states = Array.from({ length: N + 1 }, () => new Map());
  states[0].set(prev ?? "-", { cost: 0, back: null });
  const memo = new Map();
  for (let i = 0; i < N; i++) {
    const first = !!open && i === 0;
    const recipes = first ? OPEN_RECIPES : PHOTO_FIRST ? COMPACT_RECIPES : RECIPES;
    for (const [pr, st] of states[i]) {
      for (const [rid, rec] of Object.entries(recipes)) {
        for (let c = 1; c <= Math.min(N - i, MAXC); c++) {
          if (c > 1 && items[i + c - 1].break) break;
          const key = `${rid}:${i}:${c}`;
          if (!memo.has(key)) {
            const seg = items.slice(i, i + c);
            memo.set(key, rec.double ? evalDouble(rec.double, seg) : evalSpread(rec.pages, seg, first ? open : {}));
          }
          const ev = memo.get(key);
          if (!ev) continue;
          const cost = st.cost + ev.cost + rhythm(pr, rid, c + (first ? 1 : 0), T, usage);
          const cur = states[i + c].get(rid);
          if (!cur || cost < cur.cost) states[i + c].set(rid, { cost, back: { i, pr, rid, ev } });
        }
      }
    }
  }
  let last = null, fin = null;
  for (const [rid, st] of states[N]) if (!fin || st.cost < fin.cost) { last = rid; fin = st; }
  if (!fin) {
    // The next photo can't share the opener spread (a forced full page or two-page photo):
    // the chapter gets a title page instead, and the rest is planned normally.
    if (!open) return null;
    const rest = planBody(items, T, "OT", null, usage);
    return rest && { spreads: [titleSpread(open), ...rest.spreads], last: rest.last };
  }
  const spreads = [];
  for (let st = fin; st.back; st = states[st.back.i].get(st.back.pr)) spreads.unshift({ rid: st.back.rid, ...st.back.ev });
  return { spreads, last };
}

function pickOpener(its) {
  const hi = its.findIndex((x) => x.hero === true);
  if (hi >= 0) return hi;
  let best = -1, bc = Infinity;
  its.forEach((x, i) => {
    if (x.solo || x.hero === "spread") return;
    const c = bleedCost(x) + (x.p.aspect > 1.9 ? 1 : 0);
    if (c < bc) { bc = c; best = i; }
  });
  return best >= 0 ? best : 0;
}
function planBook(scale) {
  if (PHOTO_FIRST) {
    const usage = new Map();
    let prev = null;
    return chapters.map((chapter, ci) => {
      const spreads = [];
      const scenes = chapter.scenes || [{ title: chapter.title, items: chapter.items }];
      for (const scene of scenes) {
        let selected;
        if (chapter.scenes) {
          for (const [rid, recipe] of Object.entries(COMPACT_RECIPES)) {
            const result = evalSpread(recipe.pages, scene.items);
            if (!result) continue;
            const repeatCost = (prev === rid ? 0.22 : 0) + 0.06 * (usage.get(rid) || 0);
            const totalCost = result.cost + recipe.bias + repeatCost;
            if (!selected || totalCost < selected.cost) {
              selected = { ...result, rid, cost: totalCost };
            }
          }
          const options = makeEditorLayouts(scene.items.map(it => ({
            ...it.p, id: it.p.code, frameId: it.editorId, sceneId: scene.id,
            role: it.role || "support", main: it.role === "main" || !!it.hero,
            protect: it.protect, subject: it.subject, sourceFit: it.fit, sourceFocus: it.focus,
          })), {
            pageWidth: W, pageHeight: H, bleed: B, margin: M, binding: IE, gutter: G,
            direction: RTL ? "rtl" : "ltr", decor: DECOR_MODE, callouts: CALLOUTS,
            showHeadings: SHOW_HEADINGS, spreadIndex: [...usage.values()].reduce((a, b) => a + b, 0),
          });
          if (scene.layout && !options.some(option => option.key === scene.layout)) {
            throw new Error(`Unknown scene layout "${scene.layout}"`);
          }
          for (const option of options) {
            if (!option.available || (!scene.layout &&
                (!["framed-haven", "overlap-story", "center-note-grid"].includes(option.key) ||
                (option.key === "center-note-grid" && (!SHOW_HEADINGS || !scene.title))))) continue;
            if (scene.layout && option.key !== scene.layout) continue;
            const maxArea = Math.max(...option.frames.map(frame => frame.box.w * frame.box.h));
            const main = option.frames.find(frame => frame.role === "main");
            if (!scene.layout && main && main.box.w * main.box.h < maxArea * 0.9) continue;
            const cost = 2 * option.cost + 0.2 + (prev === option.key ? 0.22 : 0) +
              0.06 * (usage.get(option.key) || 0);
            if (!scene.layout && selected && cost >= selected.cost) continue;
            const centered = option.key === "center-note-grid";
            const projectSpread = {
              id: scene.id, chapterId: chapter.id, chapterTitle: chapter.title, title: scene.title,
              layout: option.key, wash: option.wash, frames: option.frames, graphics: option.graphics,
              texts: [
                { id: `${scene.id}-title`, role: "title", text: scene.title || "", box: option.titleBox,
                  fontPt: centered ? 12.5 : 17.9, weight: centered ? 500 : 700,
                  color: theme.ink, align: centered ? "center" : RTL ? "right" : "left", hidden: !SHOW_HEADINGS },
                { id: `${scene.id}-kicker`, role: "kicker", text: chapter.kicker || "", box: option.kickerBox,
                  fontPt: 8.5, weight: 500, color: theme.muted,
                  align: centered ? "center" : RTL ? "right" : "left", hidden: !SHOW_HEADINGS },
                ...option.callouts,
              ],
            };
            selected = { rid: option.key, cost, projectSpread,
              pages: [{ kind: "editor", projectSpread }, { kind: "editor", projectSpread }] };
          }
          if (scene.layout && selected?.rid !== scene.layout) {
            throw new Error(`Scene layout "${scene.layout}" cannot safely hold the selected photographs`);
          }
          if (!selected) throw new Error(`No safe layout for scene "${scene.title}"; use one main photo and 2-9 supporting photos`);
          prev = selected.rid;
          usage.set(selected.rid, (usage.get(selected.rid) || 0) + 1);
          selected.pages.forEach((pg) => {
            pg.scene = scene.title;
            pg.sceneId = scene.id;
            pg.chapterId = chapter.id;
          });
          const host = selected.pages.find((pg) => pg.kind !== "bleed");
          host.heading = { title: scene.title, kicker: chapter.kicker, sceneId: scene.id };
          spreads.push(selected);
        } else {
          const result = planBody(scene.items, DENS.target * scale, null, null, new Map());
          if (!result) throw new Error(`Chapter "${chapter.title}" needs at least two photos, or fewer forced main photos`);
          result.spreads.forEach((spread, index) => {
            const host = spread.pages?.find((pg) => pg.kind !== "bleed");
            if (host && index === 0) host.heading = { title: chapter.title, kicker: chapter.kicker };
          });
          spreads.push(...result.spreads);
        }
      }
      const opener = chapter.items.find((x) => x.hero || x.role === "main") || chapter.items[pickOpener(chapter.items)];
      return { chapter, index: ci + 1, opener, spreads };
    });
  }
  const T = DENS.target * scale;
  const overlay = CHAPTER_STYLE === "overlay";
  const usage = new Map();
  let prev = null;
  return chapters.map((ch, ci) => {
    const its = [...ch.items];
    const opener = its.splice(pickOpener(its), 1)[0];
    const res = planBody(its, T, overlay ? prev : "OPEN", overlay ? { opener, chapter: ch, index: ci + 1, note: ch.note } : null, usage);
    if (!res) throw new Error(`Could not lay out chapter "${ch.title}"`);
    for (const sp of res.spreads) usage.set(sp.rid, (usage.get(sp.rid) || 0) + 1);
    prev = res.last;
    return { chapter: ch, index: ci + 1, opener, spreads: res.spreads };
  });
}
const countPages = (plan) => 2 + plan.reduce((s, c) => s + 2 * c.spreads.length + (CHAPTER_STYLE === "overlay" || PHOTO_FIRST ? 0 : 2), 0);

let scale = 1, plan = planBook(1);
for (const s of [0.85, 0.72, 0.6, 0.5, 0.42, 0.35]) {
  if (PHOTO_FIRST && chapters.some((c) => c.scenes)) break;
  if (countPages(plan) >= MIN_PAGES) break;
  scale = s;
  plan = planBook(s);
}
if (countPages(plan) % MULTIPLE && !(PHOTO_FIRST && chapters.some((c) => c.scenes))) {
  for (const s of [0.93, 1.08, 0.86, 1.16, 0.8, 1.25].map((f) => scale * f)) {
    const p2 = planBook(s);
    if (countPages(p2) % MULTIPLE === 0 && countPages(p2) >= Math.min(MIN_PAGES, countPages(plan))) { plan = p2; break; }
  }
}
let pad = 0;
const editorPageCount = editorProject ? 2 + 2 * editorProject.order.length : null;
if (editorProject && (editorPageCount < MIN_PAGES || editorPageCount % MULTIPLE)) {
  warnings.push(`Book has ${editorPageCount} pages; target is at least ${MIN_PAGES} and a multiple of ${MULTIPLE}. Reorder or add meaningful scenes; no filler pages were inserted.`);
} else if (PHOTO_FIRST && (countPages(plan) < MIN_PAGES || countPages(plan) % MULTIPLE)) {
  warnings.push(`Book has ${countPages(plan)} pages; target is at least ${MIN_PAGES} and a multiple of ${MULTIPLE}. Add meaningful scenes or change the printer target; no filler pages were inserted.`);
} else {
  while (countPages(plan) + pad < MIN_PAGES || (countPages(plan) + pad) % MULTIPLE) pad += 2;
}
if (pad) warnings.push(`${pad} blank pages were added to reach ${MIN_PAGES} pages${MULTIPLE > 2 ? ` (a multiple of ${MULTIPLE})` : ""}; add photos or use "density": "airy" instead`);

const pages = [{ kind: "title" }];
const editorScenePages = new Map();
if (editorProject) {
  const scenes = new Map(chapters.flatMap((chapter) => (chapter.scenes || []).map((scene) => [scene.id, { scene, chapter }])));
  const chapterPlans = new Map(plan.map((chapter) => [chapter.chapter.id, chapter]));
  let page = 2;
  for (const id of editorProject.order) {
    const source = scenes.get(id);
    if (!source) throw new Error(`Editor spread "${id}" no longer exists in album.json`);
    const projectSpread = editorProject.spreads[id];
    const ch = chapterPlans.get(source.chapter.id);
    pages.push(
      { kind: "editor", projectSpread, scene: source.scene, ch },
      { kind: "editor", projectSpread, scene: source.scene, ch },
    );
    editorScenePages.set(id, [page, page + 1]);
    page += 2;
  }
} else {
  for (const c of plan) {
    if (CHAPTER_STYLE !== "overlay" && !PHOTO_FIRST) pages.push({ kind: "opener", chapter: c.chapter, index: c.index }, { kind: "bleed", item: c.opener, ch: c });
    for (const sp of c.spreads) {
      if (sp.projectSpread) editorScenePages.set(sp.projectSpread.id, [pages.length + 1, pages.length + 2]);
      if (sp.double) pages.push({ ...sp.double, ch: c });
      else for (const pg of sp.pages) pages.push({ ...pg, ch: c });
    }
  }
  for (let i = 0; i < pad; i++) pages.push({ kind: "blank" });
}
pages.push({ kind: "closing" });

// ─── accent colours ─────────────────────────────────────────────────────────
// Each chapter takes its accent from the strongest hue in its opening photo.

async function paletteOf(p) {
  const { data } = await sharp(p.decodePath || p.path).rotate().resize(64, 64, { fit: "inside" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const bins = Array.from({ length: 24 }, () => ({ w: 0, s: 0, h: 0 }));
  for (let i = 0; i < data.length; i += 3) {
    const r = data[i] / 255, g = data[i + 1] / 255, b = data[i + 2] / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    if (d < 0.08 || mx < 0.15) continue;
    let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
    const s = d / mx, w = s * mx;
    const bin = bins[Math.min(23, Math.floor(h / 15))];
    bin.w += w; bin.s += s * w; bin.h += h * w;
  }
  const floor = (data.length / 3) * 0.02;
  return bins.filter((b) => b.w >= floor).sort((a, b) => b.w - a.w).map((b) => ({ h: b.h / b.w, s: b.s / b.w, w: b.w }));
}
const hueGap = (a, b) => { const d = Math.abs(a - b) % 360; return Math.min(d, 360 - d); };
// Strongest hue of the photo, unless it repeats the previous chapter's hue and the photo has another clear colour.
function pickHue(pals, prevHue) {
  if (!pals.length) return null;
  if (prevHue == null) return pals[0];
  return pals.find((x) => x.w >= pals[0].w * 0.12 && hueGap(x.h, prevHue) >= 30) || pals[0];
}
function accentFrom(override, pal) {
  if (typeof override === "string" && override.trim()) return { ink: override, deep: override };
  if (!pal) return { ink: "hsl(30 6% 40%)", deep: "hsl(30 6% 26%)" };
  const h = Math.round(pal.h);
  const s = Math.round(Math.min(60, Math.max(34, pal.s * 72)));
  // Deep tones per hue family: oranges stay terracotta (not brown), yellows become mustard, blues navy, greens forest.
  const [inkL, deepL, deepS] =
    h < 40 || h >= 340 ? [42, 41, Math.max(s, 46)] :
    h < 75 ? [34, 38, Math.max(s, 48)] :
    h < 170 ? [32, 27, Math.max(Math.round(s * 0.85), 30)] :
    h < 260 ? [38, 29, Math.max(s, 40)] : [38, 30, Math.round(s * 0.85)];
  return { ink: `hsl(${h} ${s}% ${inkL}%)`, deep: `hsl(${h} ${deepS}% ${deepL}%)`, hue: h };
}
const accents = new Map();
let prevHue = null;
for (const c of plan) {
  const a = accentFrom(c.chapter.accent ?? album.accent, pickHue(await paletteOf(c.opener.p), prevHue));
  accents.set(c.index, a);
  prevHue = a.hue ?? prevHue;
}
const coverAccent = accentFrom(coverSpec.accent ?? album.accent, (await paletteOf(coverItems[0].p))[0]);
const accentOf = (i) => accents.get(i) || coverAccent;

// ─── images: one smart-cropped file per placement ───────────────────────────

const jobs = new Map();
const usages = [];
const textUsages = [];
const editorUsageIds = new Set();
const sourceVersions = new Map();
await Promise.all([...new Set([
  ...chapters.flatMap((c) => c.items), ...coverItems, ...titleItems, closingItem, ...editorItems,
].filter(Boolean).map((it) => it.p.decodePath || it.p.path))].map(async (file) => {
  const stat = await fs.stat(file);
  sourceVersions.set(file, `${stat.size}:${stat.mtimeMs}`);
}));
const focusOf = (f) => {
  const m = String(f).match(/(-?\d+(?:\.\d+)?)%\s+(-?\d+(?:\.\d+)?)%/);
  return m ? [Math.min(1, Math.max(0, m[1] / 100)), Math.min(1, Math.max(0, m[2] / 100))] : null;
};
function queueSafePlacement(it, cell, pageNo, safe, metadata = {}, record = true) {
  const p = it.p;
  const outW = Math.max(1, Math.round(Math.min(safe.crop.width, safe.rect.w / 25.4 * 300)));
  const outH = Math.max(1, Math.round(outW * safe.rect.h / safe.rect.w));
  const source = p.decodePath || p.path;
  const token = createHash("sha256").update(JSON.stringify([
    source, sourceVersions.get(source), safe.crop, outW, outH,
  ])).digest("hex").slice(0, 16);
  const key = `${p.code}-safe-${token}`;
  jobs.set(key, { p, outW, outH, crop: safe.crop, widthMm: safe.rect.w, heightMm: safe.rect.h });
  if (record) {
    usages.push({
      code: p.code, file: p.file, page: pageNo, dpi: Math.round(safe.dpi),
      rect: safe.rect, crop: safe.crop, protection: it.protect, mode: safe.reason,
      sourceSize: { width: p.width, height: p.height }, role: metadata.role ?? it.role,
      box: { ...cell }, frameId: metadata.frameId ?? it.editorId,
      sceneId: metadata.sceneId ?? it.sceneId, spreadBox: metadata.spreadBox,
      fit: metadata.fit,
    });
  }
  return { src: `img/${key}.jpg`, rect: safe.rect, originalBox: cell, code: p.code };
}
function placeImage(it, cell, pageNo) {
  const p = it.p;
  if (PHOTO_FIRST || it.protect || it.fit) {
    const safe = imagePlacement(it, cell);
    return queueSafePlacement(it, cell, pageNo, safe);
  }
  const s = Math.max(cell.w / p.width, cell.h / p.height);   // mm per source px
  const dpi = Math.round(25.4 / s);
  const outW = Math.max(1, Math.round(Math.min((cell.w / 25.4) * 300, cell.w / s)));
  const outH = Math.max(1, Math.round((outW * cell.h) / cell.w));
  const focus = focusOf(it.focus);
  const key = `${p.code}-${outW}x${outH}-${focus ? focus.map((v) => Math.round(v * 100)).join("_") : "auto"}`;
  jobs.set(key, { p, outW, outH, focus, cropW: cell.w / s, cropH: cell.h / s, widthMm: cell.w, heightMm: cell.h });
  usages.push({ code: p.code, file: p.file, page: pageNo, dpi });
  return `img/${key}.jpg`;
}

function placeEditorFrame(frame, sceneId, pageNo) {
  const it = item(frame.photo, false);
  if (!it) throw new Error(`Editor frame "${frame.id}" uses unknown photo "${frame.photo}"`);
  const photo = {
    id: it.p.code,
    width: it.p.width,
    height: it.p.height,
    what: it.p.vision?.what,
    protect: it.protect,
    subject: it.subject,
    sourceFit: it.fit,
    sourceFocus: it.focus,
  };
  const safe = resolveFramePlacement(photo, frame);
  for (const message of placementWarnings(photo, safe, { pageWidth: W, binding: IE })) {
    const warning = `${frame.id}: ${message}`;
    if (!warnings.includes(warning)) warnings.push(warning);
  }
  const record = !editorUsageIds.has(frame.id);
  editorUsageIds.add(frame.id);
  const pages = editorScenePages.get(sceneId) || [pageNo, pageNo + 1];
  const evidencePage = safe.rect.x + safe.rect.w / 2 < W
    ? pages.find((page) => physLeft(page)) ?? pages[0]
    : pages.find((page) => !physLeft(page)) ?? pages.at(-1);
  return queueSafePlacement(it, frame.box, evidencePage, safe, {
    frameId: frame.id,
    sceneId,
    spreadBox: { ...frame.box },
    role: frame.role,
    fit: frame.fit,
  }, record);
}

// ─── html ───────────────────────────────────────────────────────────────────

const mm = (v) => `${v.toFixed(2)}mm`;
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const dirOf = (s) => (/[\u0590-\u05FF]/.test(s || "") || RTL ? "rtl" : "ltr");
const box = (r) => `left:${mm(r.x)};top:${mm(r.y)};width:${mm(r.w)};height:${mm(r.h)}`;
const start = RTL ? "right" : "left";
const img = (placement, r, cls = "") => {
  if (typeof placement === "string") return `<img class="ph ${cls}" src="${placement}" style="${box(r)}">`;
  const actual = { ...placement.rect,
    x: placement.rect.x + r.x - placement.originalBox.x,
    y: placement.rect.y + r.y - placement.originalBox.y };
  return `<img class="ph ${cls}" alt="${esc(placement.code)}" data-photo="${esc(placement.code)}" src="${placement.src}" style="${box(actual)}">`;
};
const section = (body, bg) => `<section class="page"${bg ? ` style="background:${bg}"` : ""}>${body}</section>`;
const num2 = (n) => String(n).padStart(2, "0");

const LOCALE = album.locale || (RTL ? "he-IL" : "en-GB");
const HE = LOCALE.startsWith("he");
const WORDS = { photographs: HE ? "תמונות" : "photographs", inThisBook: HE ? "בספר הזה" : "In this book" };
const DMY = { day: "numeric", month: "long", year: "numeric" }, DM = { day: "numeric", month: "long" };
const fmtDay = (iso, o = DMY) => new Date(iso.slice(0, 10) + "T12:00:00").toLocaleDateString(LOCALE, o);
const allUsed = [...used].map((c) => byKey.get(c)).sort((a, b) => a.date.localeCompare(b.date));
const dateLine = album.dates || (allUsed.length ? (fmtDay(allUsed[0].date) === fmtDay(allUsed.at(-1).date) ? fmtDay(allUsed[0].date) : `${fmtDay(allUsed[0].date)} – ${fmtDay(allUsed.at(-1).date)}`) : "");
function chapterDates(c) {
  const ds = c.chapter.items.map((x) => x.p.date).sort();
  if (!ds.length) return "";
  const a = fmtDay(ds[0], DM), b = fmtDay(ds.at(-1), DM);
  return a === b ? a : `${a} – ${b}`;
}

function fitText(text, w, h, max, min = 3, k = 0.56, lh = 1.5) {
  for (let fs = max; fs >= min; fs -= 0.2) {
    const perLine = Math.max(1, Math.floor(w / (fs * k)));
    const lines = text.split(/\n/).reduce((n, para) => n + Math.max(1, Math.ceil(para.length / perLine)), 0);
    if (lines * fs * lh <= h) return fs;
  }
  return min;
}
const textBlock = (cell, text) => {
  const pad = Math.min(8, cell.w * 0.08);
  const fs = fitText(text, cell.w - 2 * pad, cell.h - 2 * pad, 6);
  return `<div class="block" dir="${dirOf(text)}" style="${box(cell)};padding:${mm(pad)};font-size:${mm(fs)}"><div>${esc(text)}</div></div>`;
};
const titleBlock = (cell, title, sub, subColor) => {
  const pad = Math.min(10, cell.w * 0.09);
  const fs = Math.min(cell.w * 0.22, (cell.w - 2 * pad) / Math.max(3, title.length * 0.62));
  return `<div class="titleblock" dir="${dirOf(title)}" style="${box(cell)};padding:${mm(pad)}"><div class="big" style="font-size:${mm(fs)}">${esc(title)}</div>${sub ? `<div class="kick"${subColor ? ` style="color:${subColor}"` : ""}>${esc(sub)}</div>` : ""}</div>`;
};
const caption = (cell, text) => `<div class="cap" dir="${dirOf(text)}" style="${start}:${mm((RTL ? W - cell.x - cell.w : cell.x) + 4)};top:${mm(cell.y + cell.h - 9)};max-width:${mm(cell.w - 8)}">${esc(text)}</div>`;
const overlayTitle = (title, kicker) => {
  const avail = TW - 2 * SAFE;
  const fs = Math.min(24, avail / Math.max(4, title.length * 0.74));
  return `<div class="shade"></div><div class="overlay" dir="${dirOf(title)}" style="${start}:${mm(B + SAFE)};bottom:${mm(B + SAFE)};width:${mm(avail)}">` +
    (kicker ? `<div class="kick" style="margin-bottom:3mm">${esc(kicker)}</div>` : "") + `<div class="chap" style="font-size:${mm(fs)}">${esc(title)}</div></div>`;
};
// Small running footer at the outer bottom corner: page number + book or chapter title.
function folio(no, pg) {
  if (!FOLIOS) return "";
  const left = physLeft(no);
  const label = SHOW_HEADINGS ? (left ? album.title : pg.ch?.chapter.title) || "" : "";
  const rtlText = dirOf(label) === "rtl";
  const text = left !== rtlText ? `${no}\u2003${label}` : `${label}\u2003${no}`;
  return `<div class="folio" dir="${dirOf(label)}" style="${left ? "left" : "right"}:${mm(B + M)};bottom:${mm(B + 4.5)}">${esc(text)}</div>`;
}

function compactHeading(pg, no) {
  if (!pg.heading) return "";
  const bx = contentBox(no);
  if (pg.heading.sceneId) {
    const shift = physLeft(no) ? 0 : W;
    const titleBox = { x: shift + bx.x, y: B + M + 6.1, w: bx.w, h: 9 };
    const kickerBox = { x: shift + bx.x, y: B + M, w: bx.w, h: 4 };
    textUsages.push(
      {
        id: `${pg.heading.sceneId}-kicker`, sceneId: pg.heading.sceneId, role: "kicker",
        text: pg.heading.kicker || "", box: kickerBox, fontPt: 8.5, weight: 500,
        color: theme.muted, align: RTL ? "right" : "left",
        hidden: !SHOW_HEADINGS,
      },
      {
        id: `${pg.heading.sceneId}-title`, sceneId: pg.heading.sceneId, role: "title",
        text: pg.heading.title || "", box: titleBox, fontPt: 17.9, weight: 700,
        color: theme.ink, align: RTL ? "right" : "left",
        hidden: !SHOW_HEADINGS,
      },
    );
  }
  if (!SHOW_HEADINGS) return "";
  return `<div class="compact-heading" dir="${dirOf(pg.heading.title)}" style="left:${mm(bx.x)};top:${mm(B + M)};width:${mm(bx.w)}">` +
    `<div class="compact-date">${esc(pg.heading.kicker || "")}</div>` +
    `<div class="compact-title">${esc(pg.heading.title || "")}</div></div>`;
}

function titleHtml(no) {
  const ttl = album.title || "", sub = album.subtitle || "";
  if (titleItems.length >= 3) {
    const cells = cellsOf(TITLE_TEMPLATE, contentBox(no));
    let k = 0;
    return section(cells.map((c) => (c.text ? titleBlock(c, ttl, sub || dateLine, coverAccent.ink) : img(placeImage(titleItems[k++], c, no), c))).join(""));
  }
  const meta = [album.author, dateLine].filter(Boolean).join("  ·  ");
  if (PHOTO_FIRST && titleItems.length === 1) {
    const bx = { x: B + M, y: B + M, w: TW - 2 * M, h: TH - 2 * M - 32 };
    return section(img(placeImage(titleItems[0], bx, no), bx) +
      `<div class="photo-title" dir="${dirOf(ttl)}" style="${start}:${mm(B + M)};bottom:${mm(B + M)};width:${mm(TW - 2 * M)}">` +
      `<div class="big" style="font-size:14mm">${esc(ttl)}</div><div class="compact-date" style="margin-top:3mm">${esc(sub || meta)}</div></div>`);
  }
  if (titleItems.length === 1) {
    const it = titleItems[0], fb = frameBox(no);
    const area = { x: fb.x, y: B + TH * 0.12, w: fb.w, h: TH * 0.5 };
    const { w, h } = fitIn(it.p, area);
    const r = { x: area.x + (area.w - w) / 2, y: area.y + area.h - h, w, h };
    const tw = Math.max(w, TW * 0.5);
    const fs = Math.min(22, tw / Math.max(3, ttl.length * 0.62));
    const edge = mm(RTL ? W - (r.x + w) : r.x);
    return section(img(placeImage(it, r, no), r) +
      `<div class="titleunder" dir="${dirOf(ttl)}" style="${start}:${edge};top:${mm(r.y + h + 12)};width:${mm(tw)}"><div class="big" style="font-size:${mm(fs)}">${esc(ttl)}</div>` +
      (sub ? `<div class="kick" style="margin-top:5mm;color:${coverAccent.ink}">${esc(sub)}</div>` : "") + `</div>` +
      `<div class="meta" dir="${dirOf(meta)}" style="${start}:${edge};bottom:${mm(B + SAFE)}">${esc(meta)}</div>`);
  }
  const avail = TW - 2 * SAFE;
  const fs = Math.min(34, avail / Math.max(3, ttl.length * 0.62));
  return section(`<div class="overlay ink" dir="${dirOf(ttl)}" style="${start}:${mm(B + SAFE)};bottom:${mm(B + TH * 0.38)};width:${mm(avail)}"><div class="big" style="font-size:${mm(fs)}">${esc(ttl)}</div>` +
    (sub ? `<div class="kick" style="margin-top:5mm;color:${coverAccent.ink}">${esc(sub)}</div>` : "") + `</div>` +
    `<div class="meta" dir="${dirOf(meta)}" style="${start}:${mm(B + SAFE)};bottom:${mm(B + SAFE)}">${esc(meta)}</div>`);
}

function openerHtml(pg) {
  const ch = pg.chapter, acc = accentOf(pg.index);
  const color = CHAPTER_STYLE === "color";
  const hint = color ? "rgba(255,255,255,.78)" : acc.ink;
  const soft = color ? "rgba(255,255,255,.86)" : theme.muted;
  const x = B + 26, avail = TW - 52;
  const title = ch.title || "";
  const tfs = Math.min(17, avail / Math.max(4, title.length * 0.74));
  return section(
    `<div class="numeral" style="${start}:${mm(x - 3)};top:${mm(B + 18)};color:${hint}">${num2(pg.index)}</div>` +
    `<div class="openblock" dir="${dirOf(title)}" style="${start}:${mm(x)};bottom:${mm(B + 26)};width:${mm(avail)}">` +
    (ch.kicker ? `<div class="kick" style="color:${hint}">${esc(ch.kicker)}</div>` : "") +
    `<div class="rule" style="background:${hint}"></div>` +
    `<div class="chap" style="font-size:${mm(tfs)};color:${color ? "#fff" : theme.ink}">${esc(title)}</div>` +
    (ch.note ? `<div class="note" style="color:${soft}">${esc(ch.note)}</div>` : "") +
    `</div>`, color ? acc.deep : null);
}

function bleedHtml(pg, no) {
  let s = img(placeImage(pg.item, BLEED_BOX, no), BLEED_BOX);
  if (pg.kind === "openerBleed") s += overlayTitle(pg.chapter.title || "", [num2(pg.index), pg.chapter.kicker].filter(Boolean).join("  ·  "));
  else if (pg.item.caption) {
    s += `<div class="cap" dir="${dirOf(pg.item.caption)}" style="${physLeft(no) ? "left" : "right"}:${mm(B + SAFE)};bottom:${mm(B + SAFE - 4)}">${esc(pg.item.caption)}</div>`;
  }
  return section(s);
}

function frameHtml(pg, no) {
  if (PHOTO_FIRST) {
    const bx = frameBox(no);
    let body = img(placeImage(pg.item, bx, no), bx);
    if (pg.item.caption) body += `<div class="capline" dir="${dirOf(pg.item.caption)}" style="left:${mm(bx.x)};width:${mm(bx.w)};top:${mm(bx.y + bx.h + 2)}">${esc(pg.item.caption)}</div>`;
    return section(body + compactHeading(pg, no) + folio(no, pg));
  }
  const bx = frameBox(no);
  let { w, h } = fitIn(pg.item.p, bx);
  if (pg.pairH && pg.pairH < h) { h = pg.pairH; w = h * pg.item.p.aspect; }
  const r = { x: bx.x + (bx.w - w) / 2, y: bx.y + (bx.h - h) / 2, w, h };
  let s = img(placeImage(pg.item, r, no), r);
  const cap = pg.item.caption;
  if (cap) s += `<div class="capline" dir="${dirOf(cap)}" style="left:${mm(r.x)};top:${mm(r.y + h + 4)};width:${mm(w)};text-align:${start}">${esc(cap)}</div>`;
  return section(s + folio(no, pg));
}

let lastTpl = null;
function gridHtml(pg, no) {
  const bleed = pg.kind === "gridBleed";
  const bx = bleed ? BLEED_BOX : contentBox(no);
  const pick = chooseTemplate(pg.items, bx, { text: !!pg.note, avoid: lastTpl }) || chooseTemplate(pg.items, bx, { avoid: lastTpl });
  lastTpl = pick.tpl[0];
  let k = 0, s = "";
  for (const cell of pick.cells) {
    if (cell.text) { s += textBlock(cell, pg.note); continue; }
    const it = pick.order[k++];
    s += img(placeImage(it, cell, no), cell);
    if (it.caption && cell.w > 60) s += caption(cell, it.caption);
  }
  return section(s + compactHeading(pg, no) + (bleed ? "" : folio(no, pg)));
}

function editorTextHtml(text, offset) {
  if (text.hidden) return "";
  const rect = { ...text.box, x: text.box.x - offset };
  const align = ["left", "center", "right"].includes(text.align) ? text.align : "left";
  const color = /^#[0-9a-f]{6}$/i.test(text.color || "") ? text.color : theme.ink;
  const scriptCls = text.fontStyle === "script" ? " script-text" : "";
  return `<div class="editor-text${scriptCls}" data-text-id="${esc(text.id)}" dir="${dirOf(text.text)}" style="${box(rect)};font-size:${Number(text.fontPt).toFixed(2)}pt;font-weight:${Math.round(text.weight || 500)};color:${color};text-align:${align}">${esc(text.text || "")}</div>`;
}

function editorGraphicHtml(graphic, offset) {
  if (graphic.hidden || !GRAPHICS[graphic.kind]) return "";
  const rect = { ...graphic.box, x: graphic.box.x - offset };
  return `<div class="editor-graphic" data-graphic-id="${esc(graphic.id)}" data-graphic-kind="${esc(graphic.kind)}" style="${box(rect)}">${graphicSvgMarkup(graphic)}</div>`;
}

function pageWashHtml(washKey, side) {
  if (!washKey || washKey === "none") return "";
  const svg = washSvgMarkup(washKey, side);
  return svg ? `<div class="page-wash" data-wash="${esc(washKey)}">${svg}</div>` : "";
}

function editorSpreadHtml(pg, no) {
  const spread = pg.projectSpread;
  const leftSide = physLeft(no);
  const side = leftSide ? "left" : "right";
  const offset = leftSide ? 0 : W;
  let body = pageWashHtml(spread.wash?.[side], side);
  for (const frame of spread.frames) {
    if (frame.hidden) continue;
    const placement = placeEditorFrame(frame, spread.id, no);
    body += img(placement, { ...frame.box, x: frame.box.x - offset }, frame.mat ? "mat" : "");
  }
  body += (spread.graphics || []).map((graphic) => editorGraphicHtml(graphic, offset)).join("");
  body += spread.texts.map((text) => editorTextHtml(text, offset)).join("");
  return section(body + folio(no, pg));
}

// A band is a row of photos sharing one height with the facing page's row; both
// rows sit against the binding so the spread reads as one strip.
function bandHtml(pg, no) {
  const bx = contentBox(no), h = pg.bandH;
  const rowW = pg.items.reduce((s, x) => s + h * x.p.aspect, 0) + G * (pg.items.length - 1);
  let x = physLeft(no) ? bx.x + bx.w - rowW : bx.x;
  const y = bx.y + (bx.h - h) / 2;
  let s = "";
  for (const it of RTL ? [...pg.items].reverse() : pg.items) {
    const r = { x, y, w: h * it.p.aspect, h };
    s += img(placeImage(it, r, no), r);
    x += r.w + G;
  }
  return section(s + folio(no, pg));
}

// One picture across both pages: drawn on a spread-wide canvas, each page shows its half.
function doubleHtml(pg, no) {
  const left = physLeft(no), it = pg.item;
  let rect;
  if (pg.kind === "spread") rect = { x: 0, y: 0, w: 2 * TW + 2 * B, h: H };
  else {
    const bw = 2 * TW - 2 * M, bh = Math.min(bw / it.p.aspect, TH - 2 * M - 20);
    rect = { x: B + M, y: B + (TH - bh) / 2, w: bw, h: bh };
  }
  let s = img(placeImage(it, rect, no), { ...rect, x: rect.x - (left ? 0 : TW) });
  if (pg.kind === "pano" && it.caption && !left) {
    s += `<div class="capline" dir="${dirOf(it.caption)}" style="right:${mm(B + M)};top:${mm(rect.y + rect.h + 4)};text-align:right">${esc(it.caption)}</div>`;
  }
  return section(s);
}

function closingHtml(no) {
  const bx = contentBox(no);
  const meta = `${used.size} ${WORDS.photographs}  ·  ${dateLine}`;
  const metaDiv = `<div class="meta" dir="${dirOf(meta)}" style="left:${mm(bx.x)};width:${mm(bx.w)};text-align:center;bottom:${mm(B + M)}">${esc(meta)}</div>`;
  const text = album.closing?.text;
  const closeText = (top) => (text ? `<div class="closetext" dir="${dirOf(text)}" style="left:${mm(bx.x + 20)};width:${mm(bx.w - 40)};top:${mm(top)}">${esc(text)}</div>` : "");
  if (PHOTO_FIRST) {
    const lastEditedFrame = editorProject
      ? [...editorProject.order].reverse().flatMap((id) => [...editorProject.spreads[id].frames].reverse()).find((frame) => !frame.hidden)
      : null;
    const finalPhoto = closingItem || (lastEditedFrame ? item(lastEditedFrame.photo, false) : chapters.at(-1).items.at(-1));
    const area = { x: B + M, y: B + M, w: TW - 2 * M, h: TH - 2 * M - 18 };
    return section(img(placeImage(finalPhoto, area, no), area) +
      `<div class="compact-date" dir="${dirOf(text || dateLine)}" style="left:${mm(bx.x)};width:${mm(bx.w)};text-align:center;bottom:${mm(B + M)}">${esc(text || dateLine)}</div>`);
  }
  if (closingItem) {
    const area = { x: bx.x + 20, y: bx.y + 16, w: bx.w - 40, h: bx.h * 0.6 };
    const { w, h } = fitIn(closingItem.p, area);
    const r = { x: area.x + (area.w - w) / 2, y: area.y + (area.h - h) / 2, w, h };
    return section(img(placeImage(closingItem, r, no), r) + closeText(r.y + h + 16) + metaDiv);
  }
  if (plan.length < 2) return section(closeText(B + TH * 0.42) + metaDiv);
  // "In this book": one circle per chapter, cropped from its opening photo.
  const n = plan.length;
  const cols = n <= 3 ? n : n === 4 ? 2 : n <= 6 ? 3 : 4;
  const rows = Math.ceil(n / cols);
  const head = 34, foot = text ? 46 : 22, label = 22;
  const area = { x: bx.x, y: bx.y + head, w: bx.w, h: bx.h - head - foot };
  const cw = area.w / cols, chh = area.h / rows;
  const d = Math.min(cw - 18, chh - label - 8, 92);
  const heading = album.closing?.label || WORDS.inThisBook;
  let s = `<div class="kick" dir="${dirOf(heading)}" style="left:${mm(bx.x)};width:${mm(bx.w)};text-align:center;top:${mm(bx.y + 4)};color:${coverAccent.ink}">${esc(heading)}</div>` +
    `<div class="idxtitle" dir="${dirOf(album.title)}" style="left:${mm(bx.x)};width:${mm(bx.w)};text-align:center;top:${mm(bx.y + 11)}">${esc(album.title || "")}</div>`;
  plan.forEach((c, k) => {
    const col = k % cols, row = Math.floor(k / cols);
    const offset = ((cols - Math.min(cols, n - row * cols)) * cw) / 2;
    const cx = area.x + (RTL ? area.w - offset - cw * (col + 0.5) : offset + cw * (col + 0.5));
    const top = area.y + chh * row + (chh - d - label) / 2;
    const r = { x: cx - d / 2, y: top, w: d, h: d };
    const title = c.chapter.title || "";
    s += img(placeImage(c.opener, r, no), r, "round") +
      `<div class="idx" dir="${dirOf(title)}" style="left:${mm(cx - cw / 2)};top:${mm(top + d + 4)};width:${mm(cw)}">` +
      `<div class="idxnum" style="color:${accentOf(c.index).ink}">${num2(c.index)}</div><div class="idxname">${esc(title)}</div><div class="idxdate">${esc(chapterDates(c))}</div></div>`;
  });
  return section(s + closeText(B + TH - M - foot + 8) + metaDiv);
}

function pageHtml(pg, no) {
  switch (pg.kind) {
    case "title": return titleHtml(no);
    case "opener": return openerHtml(pg);
    case "bleed": case "openerBleed": return bleedHtml(pg, no);
    case "frame": return frameHtml(pg, no);
    case "grid": case "gridBleed": return gridHtml(pg, no);
    case "band": return bandHtml(pg, no);
    case "pano": case "spread": return doubleHtml(pg, no);
    case "editor": return editorSpreadHtml(pg, no);
    case "closing": return closingHtml(no);
    default: return section("");
  }
}

const interior = [];
const kindAt = [];
let no = 1;
for (const pg of pages) {
  if (pg.kind === "pano" || pg.kind === "spread") {
    if (no % 2) warnings.push(`page ${no}: a two-page picture starts on a right-hand page`);
    interior.push(pageHtml(pg, no), pageHtml(pg, no + 1));
    kindAt[no] = kindAt[no + 1] = pg.kind;
    no += 2;
  } else {
    kindAt[no] = pg.kind;
    interior.push(pageHtml(pg, no++));
  }
}
const totalPages = no - 1;
const fullBleed = new Set(["bleed", "openerBleed"]);
for (let n = 2; n < totalPages; n += 2)
  if (fullBleed.has(kindAt[n]) && fullBleed.has(kindAt[n + 1])) warnings.push(`pages ${n}–${n + 1}: two full-page photos face each other`);

function coverHtml() {
  const ttl = album.title || "", sub = album.subtitle || dateLine;
  const style = coverSpec.style || (PHOTO_FIRST ? (coverItems.length >= 3 ? "collage" : "photo") : (coverItems.length >= 3 ? "grid" : "color"));
  const craftedCover = PHOTO_FIRST && DECOR_MODE === "crafted" && theme === THEMES.white;
  const coverWash = craftedCover ? pageWashHtml(coverSpec.wash || "sky", "left") : "";
  const coverMat = craftedCover ? "mat" : "";
  if (style === "collage") {
    if (coverItems.length !== 3) throw new Error("A collage cover needs exactly three photos");
    const bx = { x: B + M, y: B + M, w: TW - 2 * M, h: TH - 2 * M };
    const mainW = Math.min((bx.w - G) * 0.72, Math.max((bx.w - G) * 0.58, bx.h * coverItems[0].p.aspect));
    const sideW = bx.w - mainW - G;
    const headingH = bx.h * 0.29;
    const photoH = (bx.h - headingH - 2 * G) / 2;
    let cells = [
      { x: bx.x, y: bx.y, w: mainW, h: bx.h },
      { x: bx.x + mainW + G, y: bx.y + headingH + G, w: sideW, h: photoH },
      { x: bx.x + mainW + G, y: bx.y + headingH + 2 * G + photoH, w: sideW, h: photoH },
    ];
    let titleCell = { x: bx.x + mainW + G, y: bx.y, w: sideW, h: headingH };
    if (coverItems[0].p.aspect > 1.1) {
      const titleH = Math.min(36, bx.h * 0.16);
      const imageH = bx.h - titleH - G;
      const mainH = (imageH - G) * 0.62;
      const supportW = (bx.w - G) / 2;
      titleCell = { x: bx.x, y: bx.y, w: bx.w, h: titleH };
      cells = [
        { x: bx.x, y: bx.y + titleH + G, w: bx.w, h: mainH },
        { x: bx.x, y: bx.y + titleH + 2 * G + mainH, w: supportW, h: imageH - mainH - G },
        { x: bx.x + supportW + G, y: bx.y + titleH + 2 * G + mainH, w: supportW, h: imageH - mainH - G },
      ];
    }
    if (RTL) for (const cell of [...cells, titleCell]) cell.x = W - cell.x - cell.w;
    const titleSize = fitText(ttl.toUpperCase(), titleCell.w - 4, titleCell.h - (sub ? 12 : 4), 15, 6, 0.72, 1.05);
    const flourish = craftedCover && titleCell.h >= 60
      ? `<div class="cover-flourish">${graphicSvgMarkup({ kind: "flourish-scroll", color: theme.ink })}</div>`
      : "";
    return section(coverWash + cells.map((cell, i) => img(placeImage(coverItems[i], cell, "cover"), cell, coverMat)).join("") +
      `<div class="cover-collage-title" dir="${dirOf(ttl)}" style="${box(titleCell)}"><div style="font-size:${mm(titleSize)}">${esc(ttl)}</div>` +
      `<span>${esc(sub)}</span>${flourish}</div>`);
  }
  if (style === "photo") {
    const area = { x: B + M, y: B + M + 24, w: TW - 2 * M, h: TH - 2 * M - 24 };
    const flourish = craftedCover
      ? `<div class="editor-graphic" style="left:${mm(B + M)};top:${mm(B + M + 15)};width:38mm;height:9mm">${graphicSvgMarkup({ kind: "flourish-scroll", color: theme.ink })}</div>`
      : "";
    return section(coverWash + img(placeImage(coverItems[0], area, "cover"), area, coverMat) + flourish +
      `<div class="compact-heading" dir="${dirOf(ttl)}" style="${start}:${mm(B + M)};top:${mm(B + M)};width:${mm(TW - 2 * M)}"><div class="big" style="font-size:12mm">${esc(ttl)}</div><div class="compact-date" style="margin-top:3mm">${esc(sub)}</div></div>`);
  }
  if (style === "grid" && coverItems.length >= 3) {
    const cells = cellsOf(TITLE_TEMPLATE, { x: B + M, y: B + M, w: TW - 2 * M, h: TH - 2 * M });
    let k = 0;
    return section(cells.map((c) => (c.text ? titleBlock(c, ttl, sub, coverAccent.ink) : img(placeImage(coverItems[k++], c, "cover"), c))).join(""));
  }
  const it = { ...coverItems[0], focus: coverSpec.focus ?? coverItems[0].focus };
  if (style === "color") {
    // Colour-block cover: accent background, bold title top corner, photo inset bottom corner.
    const padC = 22;
    const pr = { x: RTL ? B + padC : B + TW * 0.3, y: B + TH * 0.36, w: TW * 0.7 - padC, h: TH * 0.64 - padC };
    const fs = Math.min(30, (TW - 2 * padC) / Math.max(3, ttl.length * 0.68));
    const meta = [album.author, (allUsed[0]?.date || "").slice(0, 4)].filter(Boolean).join("  ·  ");
    return section(img(placeImage(it, pr, "cover"), pr) +
      `<div class="overlay" dir="${dirOf(ttl)}" style="${start}:${mm(B + padC)};top:${mm(B + padC)};width:${mm(TW - 2 * padC)}"><div class="big" style="font-size:${mm(fs)}">${esc(ttl)}</div>` +
      (sub ? `<div class="kick" style="margin-top:5mm;opacity:.85">${esc(sub)}</div>` : "") + `</div>` +
      (meta ? `<div class="meta" dir="${dirOf(meta)}" style="${start}:${mm(B + padC)};bottom:${mm(B + padC)};color:rgba(255,255,255,.8);width:${mm(TW * 0.3 - padC - 6)}">${esc(meta)}</div>` : ""),
      coverAccent.deep);
  }
  return section(img(placeImage(it, BLEED_BOX, "cover"), BLEED_BOX) + overlayTitle(ttl, sub));
}
const coverSection = coverHtml();

// ─── write html ─────────────────────────────────────────────────────────────

const font = (fam, file) => `@font-face{font-family:'${fam}';src:url('${pathToFileURL(path.join(FONTS, file)).href}');font-weight:100 900;}`;
const css = `
${font("Montserrat", "Montserrat.ttf")}
${font("Heebo", "Heebo.ttf")}
@page{size:${W}mm ${H}mm;margin:0}
html,body{margin:0;padding:0}
body{background:${theme.bg};color:${theme.ink};font-family:'${BOOK_FONT}','Montserrat','Heebo',sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.page{position:relative;width:${W}mm;height:${H}mm;overflow:hidden;contain:strict;background:${theme.bg};break-after:page}
.page:last-child{break-after:auto}
.page>*{position:absolute;z-index:1}
.page-wash{left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:0}
.page-wash svg{width:100%;height:100%;display:block}
.ph{display:block;object-fit:cover}
.ph.mat{box-sizing:border-box;border:2.4mm solid #ffffff;box-shadow:0 1.2mm 4mm rgba(20,16,14,.10)}
.ph.round{border-radius:50%}
.shade{left:0;right:0;bottom:0;height:42%;background:linear-gradient(to top,rgba(0,0,0,.42),rgba(0,0,0,0))}
.overlay{color:#fff}
.overlay.ink{color:${theme.ink}}
.numeral{font-weight:200;font-size:72mm;line-height:.8;letter-spacing:-.04em}
.openblock{display:flex;flex-direction:column;align-items:flex-start}
.openblock .kick{margin-bottom:5mm}
.rule{width:16mm;height:.6mm;margin-bottom:6mm}
.chap{font-weight:800;text-transform:uppercase;letter-spacing:.005em;line-height:.98}
.note{font-weight:400;font-size:4.8mm;line-height:1.55;margin-top:7mm;max-width:165mm}
.big{font-weight:800;letter-spacing:-.02em;line-height:.92}
.kick{font-weight:600;font-size:3.2mm;letter-spacing:.26em;text-transform:uppercase}
.meta{font-weight:500;font-size:2.9mm;letter-spacing:.2em;text-transform:uppercase;color:${theme.muted}}
.folio{font-weight:500;font-size:2.3mm;letter-spacing:.22em;text-transform:uppercase;color:${theme.muted};white-space:nowrap}
.capline{font-weight:500;font-size:2.7mm;letter-spacing:.14em;text-transform:uppercase;color:${theme.muted}}
.cap{font-weight:600;font-size:2.8mm;letter-spacing:.12em;text-transform:uppercase;color:#fff;text-shadow:0 0 3mm rgba(0,0,0,.55)}
.block{box-sizing:border-box;display:flex;align-items:center;font-weight:500;line-height:1.5;color:${theme.ink};white-space:pre-line}
.titleblock{box-sizing:border-box;display:flex;flex-direction:column;justify-content:flex-end;color:${theme.ink}}
.titleblock .kick{margin:4mm 0 0;color:${theme.muted}}
.titleunder{color:${theme.ink}}
.idx{text-align:center;color:${theme.ink}}
.idxnum{font-weight:300;font-size:5.5mm;line-height:1}
.idxname{font-weight:800;font-size:3.6mm;letter-spacing:.06em;text-transform:uppercase;margin-top:2mm}
.idxdate{font-weight:500;font-size:2.5mm;letter-spacing:.16em;text-transform:uppercase;color:${theme.muted};margin-top:1.5mm}
.idxtitle{font-weight:800;font-size:9mm;letter-spacing:-.01em;line-height:1;color:${theme.ink}}
.closetext{font-weight:600;font-size:4.6mm;line-height:1.45;text-align:center;color:${theme.ink}}
.compact-heading{color:${theme.ink};height:16mm}
.compact-date{font-weight:500;font-size:3mm;line-height:1.3;letter-spacing:.08em;text-transform:uppercase;color:${theme.muted}}
.compact-title{font-weight:700;font-size:6.3mm;line-height:1.1;margin-top:2.2mm;letter-spacing:-.02em}
.cover-collage-title{display:flex;flex-direction:column;justify-content:center;box-sizing:border-box;padding:2mm;color:${theme.ink};font-weight:800;line-height:.98;letter-spacing:-.035em;text-transform:uppercase}
.cover-collage-title span{display:block;font-size:3.1mm;font-weight:500;letter-spacing:.12em;line-height:1.4;margin-top:6mm}
.cover-flourish{width:42mm;height:10mm;margin-top:4mm}
.cover-flourish svg{width:100%;height:100%;display:block}
.editor-text{box-sizing:border-box;white-space:pre-wrap;overflow:hidden;line-height:1.2;z-index:3}
.editor-text.script-text{font-family:'Segoe Script','Brush Script MT','Snell Roundhand','Apple Chancery','Heebo',cursive;font-style:italic;line-height:1.15}
.editor-graphic{pointer-events:none;z-index:3}
.editor-graphic svg{width:100%;height:100%;display:block}
[dir=rtl],[dir=rtl] *{letter-spacing:0!important}
@media screen{body{background:#666}.page{margin:0 0 4mm}}
`;
const doc = (body) => `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${body}</body></html>`;

const autoSceneDecor = new Map();
if (!editorProject && PHOTO_FIRST) {
  let scenePage = 2;
  let spreadIndex = 0;
  for (const chapter of plan) {
    for (const spread of chapter.spreads) {
      const pageObjects = spread.pages || [];
      const sceneId = pageObjects.find((page) => page.sceneId)?.sceneId;
      if (spread.projectSpread) {
        autoSceneDecor.set(sceneId, spread.projectSpread);
        scenePage += 2;
        spreadIndex++;
        continue;
      }
      if (sceneId) {
        const frames = [...new Map(usages
          .filter((usage) => usage.sceneId === sceneId && usage.frameId)
          .map((usage) => [usage.frameId, {
            id: usage.frameId,
            photo: usage.code,
            role: usage.role,
            page: usage.page,
            box: {
              ...usage.box,
              x: usage.spreadBox ? usage.box.x : usage.box.x + (physLeft(usage.page) ? 0 : W),
            },
          }])).values()];
        const baseTexts = textUsages.filter((text) => text.sceneId === sceneId);
        const decor = buildSpreadDecor({
          sceneId,
          index: spreadIndex,
          recipe: spread.rid,
          frames,
          texts: baseTexts,
          spec: { pageWidth: W, pageHeight: H, bleed: B, margin: M, binding: IE, gutter: G },
          direction: RTL ? "rtl" : "ltr",
          decor: DECOR_MODE,
          callouts: CALLOUTS,
        });
        autoSceneDecor.set(sceneId, decor);
        for (const pageNo of [scenePage, scenePage + 1]) {
          const leftSide = physLeft(pageNo);
          const side = leftSide ? "left" : "right";
          const offset = leftSide ? 0 : W;
          let html = interior[pageNo - 1];
          const washMarkup = pageWashHtml(decor.wash?.[side], side);
          if (washMarkup) html = html.replace('<section class="page">', `<section class="page">${washMarkup}`);
          for (const frame of decor.frames) {
            if (frame.mat) {
              html = html.replace(new RegExp(`(<img class="ph )(" alt="${esc(frame.photo)}")`), `$1mat$2`);
            }
          }
          const extraGraphics = (decor.graphics || []).map((g) => editorGraphicHtml(g, offset)).join("");
          const extraCallouts = decor.texts.filter((t) => t.role === "callout").map((t) => editorTextHtml(t, offset)).join("");
          html = html.replace("</section>", `${extraGraphics}${extraCallouts}</section>`);
          interior[pageNo - 1] = html;
        }
      }
      scenePage += 2;
      spreadIndex++;
    }
  }
}

await fs.mkdir(path.join(OUT, "img"), { recursive: true });
await fs.mkdir(path.join(OUT, "preview"), { recursive: true });
for (const f of await fs.readdir(path.join(OUT, "preview"))) await fs.rm(path.join(OUT, "preview", f));
await fs.writeFile(path.join(OUT, "interior.html"), doc(interior.join("\n")));
await fs.writeFile(path.join(OUT, "cover.html"), doc(coverSection));

let prepared = 0;
const keys = [...jobs.keys()];
for (let i = 0; i < keys.length; i += 4) {
  await Promise.all(keys.slice(i, i + 4).map(async (key) => {
    const target = path.join(OUT, "img", `${key}.jpg`);
    if (existsSync(target)) return;
    const { p, outW, outH, focus, cropW, cropH, crop } = jobs.get(key);
    let s = sharp(p.decodePath || p.path).rotate();
    if (crop) {
      s = s.extract(crop).resize(outW, outH);
    } else if (focus) {
      const cw = Math.min(p.width, Math.round(cropW)), chh = Math.min(p.height, Math.round(cropH));
      s = s.extract({ left: Math.round((p.width - cw) * focus[0]), top: Math.round((p.height - chh) * focus[1]), width: cw, height: chh }).resize(outW, outH);
    } else {
      s = s.resize(outW, outH, { fit: "cover", position: sharp.strategy.attention });
    }
    await s.toColorspace("srgb").withIccProfile("srgb").jpeg({ quality: 92, chromaSubsampling: "4:4:4" }).toFile(target);
    prepared++;
  }));
}

// ─── render ─────────────────────────────────────────────────────────────────

function findChrome() {
  const env = process.env.KEEPSAKE_CHROME || process.env.CHROME_PATH;
  const pf = process.env["PROGRAMFILES"] || "C:\\Program Files", pf86 = process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)";
  const local = process.env.LOCALAPPDATA || "";
  const c = [env,
    `${pf}\\Google\\Chrome\\Application\\chrome.exe`, `${pf86}\\Google\\Chrome\\Application\\chrome.exe`, `${local}\\Google\\Chrome\\Application\\chrome.exe`,
    `${pf86}\\Microsoft\\Edge\\Application\\msedge.exe`, `${pf}\\Microsoft\\Edge\\Application\\msedge.exe`,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/microsoft-edge"];
  const hit = c.find((p) => p && existsSync(p));
  if (!hit) throw new Error("No Chrome/Edge/Chromium found. Set KEEPSAKE_CHROME to its executable.");
  return hit;
}

const browser = await puppeteer.launch({ executablePath: findChrome(), headless: true, args: ["--allow-file-access-from-files", "--disable-gpu"] });
const pxPerMm = 96 / 25.4;
async function open(file, scaleFactor) {
  const page = await browser.newPage();
  await page.setViewport({ width: Math.ceil(W * pxPerMm) + 2, height: Math.ceil(H * pxPerMm) + 2, deviceScaleFactor: scaleFactor });
  await page.goto(pathToFileURL(path.join(OUT, file)).href, { waitUntil: "load", timeout: 60000 });
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map((image) => image.decode()));
    const broken = [...document.images].filter((image) => !image.naturalWidth);
    if (broken.length) throw new Error(`Missing photographs: ${broken.map((i) => i.alt).join(", ")}`);
  });
  return page;
}

const PREVIEW_SCALE = 0.5;
const shots = [];
try {
  const ip = await open("interior.html", PREVIEW_SCALE);
  for (const el of await ip.$$("section.page")) shots.push(await el.screenshot({ type: "png" }));
  await ip.emulateMediaType("print");
  await ip.pdf({ path: path.join(OUT, "interior.pdf"), preferCSSPageSize: true, printBackground: true, timeout: 60000 });
  const cp = await open("cover.html", 300 / 96);
  const coverPng = await (await cp.$("section.page")).screenshot({ type: "png" });
  await sharp(coverPng).jpeg({ quality: 92 }).withMetadata({ density: 300 }).toFile(path.join(OUT, "cover-front.jpg"));
  await cp.emulateMediaType("print");
  await cp.pdf({ path: path.join(OUT, "cover.pdf"), preferCSSPageSize: true, printBackground: true, timeout: 60000 });
  // Keep print images untouched; the downloadable reading copy uses lighter images
  // while retaining vector text and exactly the same page composition.
  const readingImages = {};
  for (const [key, job] of jobs) {
    const pixels = await sharp(path.join(OUT, "img", `${key}.jpg`)).resize({
      width: Math.max(1, Math.ceil(job.widthMm / 25.4 * 180)),
      height: Math.max(1, Math.ceil(job.heightMm / 25.4 * 180)),
      fit: "inside", withoutEnlargement: true,
    }).jpeg({ quality: 88, chromaSubsampling: "4:4:4" }).toBuffer();
    readingImages[`img/${key}.jpg`] = `data:image/jpeg;base64,${pixels.toString("base64")}`;
  }
  await cp.evaluate(async ({ body, images }) => {
    document.body.innerHTML = body;
    for (const image of document.images) {
      const value = images[image.getAttribute("src")];
      if (!value) throw new Error(`Missing reading-copy image: ${image.getAttribute("src")}`);
      image.src = value;
    }
    await document.fonts.ready;
    await Promise.all([...document.images].map((image) => image.decode()));
  }, { body: coverSection + interior.join("\n"), images: readingImages });
  await cp.pdf({ path: path.join(OUT, "album.pdf"), preferCSSPageSize: true, printBackground: true, timeout: 60000 });
} finally {
  await browser.close();
}

// Chrome rounds the page to whole CSS pixels; restore the exact size and mark
// trim/bleed boxes so print preflight knows where the cut is.
async function exactBoxes(file) {
  const pt = (v) => (v / 25.4) * 72;
  const d = await PDFDocument.load(await fs.readFile(file));
  for (const page of d.getPages()) {
    const { width, height } = page.getSize();
    page.scaleContent(pt(W) / width, pt(H) / height);
    page.setMediaBox(0, 0, pt(W), pt(H));
    page.setBleedBox(0, 0, pt(W), pt(H));
    page.setTrimBox(pt(B), pt(B), pt(TW), pt(TH));
  }
  await fs.writeFile(file, await d.save({ useObjectStreams: false }));
}
await exactBoxes(path.join(OUT, "interior.pdf"));
await exactBoxes(path.join(OUT, "cover.pdf"));

await exactBoxes(path.join(OUT, "album.pdf"));
const readingCopy = await PDFDocument.load(await fs.readFile(path.join(OUT, "album.pdf")));
readingCopy.setTitle(album.title || "Keepsake album");
for (const page of readingCopy.getPages()) {
  const trim = page.getTrimBox();
  page.translateContent(-trim.x, -trim.y);
  page.setMediaBox(0, 0, trim.width, trim.height);
  page.setCropBox(0, 0, trim.width, trim.height);
  page.setTrimBox(0, 0, trim.width, trim.height);
  page.setBleedBox(0, 0, trim.width, trim.height);
  page.setArtBox(0, 0, trim.width, trim.height);
}
await fs.writeFile(path.join(OUT, "album.pdf"), await readingCopy.save());

// Spread previews, trimmed to the finished page edge.
const trimPx = Math.round(B * pxPerMm * PREVIEW_SCALE);
const trimmed = await Promise.all(shots.map(async (b) => {
  const m = await sharp(b).metadata();
  return sharp(b).extract({ left: trimPx, top: trimPx, width: m.width - 2 * trimPx, height: m.height - 2 * trimPx }).toBuffer();
}));
const { width: pw, height: ph } = await sharp(trimmed[0]).metadata();
const spreadsIdx = [[null, 0]];
for (let i = 1; i < trimmed.length; i += 2) spreadsIdx.push([i, i + 1 < trimmed.length ? i + 1 : null]);
for (const [i, pair] of spreadsIdx.entries()) {
  const [left, right] = RTL ? [...pair].reverse() : pair;
  const composite = [];
  if (left !== null) composite.push({ input: trimmed[left], left: 0, top: 0 });
  if (right !== null) composite.push({ input: trimmed[right], left: pw, top: 0 });
  await sharp({ create: { width: pw * 2, height: ph, channels: 3, background: theme.bg } })
    .composite(composite).jpeg({ quality: 90 }).toFile(path.join(OUT, "preview", `spread-${num2(i + 1)}.jpg`));
}
const PER_SHEET = 3, LABEL = 26, SG = 18;
for (let s = 0; s * PER_SHEET < spreadsIdx.length; s++) {
  const chunk = spreadsIdx.slice(s * PER_SHEET, (s + 1) * PER_SHEET);
  const comps = [];
  chunk.forEach(([a, b], k) => {
    const y = SG + k * (ph + LABEL + SG);
    const [L, R] = RTL ? [b, a] : [a, b];
    if (L !== null) comps.push({ input: trimmed[L], left: SG, top: y + LABEL });
    if (R !== null) comps.push({ input: trimmed[R], left: SG + pw, top: y + LABEL });
    comps.push({ input: { create: { width: 1, height: ph, channels: 4, background: "#00000033" } }, left: SG + pw, top: y + LABEL });
    const label = [a, b].filter((x) => x !== null).map((x) => x + 1).join("–");
    comps.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${2 * pw}" height="${LABEL}"><text x="0" y="18" font-family="Consolas,monospace" font-size="15" fill="#ddd">pages ${label}</text></svg>`), left: SG, top: y });
  });
  await sharp({ create: { width: 2 * pw + 2 * SG, height: SG + chunk.length * (ph + LABEL + SG), channels: 3, background: "#3a3a3a" } })
    .composite(comps).jpeg({ quality: 84 }).toFile(path.join(OUT, "preview", `spreads-${String(s + 1).padStart(2, "0")}.jpg`));
}

// ─── report ─────────────────────────────────────────────────────────────────

const describe = (sp) => sp.double
  ? (sp.double.kind === "pano" ? "panorama across the spread" : "full-bleed across the spread")
  : sp.pages.map((p) => ({ bleed: "full-bleed", frame: "framed", grid: `grid ${p.items?.length}`, gridBleed: `edge grid ${p.items?.length}`, band: `band ${p.items?.length}`, blank: "blank", openerBleed: "opener", opener: "title page" }[p.kind] || p.kind)).join(" + ");
const planLines = editorProject
  ? editorProject.order.map((id, index) => {
    const spread = editorProject.spreads[id];
    return `- **${num2(index + 1)} ${spread.chapterTitle || ""} / ${spread.title || ""}**: ${spread.layout} · ${spread.frames.filter((frame) => !frame.hidden).length} photos`;
  })
  : plan.map((c) => `- **${num2(c.index)} ${c.chapter.title || ""}**: ${[CHAPTER_STYLE === "overlay" || PHOTO_FIRST ? null : "opener", ...c.spreads.map(describe)].filter(Boolean).join(" · ")}`);
const pageCoverage = Array.from({ length: totalPages }, (_, i) => {
  const page = i + 1;
  const images = usages.filter((usage) => {
    if (!usage.rect) return false;
    if (!usage.spreadBox) return usage.page === page;
    return editorScenePages.get(usage.sceneId)?.includes(page);
  });
  const offset = physLeft(page) ? 0 : W;
  const area = images.reduce((sum, u) => {
    const r = u.rect;
    const x0 = u.spreadBox ? offset + B : B;
    const x1 = x0 + TW;
    return sum + Math.max(0, Math.min(x1, r.x + r.w) - Math.max(x0, r.x)) *
      Math.max(0, Math.min(B + TH, r.y + r.h) - Math.max(B, r.y));
  }, 0);
  return { page, kind: kindAt[page], photoCoverage: +(area / (TW * TH)).toFixed(3) };
});
const sceneEvidence = [];
if (editorProject) {
  for (const id of editorProject.order) {
    const spread = editorProject.spreads[id];
    sceneEvidence.push({
      id,
      chapterId: spread.chapterId,
      chapter: spread.chapterTitle,
      scene: spread.title,
      pages: editorScenePages.get(id),
      photos: spread.frames.filter((frame) => !frame.hidden).map((frame) => frame.photo),
      recipe: spread.layout,
      wash: spread.wash || { left: "none", right: "none" },
      frames: spread.frames.map((frame) => ({
        id: frame.id, photo: frame.photo, role: frame.role, box: frame.box,
        fit: frame.fit, focusX: frame.focusX, focusY: frame.focusY,
        zoom: frame.zoom, mat: !!frame.mat, hidden: !!frame.hidden,
      })),
      texts: spread.texts.map((text) => ({ ...text, box: { ...text.box } })),
      graphics: (spread.graphics || []).map((graphic) => ({ ...graphic, box: { ...graphic.box } })),
    });
  }
} else if (PHOTO_FIRST) {
  let scenePage = 2;
  for (const chapter of plan) {
    for (const spread of chapter.spreads) {
      const pageObjects = spread.pages || [];
      const sceneId = pageObjects.find((page) => page.sceneId)?.sceneId;
      const scene = chapter.chapter.scenes?.find((candidate) => candidate.id === sceneId);
      const frames = [...new Map(usages
        .filter((usage) => usage.sceneId === sceneId && usage.frameId)
        .map((usage) => [usage.frameId, {
          id: usage.frameId,
          photo: usage.code,
          role: usage.role,
          page: usage.page,
          box: {
            ...usage.box,
            x: usage.box.x + (physLeft(usage.page) ? 0 : W),
          },
        }])).values()];
      const decor = autoSceneDecor.get(sceneId);
      sceneEvidence.push({
        id: sceneId,
        chapterId: chapter.chapter.id,
        chapter: chapter.chapter.title,
        scene: scene?.title || pageObjects.find((page) => page.scene)?.scene || chapter.chapter.title,
        pages: [scenePage, scenePage + 1],
        photos: frames.map((frame) => frame.photo),
        recipe: spread.rid,
        wash: decor?.wash || { left: "none", right: "none" },
        frames: decor?.frames || frames,
        texts: decor?.texts || textUsages.filter((text) => text.sceneId === sceneId),
        graphics: decor?.graphics || [],
      });
      scenePage += 2;
    }
  }
} else {
  let scenePage = 2;
  for (const chapter of plan) {
    if (CHAPTER_STYLE !== "overlay") scenePage += 2;
    for (const spread of chapter.spreads) {
      sceneEvidence.push({
        chapter: chapter.chapter.title,
        scene: chapter.chapter.title,
        pages: [scenePage, scenePage + 1],
        photos: (spread.double ? [spread.double.item] : spread.pages.flatMap((page) => page.items || (page.item ? [page.item] : []))).map((it) => it.p.code),
        recipe: spread.rid,
      });
      scenePage += 2;
    }
  }
}
await fs.writeFile(path.join(OUT, "layout.json"), JSON.stringify({
  style: CHAPTER_STYLE, pageCount: totalPages, trimMm: [TW, TH], bleedMm: B,
  sourceFingerprint: albumFingerprint(sourceAlbum),
  photoCount: used.size, scenes: sceneEvidence, coverage: pageCoverage, placements: usages,
  editorProject: editorProject ? {
    id: editorProject.id,
    revision: editorProject.revision,
    file: path.basename(PROJECT_PATH),
  } : null,
}, null, 2));
const worst = new Map();
for (const u of usages) if (!worst.has(u.code) || u.dpi < worst.get(u.code).dpi) worst.set(u.code, u);
const low = [...worst.values()].filter((u) => u.dpi < DPI_OK).sort((a, b) => a.dpi - b.dpi);
const unusedKeep = cull.photos.filter((p) => p.status === "keep" && !used.has(p.code)).length;
const size = async (f) => ((await fs.stat(path.join(OUT, f))).size / 1048576).toFixed(1) + " MB";
const verdict = (d) => (d < DPI_FAIL ? "FAIL" : d < DPI_WARN ? "warn" : "ok");
const report = `# Print report — ${album.title}

| | |
|---|---|
| Trim size | ${TW} × ${TH} mm |
| Reading PDF page size | ${TW} × ${TH} mm (trim-sized MediaBox and CropBox, no bleed) |
| Page size with bleed | ${W} × ${H} mm (${B} mm bleed each side) |
| Grid margin / gutter | ${M} mm (+${IE} mm at the binding) / ${G} mm |
| Interior pages | ${totalPages} (multiple of ${MULTIPLE}, minimum ${MIN_PAGES}) |
| Density | ${DENSITY} (about ${(DENS.target * scale).toFixed(1)} photos per spread) |
| Chapter openers | ${CHAPTER_STYLE} |
| Photos placed | ${used.size} (${unusedKeep} kept photos not used) |
| Files | album.pdf ${await size("album.pdf")} (reading copy with cover); interior.pdf ${await size("interior.pdf")}, cover.pdf ${await size("cover.pdf")} (print components) |

## Subject protection
${PHOTO_FIRST ? `Placement uses reviewed subject rectangles, with uncropped fallback when necessary. Unannotated photos identified as people are not cropped. Crop coordinates and page coverage are recorded in layout.json.` : "Legacy layout is in use; reviewed subject rectangles are respected when supplied."}

## Spread plan
${planLines.join("\n")}

## Resolution (300 dpi target; ${DPI_WARN} acceptable; under ${DPI_FAIL} prints soft)
${low.length ? low.map((u) => `- ${verdict(u.dpi)} ${u.code} (${u.file}) — ${u.dpi} dpi on page ${u.page}`).join("\n") : "All photos are at 240 dpi or better."}

## Warnings
${warnings.length ? warnings.map((w) => "- " + w).join("\n") : "None."}

## Uploading to a print service
- **album.pdf** is a lighter reading copy with 180 dpi images, vector text, the front cover included and bleed hidden. Use the separate print components for full-resolution printing.
- **interior.pdf** is the print interior at **${TW} × ${TH} mm** trim, with ${B} mm bleed. Check your chosen printer's dimensions, paper, binding and PDF requirements before ordering. If it requests pages without bleed, rebuild with \`"bleedMm": 0\`.
- **cover.pdf / cover-front.jpg** is the front cover only. Hardcovers need a wrap whose spine width depends on paper and page count — use the service's cover template and place cover-front.jpg on its front panel.
- Colours are sRGB. Most consumer photo-book printers expect sRGB; ask before converting to CMYK.${plan.some((c) => c.spreads.some((s) => s.double)) && !LAYFLAT ? "\n- This book has pictures across the fold. Order lay-flat binding, or accept that a strip in the middle disappears into the binding." : ""}
`;
await fs.writeFile(path.join(OUT, "report.md"), report);
await fs.writeFile(path.join(OUT, "preview.html"), `<!doctype html><html lang="${HE ? "he" : "en"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(album.title)} - Keepsake</title><style>body{margin:0;background:#eeeae3;color:#191919;font:16px system-ui}header{padding:24px 5%;display:flex;gap:18px;align-items:center;flex-wrap:wrap}h1{font-size:22px;margin:0 auto 0 0}a{color:inherit}main{max-width:1500px;margin:auto;padding:0 20px 60px}figure{margin:30px 0}figure img{display:block;width:100%;height:auto;box-shadow:0 8px 30px #0001}figcaption{margin-top:12px;font-size:13px;color:#555}.cover{max-width:600px;margin:12px auto 50px}.cover img{width:100%}</style></head><body><header><h1>${esc(album.title)}</h1><a href="album.pdf">Download album PDF</a><a href="interior.pdf">Print interior</a></header><main><figure class="cover"><img src="cover-front.jpg" alt="Front cover"></figure>${spreadsIdx.map(([a,b],i) => `<figure><img src="preview/spread-${num2(i+1)}.jpg" alt="Album pages ${[a,b].filter((x)=>x!==null).map((x)=>x+1).join(" and ")}" loading="lazy"><figcaption>${[a,b].filter((x)=>x!==null).map((x)=>x+1).join(" - ")}</figcaption></figure>`).join("")}</main></body></html>`);

console.log(`Built ${totalPages} interior pages (${DENSITY}, ${CHAPTER_STYLE} openers), ${used.size} photos, ${prepared} images prepared`);
console.log(planLines.map((l) => "  " + l.replace(/\*\*/g, "")).join("\n"));
console.log(`  ${OUT}\\album.pdf  interior.pdf  cover.pdf  preview.html  layout.json`);
const fails = low.filter((u) => u.dpi < DPI_FAIL), warns = low.filter((u) => u.dpi >= DPI_FAIL && u.dpi < DPI_WARN);
console.log(`  resolution: ${fails.length} under ${DPI_FAIL} dpi, ${warns.length} under ${DPI_WARN} dpi`);
if (warnings.length) console.log("  warnings:\n   - " + warnings.join("\n   - "));
