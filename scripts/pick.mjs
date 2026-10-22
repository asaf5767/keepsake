#!/usr/bin/env node
// Keepsake step 2: pick the photos for the book the way a careful person would, after cull.mjs.
//   1. Moments: shots of the same thing taken within minutes (bursts, reframed
//      shots, an edited copy) form one moment. Its best frame stands for it; the
//      other frames stay as alternatives on sheets/frames-*.jpg.
//   2. Chapters: dates and places split the moments into days and places (a
//      trip) or into months or years (a longer period).
//   3. Selection: each chapter gets a share of the book. Inside a chapter the
//      strongest moments win, but a moment that looks like one already picked is
//      pushed down, so the book shows variety instead of repeats.
// Writes pick.json, album.draft.json and decision sheets for the agent:
//   sheets/pick-*.jpg   picks (green) and bench (grey) per chapter
//   sheets/frames-*.jpg every frame of each picked moment, best one outlined
//   sheets/more-*.jpg   all other moments; "≈ P012" marks a near-repeat of a pick
//
// node pick.mjs <work> [--photos N] [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--lang he]

import fs from "fs/promises";
import path from "path";
import sharp from "sharp";
import { distanceKm } from "./places.mjs";
import { unpack, cosine } from "./vision.mjs";

const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const WORK = path.resolve(args.find((a, i) => !a.startsWith("--") && !["--photos", "--from", "--to", "--lang"].includes(args[i - 1])) || ".");
const LANG = opt("--lang", "en");
const LOCALE = LANG === "he" ? "he-IL" : "en-GB";
const FROM = opt("--from"), TO = opt("--to");
const cull = JSON.parse(await fs.readFile(path.join(WORK, "cull.json"), "utf8"));

const MOMENT_SECONDS = 10 * 60;   // frames of one moment are minutes apart at most
const MOMENT_LOOK = 0.78;          // ...and nearly the same picture (reshoots score 0.9+, different views of a place under 0.7)
const REPEAT = 0.75;               // a candidate this close to a pick is a near-repeat
const LAMBDA = 0.9;
const COVER = 0.25;               // how much a part of the day not yet shown is worth                // how strongly variety pushes against quality

// ─── photos ─────────────────────────────────────────────────────────────────

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const hamming = (a, b) => { let x = a ^ b, c = 0; while (x) { x &= x - 1n; c++; } return c; };
const has = (p, f) => !!p.flags?.includes(f);
const day10 = (p) => p.date.slice(0, 10);
const inRange = (p) => (!FROM || day10(p) >= FROM) && (!TO || day10(p) <= TO);
function prep(p) {
  p.t = Date.parse(p.date) / 1000;
  p.h = p.hash ? BigInt("0x" + p.hash) : null;
  p.embv = p.emb ? unpack(p.emb) : null;
  p.labv = p.lay ? Array.from(Buffer.from(p.lay, "hex"), (v, i) => (i % 3 === 0 ? v / 2.55 : v - 128)) : null;
  if (p.col) {
    const c = Array.from(Buffer.from(p.col, "hex"), (v) => (v / 255) ** 2);
    const s = c.reduce((a, b) => a + b, 0) || 1;
    p.colv = c.map((v) => v / s);
  }
  return p;
}
const keep = cull.photos.filter((p) => p.status === "keep" && inRange(p)).map(prep).sort((a, b) => a.t - b.t);
if (!keep.length) { console.error("No kept photos in that date range."); process.exit(1); }
if (!keep[0].lay) { console.error("cull.json is from an older cull.mjs; run cull.mjs again first."); process.exit(1); }
const dupsOf = new Map();
for (const p of cull.photos) if (p.status === "reject" && p.dupOf && p.reasons.every((r) => r === "duplicate")) {
  if (!dupsOf.has(p.dupOf)) dupsOf.set(p.dupOf, []);
  dupsOf.get(p.dupOf).push(prep(p));
}

