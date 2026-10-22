#!/usr/bin/env node
// Keepsake taste memory: photos the user removed, kept across all future books.
// Each entry stores the photo's meaning vector (no image), so cull.mjs can reject
// photos like it next time. Lives in ~/.keepsake/taste.json, outside the skill folder.
//
//   node taste.mjs <work> never <code> [<code>...] --note "passports"
//   node taste.mjs list
//   node taste.mjs forget <number>

import fs from "fs/promises";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { cosine, unpack } from "./vision.mjs";

export const TASTE_FILE = path.join(os.homedir(), ".keepsake", "taste.json");
export const TASTE_MATCH = 0.86;   // how close in meaning a photo must be to a removed one

export async function loadTaste() {
  try { const t = JSON.parse(await fs.readFile(TASTE_FILE, "utf8")); t.never = (t.never || []).map((e) => ({ ...e, vec: unpack(e.emb) })); return t; }
  catch { return { never: [] }; }
}
// The removed photo this one is most like, if it is close enough.
export function tasteMatch(taste, vec) {
  if (!vec || !taste.never.length) return null;
  let best = null;
  for (const e of taste.never) { const s = cosine(vec, e.vec); if (!best || s > best.s) best = { s, note: e.note }; }
  return best && best.s >= TASTE_MATCH ? best : null;
}

async function save(t) {
  await fs.mkdir(path.dirname(TASTE_FILE), { recursive: true });
  await fs.writeFile(TASTE_FILE, JSON.stringify({ never: t.never.map(({ vec, ...e }) => e) }, null, 1));
}

if (path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const taste = await loadTaste();
  if (args[0] === "list") {
    if (!taste.never.length) console.log("No removed photos remembered yet.");
    taste.never.forEach((e, i) => console.log(`${i + 1}. ${e.note}  (from ${e.from}, ${e.added.slice(0, 10)})`));
  } else if (args[0] === "forget") {
    const i = Number(args[1]) - 1;
    if (!taste.never[i]) { console.error("No such entry; see: node taste.mjs list"); process.exit(1); }
    const [gone] = taste.never.splice(i, 1);
    await save(taste);
    console.log(`Forgot: ${gone.note}`);
  } else if (args[1] === "never") {
    const work = path.resolve(args[0]);
    const ni = args.indexOf("--note");
    const note = ni >= 0 ? args[ni + 1] : null;
    const codes = args.slice(2).filter((_, i) => i + 2 !== ni && i + 2 !== ni + 1);
    if (!note || !codes.length) { console.error('usage: node taste.mjs <work> never <code>... --note "what this is"'); process.exit(1); }
    const cull = JSON.parse(await fs.readFile(path.join(work, "cull.json"), "utf8"));
    for (const code of codes) {
      const p = cull.photos.find((x) => x.code === code);
      if (!p?.emb) { console.error(`${code}: not found, or it has no meaning vector (run cull.mjs with photo understanding on)`); continue; }
      taste.never.push({ note, emb: p.emb, from: path.basename(p.file), added: new Date().toISOString() });
      console.log(`Remembered ${code} (${path.basename(p.file)}) as "${note}". Future books will skip photos like it.`);
    }
    await save(taste);
  } else {
    console.error('usage:\n  node taste.mjs <work> never <code>... --note "what this is"\n  node taste.mjs list\n  node taste.mjs forget <number>');
    process.exit(1);
  }
}
