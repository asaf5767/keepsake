// What is in a photo, judged by a small CLIP model that runs on this computer.
// The model (about 90 MB) is downloaded once into assets/model-cache; photos never leave the machine.
//   embed(paths)        -> one 512-number "meaning" vector per photo (null if the model is unavailable)
//   classify(vectors)   -> best-matching labels and a "not a moment" (junk) score per photo
//   cosine(a, b)        -> how alike two photos are in meaning, 0..1 (same scene is about 0.9+)

import path from "path";
import { fileURLToPath } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MODEL = "Xenova/clip-vit-base-patch32";

// Things people photograph to remember information, not moments. A book never wants them.
export const JUNK = {
  "passport": "a passport or ID card page with stamps",
  "ticket or receipt": "a receipt, ticket or boarding pass",
  "screenshot": "a screenshot of a phone screen",
  "photo of a screen": "a photo of a computer, phone or TV screen",
  "document": "a printed document or page of text",
  "menu": "a restaurant menu",
  "map": "a map",
  "code": "a QR code or barcode",
  "notes": "handwritten notes or a whiteboard",
  "accidental": "an accidental photo of the floor or the inside of a pocket",
};
export const CONTENT = {
  "people": "a photo of a family or friends",
  "selfie": "a selfie",
  "child": "a photo of a child",
  "street": "a city street",
  "building": "a building or architecture",
  "park": "a park or garden with trees",
  "landscape": "a landscape or nature view",
  "beach": "a beach or the sea",
  "food": "food or a meal on a table",
  "shop": "the inside of a shop",
  "room": "a hotel room or the inside of a home",
  "museum": "a museum or an exhibition",
  "animal": "an animal",
  "night": "a city at night",
};

let models = null;
async function load() {
  if (models !== null) return models;
  try {
    const tf = await import("@huggingface/transformers");
    tf.env.cacheDir = path.join(HERE, "..", "assets", "model-cache");
    const [processor, vision, tokenizer, text] = await Promise.all([
      tf.AutoProcessor.from_pretrained(MODEL),
      tf.CLIPVisionModelWithProjection.from_pretrained(MODEL, { dtype: "q8" }),
      tf.AutoTokenizer.from_pretrained(MODEL),
      tf.CLIPTextModelWithProjection.from_pretrained(MODEL, { dtype: "q8" }),
    ]);
    models = { tf, processor, vision, tokenizer, text };
  } catch (e) {
    console.warn(`  (photo understanding is off: ${e.message.split("\n")[0]})`);
    models = false;
  }
  return models;
}

const norm = (v) => { let s = 0; for (const x of v) s += x * x; s = Math.sqrt(s) || 1; return Float32Array.from(v, (x) => x / s); };
export const cosine = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
export const pack = (v) => Buffer.from(Float32Array.from(v).buffer).toString("base64");
export const unpack = (s) => new Float32Array(new Uint8Array(Buffer.from(s, "base64")).buffer);

export async function embed(files, onProgress) {
  const m = await load();
  if (!m) return null;
  const out = [];
  for (const [i, f] of files.entries()) {
    try {
      const image = await m.tf.RawImage.read(f);
      const { image_embeds } = await m.vision(await m.processor(image));
      out.push(norm(image_embeds.data));
    } catch { out.push(null); }
    onProgress?.(i + 1, files.length);
  }
  return out;
}

let textCache = null;
async function textVectors() {
  if (textCache) return textCache;
  const m = await load();
  if (!m) return null;
  const entries = [...Object.entries(JUNK).map(([k, v]) => ({ key: k, junk: true, text: v })), ...Object.entries(CONTENT).map(([k, v]) => ({ key: k, junk: false, text: v }))];
  const inputs = m.tokenizer(entries.map((e) => e.text), { padding: true, truncation: true });
  const { text_embeds } = await m.text(inputs);
  const dim = text_embeds.dims.at(-1);
  entries.forEach((e, i) => (e.vec = norm(text_embeds.data.slice(i * dim, (i + 1) * dim))));
  return (textCache = entries);
}

// Softmax over all labels (CLIP's scale of 100). junk = total weight of the "not a moment" labels.
export async function classify(vectors) {
  const labels = await textVectors();
  if (!labels) return null;
  return vectors.map((v) => {
    if (!v) return null;
    const logits = labels.map((l) => 100 * cosine(v, l.vec));
    const mx = Math.max(...logits);
    const ex = logits.map((x) => Math.exp(x - mx));
    const sum = ex.reduce((a, b) => a + b, 0);
    const scored = labels.map((l, i) => ({ key: l.key, junk: l.junk, p: ex[i] / sum })).sort((a, b) => b.p - a.p);
    const junk = scored.filter((s) => s.junk).reduce((a, s) => a + s.p, 0);
    return { top: scored.slice(0, 3).map((s) => `${s.key} ${s.p.toFixed(2)}`), junk: +junk.toFixed(3), junkLabel: scored.find((s) => s.junk).key, what: scored.find((s) => !s.junk).key };
  });
}