// How alike two photos look: colour layout (survives reframing), colour palette, and structure.
function look(a, b) {
  let sL = 0, sH = 0, sD = 0;
  if (a.labv && b.labv) {
    let d = 0;
    for (let i = 0; i < 48; i += 3) d += Math.hypot(a.labv[i] - b.labv[i], a.labv[i + 1] - b.labv[i + 1], a.labv[i + 2] - b.labv[i + 2]);
    sL = clamp01(1 - (d / 16 - 8) / 22);
  }
  if (a.colv && b.colv) { let hi = 0; for (let i = 0; i < 64; i++) hi += Math.min(a.colv[i], b.colv[i]); sH = clamp01((hi - 0.5) / 0.4); }
  if (a.h !== null && b.h !== null) sD = clamp01((26 - hamming(a.h, b.h)) / 16);
  return Math.max(sD, 0.65 * sL + 0.35 * sH);
}

// Photos without GPS borrow the place of the nearest photo in time (within 3 hours).
const placed = keep.filter((p) => p.place);
for (const p of keep) if (!p.place && placed.length) {
  const q = placed.reduce((a, b) => (Math.abs(b.t - p.t) < Math.abs(a.t - p.t) ? b : a));
  if (Math.abs(q.t - p.t) <= 3 * 3600) { p.place = q.place; p.local = q.local; p.country = q.country; p.gpsGuess = q.gps; }
}

// A frame's worth: technical quality, a little colour, and signs the owner cared.
const colorRank = new Map([...keep].sort((a, b) => (a.metrics?.colorful ?? 0) - (b.metrics?.colorful ?? 0)).map((p, i, arr) => [p.code, arr.length > 1 ? i / (arr.length - 1) : 0.5]));
const frameScore = (p) => p.quality + 0.1 * (colorRank.get(p.code) ?? 0.5) + (p.rating >= 3 ? 0.25 : 0) + 0.04 * Math.max(0, p.rating || 0)
  + (has(p, "edited") ? 0.15 : 0) - (has(p, "lowres") ? 0.1 : 0) - (has(p, "received") ? 0.2 : 0) - (has(p, "no-metadata") ? 0.05 : 0) - 0.6 * (p.vision?.junk || 0);

// What the book is about. When people fill the roll (a family trip), people photos are what a
// person keeps, and things (shop shelves, packaging, food) are what they skip. A landscape
// trip with few people is left alone.
const PEOPLE = new Set(["people", "selfie", "child"]), THINGS = new Set(["shop", "food"]);
const peopleShare = keep.filter((p) => PEOPLE.has(p.vision?.what)).length / keep.length;
const FAMILY = peopleShare >= 0.3;
const subjectScore = (p) => (!FAMILY || !p.vision ? 0 : PEOPLE.has(p.vision.what) ? 0.2 : THINGS.has(p.vision.what) ? -0.15 : 0);

// ─── moments ────────────────────────────────────────────────────────────────

