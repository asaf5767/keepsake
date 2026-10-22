#!/usr/bin/env node
// Keepsake quality test: run cull.mjs + pick.mjs on the test roll, then check the
// picks against known answers (truth.json). The test roll is the Lisbon sample plus
// reshoots, bursts, an edited copy, a 5-star photo and a WhatsApp copy made from it.
//
// node tests/check.mjs <work-folder-of-the-test-roll>

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { unpack, cosine } from "../scripts/vision.mjs";

const WORK = path.resolve(process.argv[2] || "");
const truth = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "truth.json"), "utf8"));
const cull = JSON.parse(fs.readFileSync(path.join(WORK, "cull.json"), "utf8"));
const pick = JSON.parse(fs.readFileSync(path.join(WORK, "pick.json"), "utf8"));

const byFile = new Map(cull.photos.map((p) => [path.basename(p.file), p]));
const byCode = new Map(cull.photos.map((p) => [p.code, p]));
const code = (f) => byFile.get(f)?.code;
const picked = new Set(pick.chapters.flatMap((c) => c.picks.map((p) => p.code)));
const momentOf = new Map(pick.momentList.flatMap((m) => m.frames.map((f) => [f, m])));
// Count picked MOMENTS among a set of files, so one moment counts once whichever frame stands for it.
const pickedMoments = (files) => new Set(files.map((f) => momentOf.get(code(f))).filter((m) => m && picked.has(m.best)).map((m) => m.id)).size;

let pass = 0, fail = 0;
const check = (ok, msg) => { console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`); ok ? pass++ : fail++; };

for (const [base, variants] of Object.entries(truth.reshoots)) {
  const n = pickedMoments([base, ...variants]);
  check(n <= 1, `reshoots of ${base}: ${n} picked (want at most 1)`);
}
for (const [base, frames] of Object.entries(truth.bursts)) {
  const m = momentOf.get(code(base));
  const grouped = [base, ...frames].filter((f) => m?.frames.includes(code(f))).length;
  check(m?.best === code(base) && grouped === frames.length + 1, `burst ${base}: sharp frame chosen (${m?.best === code(base)}), ${grouped}/${frames.length + 1} frames grouped`);
}
for (const [base, later] of Object.entries(truth.sameViewLater)) {
  const n = pickedMoments([base, later]);
  check(n <= 1, `same view later (${base} and ${later}): ${n} picked (want at most 1)`);
}
{
  const o = byFile.get(truth.edited.original), e = byFile.get(truth.edited.edited);
  check(e?.status === "keep" && o?.dupOf === e?.code, `edited copy kept over its original (edited: ${e?.status}, original: ${o?.status})`);
}
{
  const m = momentOf.get(code(truth.rated));
  check(!!m && picked.has(m.best) && m.best === code(truth.rated), `5-star photo ${truth.rated} is picked`);
}
{
  const w = byFile.get(truth.whatsapp.copy), o = byFile.get(truth.whatsapp.original);
  check(w?.status === "reject" && w?.dupOf === o?.code, `WhatsApp copy treated as a copy of ${truth.whatsapp.original} (${w?.status}${w?.dupOf ? ", dup of " + byCode.get(w.dupOf)?.file : ""})`);
}
for (const f of truth.mustReject) check(byFile.get(f)?.status === "reject", `${f} rejected (${(byFile.get(f)?.reasons || []).join(", ") || byFile.get(f)?.status})`);
check(pick.chapters.every((c) => c.picks.length >= 3), `every chapter has at least 3 picks: ${pick.chapters.map((c) => c.picks.length).join(", ")}`);
{
  const vecs = [...picked].map((c) => byCode.get(c)).filter((p) => p?.emb).map((p) => ({ code: p.code, v: unpack(p.emb) }));
  let worst = null;
  for (let i = 0; i < vecs.length; i++) for (let j = i + 1; j < vecs.length; j++) { const s = cosine(vecs[i].v, vecs[j].v); if (!worst || s > worst.s) worst = { s, a: vecs[i].code, b: vecs[j].code }; }
  check(!worst || worst.s < 0.93, vecs.length ? `no two picks show the same scene (closest pair ${worst.a}/${worst.b}: ${worst.s.toFixed(2)}, limit 0.93)` : "no-repeat check skipped (photo understanding off)");
}
console.log(`\n${pass} passed, ${fail} failed · ${cull.photos.length} files -> ${pick.photos} kept -> ${pick.moments} moments -> ${picked.size} picked`);
process.exit(fail ? 1 : 0);
