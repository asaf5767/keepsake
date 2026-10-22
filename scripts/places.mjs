// Offline place names: the town or city for a GPS point, looked up in a bundled
// GeoNames list (assets/places, CC BY 4.0). No location ever leaves the computer.

import fs from "fs";
import zlib from "zlib";
import path from "path";
import { fileURLToPath } from "url";

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "assets", "places");
let cells = null, countries = null;

function load() {
  if (cells) return;
  cells = new Map();
  const text = zlib.gunzipSync(fs.readFileSync(path.join(DIR, "cities1000.tsv.gz"))).toString("utf8");
  for (const line of text.split("\n")) {
    const [name, la, ln, cc, pop] = line.split("\t");
    const lat = +la, lng = +ln;
    if (!name || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const key = `${Math.floor(lat)}:${Math.floor(lng)}`;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push({ name, lat, lng, cc, pop: +pop || 0 });
  }
  countries = new Map(fs.readFileSync(path.join(DIR, "countries.tsv"), "utf8").split("\n").map((l) => l.trim().split("\t")));
}

const rad = Math.PI / 180;
function km(aLat, aLng, bLat, bLng) {
  const s = Math.sin(((bLat - aLat) * rad) / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(((bLng - aLng) * rad) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(s));
}
export { km as distanceKm };

// A big city wins over a closer village until the village is clearly nearer:
// score = log10(population) - 2 * log10(1 + km). A part of a city ("East X")
// gives way to the city itself, and spots more than 12 km from the winner stay
// unnamed: a far-away city would be a misleading label.
export function findPlace(lat, lng) {
  load();
  let best = null, bestScore = -Infinity, nearest = null, nearestKm = Infinity;
  const near = [];
  const cy = Math.floor(lat), cx = Math.floor(lng);
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    for (const p of cells.get(`${cy + dy}:${cx + dx}`) || []) {
      const d = km(lat, lng, p.lat, p.lng);
      if (d < nearestKm) { nearestKm = d; nearest = p; }
      if (d > 40) continue;
      near.push({ p, d });
      const s = Math.log10(Math.max(p.pop, 1000)) - 2 * Math.log10(1 + d);
      if (s > bestScore) { bestScore = s; best = { p, d }; }
    }
  }
  const country = (p) => countries.get(p.cc) || p.cc;
  if (best && best.d <= 12) {
    const whole = near.find((x) => x.d <= 12 && x.p !== best.p && best.p.name.endsWith(" " + x.p.name));
    const p = whole ? whole.p : best.p;
    // The nearest neighbourhood or village, for telling apart two days in the same city.
    const local = nearest && nearestKm <= 2.5 && nearest.name !== p.name ? nearest.name : null;
    return { place: p.name, local, country: country(p) };
  }
  // Near borders the nearest village can be across the line, so name a country only when both agree.
  if (nearest && nearestKm < 150 && (!best || best.p.cc === nearest.cc)) return { place: null, country: country(nearest) };
  return { place: null, country: null };
}