// A photo joins a moment only if it looks like the moment's first frame AND like its
// members on average. Chaining frame to frame would merge a long photo session
// (different poses, groupings, spots) into one moment.
// When the model is on, frames of one moment must also MEAN the same (reshoots ~0.9+, different poses ~0.75).
const sameMeaning = (a, b) => !a.embv || !b.embv || cosine(a.embv, b.embv) >= 0.88;
const groupsArr = [];
for (const p of keep) {
  let best = null, bestMean = 0;
  for (const g of groupsArr) {
    if (p.t - g[0].t > MOMENT_SECONDS || look(p, g[0]) < MOMENT_LOOK || !sameMeaning(p, g[0])) continue;
    const mean = g.reduce((s, o) => s + look(p, o), 0) / g.length;
    if (mean >= MOMENT_LOOK && mean > bestMean) { bestMean = mean; best = g; }
  }
  if (best) best.push(p); else groupsArr.push([p]);
}
const groupMap = new Map(groupsArr.map((g, i) => [i, g]));
const mostCommon = (xs) => { const c = new Map(); for (const x of xs) if (x) c.set(x, (c.get(x) || 0) + 1); return [...c.entries()].sort((a, b) => b[1] - a[1]); };
const moments = [...groupMap.values()].map((ps) => {
  const best = ps.reduce((a, b) => (frameScore(b) > frameScore(a) ? b : a));
  const frames = [...ps, ...ps.flatMap((p) => dupsOf.get(p.code) || [])].sort((a, b) => a.t - b.t);
  return { photos: ps, frames, best, t: ps[0].t, place: mostCommon(ps.map((p) => p.place))[0]?.[0] || null,
    gps: best.gps || best.gpsGuess || ps.find((p) => p.gps)?.gps || null,
    imp: frameScore(best) + 0.06 * Math.log(frames.length) + (frames.some((p) => has(p, "selfie")) ? 0.05 : 0) };
}).sort((a, b) => a.t - b.t);
moments.forEach((m, i) => (m.id = `M${String(i + 1).padStart(3, "0")}`));

// ─── chapters ───────────────────────────────────────────────────────────────

const pad = (n) => String(n).padStart(2, "0");
const at = (t) => new Date(t * 1000);
const dayKey = (t) => { const d = at(t - 4 * 3600); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const span = (moments.at(-1).t - moments[0].t) / 86400;
const MODE = span <= 45 ? "trip" : span <= 400 ? "month" : "year";

function mergeSmall(segs, min) {
  for (let i = 0; segs.length > 1 && i < segs.length; ) {
    if (segs[i].length >= min) { i++; continue; }
    const j = i === 0 ? 1 : i - 1;
    segs[Math.min(i, j)] = i < j ? [...segs[i], ...segs[j]] : [...segs[j], ...segs[i]];
    segs.splice(Math.max(i, j), 1);
    i = 0;
  }
  return segs;
}
const segPlace = (seg) => mostCommon(seg.flatMap((m) => m.photos.map((p) => p.place)))[0]?.[0] || null;

let segs = [];
if (MODE === "trip") {
  for (const m of moments) {
    const last = segs.at(-1);
    if (!last || dayKey(last.at(-1).t) !== dayKey(m.t)) segs.push([m]); else last.push(m);
  }
  // A day trip shows as a jump of more than 20 km inside one day.
  segs = segs.flatMap((seg) => {
    const parts = [[seg[0]]];
    for (let i = 1; i < seg.length; i++) {
      const a = seg[i - 1].gps, b = seg[i].gps;
      const jump = a && b && distanceKm(a.lat, a.lng, b.lat, b.lng) > 20;
      if (jump && parts.at(-1).length >= 4 && seg.length - i >= 4) parts.push([seg[i]]); else parts.at(-1).push(seg[i]);
    }
    return parts;
  });
  segs = mergeSmall(segs, 3);
  if (segs.length > 12) segs = segs.reduce((out, s) => (out.length && segPlace(out.at(-1)) && segPlace(out.at(-1)) === segPlace(s) ? (out[out.length - 1] = [...out.at(-1), ...s], out) : [...out, s]), []);
  while (segs.length > 12) {
    let bi = 0;
    for (let i = 1; i < segs.length - 1; i++) if (segs[i].length + segs[i + 1].length < segs[bi].length + segs[bi + 1].length) bi = i;
    segs.splice(bi, 2, [...segs[bi], ...segs[bi + 1]]);
  }
} else {
  const key = (m) => { const d = at(m.t); return MODE === "month" ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}` : String(d.getFullYear()); };
  for (const m of moments) { const last = segs.at(-1); if (!last || key(last[0]) !== key(m)) segs.push([m]); else last.push(m); }
  segs = mergeSmall(segs, 3);
}

const fmt = (t, o) => at(t).toLocaleDateString(LOCALE, o);
function dateText(t1, t2) {
  if (dayKey(t1) === dayKey(t2)) return fmt(t1, { weekday: "long", day: "numeric", month: "long" });
  const a = at(t1), b = at(t2);
  if (a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear()) return `${a.getDate()}–${fmt(t2, { day: "numeric", month: "long" })}`;
  return `${fmt(t1, { day: "numeric", month: "long" })} – ${fmt(t2, { day: "numeric", month: "long" })}`;
}
const years = new Set(moments.map((m) => at(m.t).getFullYear()));
const firstDay = dayKey(moments[0].t);
const chapters = segs.map((seg) => {
  const t1 = seg[0].t, t2 = seg.at(-1).t;
  const places = mostCommon(seg.flatMap((m) => m.photos.map((p) => p.place))).map(([p]) => p);
  let title, kicker;
  if (MODE === "trip") {
    const n = Math.round((Date.parse(dayKey(t1)) - Date.parse(firstDay)) / 86400000) + 1;
    title = places[0] || (LANG === "he" ? `יום ${n}` : `Day ${n}`);
    kicker = dateText(t1, t2);
  } else if (MODE === "month") {
    title = fmt(t1, years.size > 1 ? { month: "long", year: "numeric" } : { month: "long" });
    kicker = places.slice(0, 2).join(" · ") || String(at(t1).getFullYear());
  } else {
    title = String(at(t1).getFullYear());
    kicker = places.slice(0, 3).join(" · ");
  }
  return { title, kicker, place: places[0] || null, moments: seg, t1, t2 };
});
// Two chapters in the same city get their neighbourhood names (Alfama, Belém) instead.
for (const title of new Set(chapters.map((c) => c.title))) {
  const same = chapters.filter((c) => c.title === title && c.place === title);
  if (MODE !== "trip" || same.length < 2) continue;
  const locals = same.map((c) => mostCommon(c.moments.flatMap((m) => m.photos.map((p) => p.local)))[0]?.[0] || null);
  if (locals.every(Boolean) && new Set(locals).size === locals.length)
    same.forEach((c, i) => { c.title = locals[i]; c.kicker = `${c.kicker} · ${title}`; });
}

// ─── selection ──────────────────────────────────────────────────────────────

// A reader sees the same picture twice whenever it was taken, so time barely discounts
// looking alike; moments within a few minutes are related even when they look different.
const lookCache = new Map();
function simM(a, b) {
  const key = a.id < b.id ? a.id + b.id : b.id + a.id;
  let l = lookCache.get(key);
  // With the model on, likeness is by meaning (same scene 0.85+ -> 1, same park other spot ~0.75 -> 0.75, typical pair of trip photos ~0.53 -> 0.2).
  if (l === undefined) lookCache.set(key, (l = a.best.embv && b.best.embv ? clamp01((cosine(a.best.embv, b.best.embv) - 0.5) / 0.38) : look(a.best, b.best)));
  const dt = Math.abs(a.t - b.t);
  return Math.max(l * (0.85 + 0.15 * Math.exp(-dt / 2700)), 0.35 * Math.exp(-dt / 180));
}
// How many different scenes a chapter really holds: eight rooftop views from
// different corners count as about two, eight unrelated photos as eight.
function distinct(ms) {
  return ms.reduce((s, m) => s + 1 / (1 + ms.reduce((a, o) => (o === m ? a : a + Math.max(0, simM(m, o) - 0.15) / 0.85), 0)), 0);
}
for (const ch of chapters) ch.distinct = distinct(ch.moments);
const totalDistinct = chapters.reduce((s, c) => s + c.distinct, 0);

const autoTarget = MODE === "trip" ? Math.min(60, Math.max(16, Math.round(1.1 * totalDistinct))) : Math.min(120, Math.max(36, Math.round(0.9 * totalDistinct)));
const TARGET = Math.min(moments.length, Number(opt("--photos")) || autoTarget);

// Each chapter's share follows its distinct scenes and grows slower than its size,
// so a repetitive or very busy day can't swallow the book. A chapter never takes
// much more than one or two photos per distinct scene, unless a photo count was asked for.
function quotas(sizes, weights, target) {
  const caps = sizes.map((n, i) => (opt("--photos") ? n : Math.min(n, Math.max(2, Math.ceil(1.6 * weights[i])))));
  // Every chapter gets a floor: a whole day of a trip deserves at least a spread, however alike its photos look.
  const floor = MODE === "trip" ? 5 : 3;
  for (let i = 0; i < caps.length; i++) caps[i] = Math.min(sizes[i], Math.max(caps[i], floor));
  const q = caps.map((c) => Math.min(c, floor));
  const w = weights.map((x) => Math.max(x, 0.5) ** 0.6), W = w.reduce((a, b) => a + b, 0);
  for (let left = target - q.reduce((a, b) => a + b, 0); left > 0; left--) {
    let bi = -1, bv = -Infinity;
    caps.forEach((c, i) => { const v = (target * w[i]) / W - q[i]; if (q[i] < c && v > bv) { bv = v; bi = i; } });
    if (bi < 0) break;
    q[bi]++;
  }
  return q;
}
const quota = quotas(chapters.map((c) => c.moments.length), chapters.map((c) => c.distinct), TARGET);

const pickedAll = [];
chapters.forEach((ch, ci) => {
  const cand = [...ch.moments], chosen = [], order = [];
  const benchSize = Math.max(2, Math.ceil(quota[ci] / 2));
  const want = Math.min(cand.length, quota[ci] + benchSize);
  while (order.length < want && cand.length) {
    let best = null;
    for (const [i, m] of cand.entries()) {
      let ms = 0, to = null;
      for (const p of chosen) { const s = simM(m, p); if (s > ms) { ms = s; to = p; } }
      for (const p of pickedAll) { const s = 0.6 * simM(m, p); if (s > ms) { ms = s; to = p; } }
      // Story coverage: a moment far in time from everything already chosen in this chapter
      // shows a part of the day the book doesn't have yet (the fountain after the blossoms).
      const gap = chosen.length ? Math.min(...chosen.map((c) => Math.abs(c.t - m.t))) : 0;
      const v = m.imp + subjectScore(m.best) + COVER * Math.min(1, gap / 1800) - LAMBDA * ms;
      if (!best || v > best.v) best = { v, i, ms, to };
    }
    const m = cand.splice(best.i, 1)[0];
    m.ms = best.ms; m.similarTo = best.ms >= REPEAT ? best.to : null;
    order.push(m); chosen.push(m);
  }
  const fresh = order.filter((m) => !m.similarTo), repeats = order.filter((m) => m.similarTo);
  ch.ranking = order.map((m) => ({ code: m.best.code, imp: +m.imp.toFixed(3), sim: +m.ms.toFixed(2), similarTo: m.similarTo?.best.code }));
  ch.picks = [...fresh.slice(0, quota[ci]), ...repeats.slice(0, Math.max(0, quota[ci] - fresh.length))];
  ch.bench = order.filter((m) => !ch.picks.includes(m)).slice(0, benchSize);
  ch.more = ch.moments.filter((m) => !ch.picks.includes(m) && !ch.bench.includes(m));
  for (const m of [...ch.bench, ...ch.more]) {
    let ms = 0, to = null;
    for (const p of ch.picks) { const s = simM(m, p); if (s > ms) { ms = s; to = p; } }
    m.similarTo = ms >= REPEAT ? to : null;
  }
  for (const list of [ch.picks, ch.bench]) list.sort((a, b) => a.t - b.t);
  pickedAll.push(...ch.picks);
});

// ─── draft album ────────────────────────────────────────────────────────────

const coverScore = (m) => m.imp + (m.best.aspect >= 0.75 && m.best.aspect <= 1.6 ? 0.1 : -0.2) + (m.best.width * m.best.height >= 8e6 ? 0.1 : 0);
const ranked = [...pickedAll].sort((a, b) => coverScore(b) - coverScore(a));
const cover = ranked[0];
const chapterOf = (m) => chapters.findIndex((c) => c.moments.includes(m));
const titleMoment = ranked.find((m) => m !== cover && chapterOf(m) !== chapterOf(cover)) || ranked.find((m) => m !== cover);
const placeList = mostCommon(moments.map((m) => m.place));
const mainPlace = placeList[0] && placeList[0][1] >= 0.5 * moments.filter((m) => m.place).length ? placeList[0][0] : null;
const countryList = mostCommon(keep.map((p) => p.country));
const oneCountry = countryList.length === 1 ? countryList[0][0] : null;
const draft = {
  title: mainPlace || oneCountry || path.basename(cull.source).replace(/[-_]+/g, " "),
  author: "",
  ...(LANG === "he" ? { direction: "rtl", locale: "he-IL" } : {}),
  cover: { photo: cover.best.code },
  ...(titleMoment ? { titlePage: { photo: titleMoment.best.code } } : {}),
  chapters: chapters.map((ch) => ({ title: ch.title, kicker: ch.kicker, photos: ch.picks.map((m) => m.best.code) })),
};
await fs.writeFile(path.join(WORK, "album.draft.json"), JSON.stringify(draft, null, 2));

// ─── decision sheets ────────────────────────────────────────────────────────

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const hhmm = (p) => p.date.slice(11, 16);
const thumbs = new Map();
async function thumb(p, w, h) {
  const key = `${p.code}:${w}x${h}`;
  if (!thumbs.has(key)) thumbs.set(key, await sharp(p.decodePath || p.path).rotate().resize(w, h, { fit: "inside" }).jpeg({ quality: 80 }).toBuffer());
  return thumbs.get(key);
}
const text = (w, h, lines, bg) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="${bg}"/>${lines
  .map((l, i) => `<text x="8" y="${18 + i * 20}" font-family="Consolas,Menlo,monospace" font-size="${i ? 14 : 17}" font-weight="${i ? "normal" : "bold"}" fill="${i ? "#f5c26b" : "#fff"}">${esc(l)}</text>`).join("")}</svg>`);
const tags = (p) => [has(p, "suspect") ? "? " + p.vision.junkLabel : "", p.rating >= 3 ? "♥" : "", has(p, "edited") ? "edit" : "", has(p, "selfie") ? "selfie" : "", has(p, "received") ? "recv" : ""].filter(Boolean).join(" ");

const COLS = 7, CW = 250, LH = 44, GAP = 8, HEAD = 46, MAXH = 2300;
const SW = COLS * CW + (COLS + 1) * GAP;
async function gridSheets(prefix, sections) {
  const rows = [];
  for (const s of sections) {
    if (!s.cells.length) continue;
    rows.push({ head: s.head });
    for (let i = 0; i < s.cells.length; i += COLS) rows.push({ cells: s.cells.slice(i, i + COLS), head: s.head });
  }
  const pages = [];
  let cur = [], h = GAP;
  for (const r of rows) {
    const rh = r.cells ? CW + LH + GAP : HEAD + GAP;
    if (h + rh > MAXH && cur.length) { pages.push(cur); cur = []; h = GAP; if (r.cells) { cur.push({ head: r.head + "  (continued)" }); h += HEAD + GAP; } }
    cur.push(r); h += rh;
  }
  if (cur.length) pages.push(cur);
  const files = [];
  for (const [pi, page] of pages.entries()) {
    const comps = [];
    let y = GAP;
    for (const r of page) {
      if (!r.cells) { comps.push({ input: text(SW - 2 * GAP, HEAD, [r.head], "#20324a"), left: GAP, top: y }); y += HEAD + GAP; continue; }
      for (const [ci, c] of r.cells.entries()) {
        const x = GAP + ci * (CW + GAP);
        const tb = await thumb(c.p, CW, CW), tm = await sharp(tb).metadata();
        comps.push({ input: tb, left: x + Math.round((CW - tm.width) / 2), top: y + Math.round((CW - tm.height) / 2) });
        comps.push({ input: text(CW, LH, c.lines, c.bg), left: x, top: y + CW });
      }
      y += CW + LH + GAP;
    }
    const file = `${prefix}-${pad(pi + 1)}.jpg`;
    await sharp({ create: { width: SW, height: y, channels: 3, background: "#2a2a2a" } }).composite(comps).jpeg({ quality: 82 }).toFile(path.join(WORK, "sheets", file));
    files.push(file);
  }
  return files;
}

await fs.mkdir(path.join(WORK, "sheets"), { recursive: true });
for (const f of await fs.readdir(path.join(WORK, "sheets"))) if (/^(pick|frames|more)-\d+\.jpg$/.test(f)) await fs.rm(path.join(WORK, "sheets", f));
const extraFrames = (m) => (m.frames.length > 1 ? ` +${m.frames.length - 1}` : "");
const head = (ch, i, what) => `${pad(i + 1)}  ${ch.title} · ${ch.kicker}  —  ${what}`;
const pickFiles = await gridSheets("pick", chapters.map((ch, i) => ({
  head: head(ch, i, `${ch.picks.length} picked of ${ch.moments.length} moments`),
  cells: [
    ...ch.picks.map((m) => ({ p: m.best, bg: "#1f5f36", lines: [`${m.best.code} ✓${extraFrames(m)}`, `${hhmm(m.best)} ${tags(m.best)}`] })),
    ...ch.bench.map((m) => ({ p: m.best, bg: "#3a3a3a", lines: [`${m.best.code} bench${extraFrames(m)}${m.similarTo ? ` ≈ ${m.similarTo.best.code}` : ""}`, `${hhmm(m.best)} ${tags(m.best)}`] })),
  ],
})));
const moreFiles = await gridSheets("more", chapters.map((ch, i) => ({
  head: head(ch, i, `${ch.more.length} more moments`),
  cells: ch.more.map((m) => ({ p: m.best, bg: m.similarTo ? "#5a3a1a" : "#3a3a3a", lines: [`${m.best.code}${extraFrames(m)}${m.similarTo ? ` ≈ ${m.similarTo.best.code}` : ""}`, `${hhmm(m.best)} ${tags(m.best)}`] })),
})));

// Frames: one row per picked moment that has more than one frame; the chosen frame is outlined.
const FH = 210, FW = 280, LABEL = 120, FMAX = 7, ROWS = 8;
const frameRows = pickedAll.filter((m) => m.frames.length > 1);
const frameFiles = [];
for (let s = 0; s * ROWS < frameRows.length; s++) {
  const chunk = frameRows.slice(s * ROWS, (s + 1) * ROWS);
  const comps = [];
  const width = LABEL + FMAX * (FW + GAP) + GAP;
  for (const [ri, m] of chunk.entries()) {
    const y = GAP + ri * (FH + LH + GAP);
    comps.push({ input: text(LABEL - GAP, FH + LH, [m.id, `ch ${pad(chapterOf(m) + 1)}`, `${m.frames.length} frames`], "#20324a"), left: GAP, top: y });
    const shown = [m.best, ...m.frames.filter((f) => f !== m.best).sort((a, b) => frameScore(b) - frameScore(a))].slice(0, FMAX);
    for (const [fi, f] of shown.entries()) {
      const x = LABEL + fi * (FW + GAP);
      const tb = await thumb(f, FW - 12, FH - 12), tm = await sharp(tb).metadata();
      if (f === m.best) comps.push({ input: { create: { width: tm.width + 12, height: tm.height + 12, channels: 3, background: "#2fbf62" } }, left: x + Math.round((FW - tm.width - 12) / 2), top: y + Math.round((FH - tm.height - 12) / 2) });
      comps.push({ input: tb, left: x + Math.round((FW - tm.width) / 2), top: y + Math.round((FH - tm.height) / 2) });
      const dt = Math.round(f.t - m.best.t), rel = `${dt < 0 ? "-" : "+"}${Math.floor(Math.abs(dt) / 60)}:${pad(Math.abs(dt) % 60)}`;
      comps.push({ input: text(FW, LH, [`${f.code}${f === m.best ? " best" : ""}`, `${f === m.best ? hhmm(f) : rel}${f.status === "reject" ? " dup" : ""} ${tags(f)}`], f === m.best ? "#1f5f36" : "#3a3a3a"), left: x, top: y + FH });
    }
    if (m.frames.length > FMAX) comps.push({ input: text(LABEL - GAP, 30, [`+${m.frames.length - FMAX} more`], "#20324a"), left: GAP, top: y + FH + LH - 30 });
  }
  const file = `frames-${pad(s + 1)}.jpg`;
  await sharp({ create: { width: LABEL + FMAX * (FW + GAP) + GAP, height: GAP + chunk.length * (FH + LH + GAP), channels: 3, background: "#2a2a2a" } })
    .composite(comps).jpeg({ quality: 82 }).toFile(path.join(WORK, "sheets", file));
  frameFiles.push(file);
}

// ─── report ─────────────────────────────────────────────────────────────────

await fs.writeFile(path.join(WORK, "pick.json"), JSON.stringify({
  createdAt: new Date().toISOString(), mode: MODE, target: TARGET, photos: keep.length, moments: moments.length,
  chapters: chapters.map((ch, i) => ({
    title: ch.title, kicker: ch.kicker, place: ch.place, moments: ch.moments.length, quota: quota[i],
    picks: ch.picks.map((m) => ({ code: m.best.code, moment: m.id, frames: m.frames.map((f) => f.code) })),
    bench: ch.bench.map((m) => ({ code: m.best.code, similarTo: m.similarTo?.best.code })),
    more: ch.more.map((m) => ({ code: m.best.code, similarTo: m.similarTo?.best.code })),
    ranking: ch.ranking,
  })),
  momentList: moments.map((m) => ({ id: m.id, best: m.best.code, frames: m.frames.map((f) => f.code), place: m.place })),
}, null, 1));

const folded = moments.reduce((s, m) => s + m.frames.length - 1, 0);
const nearRepeats = chapters.reduce((s, ch) => s + [...ch.bench, ...ch.more].filter((m) => m.similarTo).length, 0);
console.log(`${keep.length} kept photos -> ${moments.length} moments (${folded} extra frames of the same moments set aside)`);
console.log(`Picked ${pickedAll.length} moments for the draft (${MODE}; ${chapters.length} chapters; aim ${TARGET}, from about ${Math.round(totalDistinct)} distinct scenes):`);
chapters.forEach((ch, i) => console.log(`  ${pad(i + 1)} ${ch.title} · ${ch.kicker} — ${ch.picks.length} of ${ch.moments.length} moments (~${Math.round(ch.distinct)} distinct)`));
console.log(`Near-repeats of picked moments left out: ${nearRepeats}`);
const noDate = keep.filter((p) => p.dateSource !== "exif").length;
if (noDate) console.log(`Warning: ${noDate} photos have no camera date; they were placed by file date, which can be wrong.`);
if (MODE === "year") console.log(`This folder spans ${years.size} years. For one book per year, rerun with --from YYYY-01-01 --to YYYY-12-31.`);
console.log(`Review: sheets/${pickFiles[0] || "-"}..${pickFiles.at(-1) || "-"} (picks + bench), ${frameFiles.length ? `sheets/${frameFiles[0]}..${frameFiles.at(-1)} (best frame per moment), ` : ""}${moreFiles.length ? `sheets/${moreFiles[0]}..${moreFiles.at(-1)} (everything else)` : "no other moments"}`);
console.log(`Draft: ${path.join(WORK, "album.draft.json")}`);
