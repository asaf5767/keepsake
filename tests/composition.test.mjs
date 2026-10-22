import test from "node:test";
import assert from "node:assert/strict";
import { imagePlacement, placementCost, validateProtection } from "../scripts/composition.mjs";

const photo = (extras = {}) => ({ id: "P001", p: { code: "P001", width: 4000, height: 3000 }, ...extras });
const square = { x: 12, y: 12, w: 276, h: 276 };

test("a protected family at the edge shifts the crop instead of losing faces", () => {
  const item = photo({ protect: [0.7, 0.3, 0.29, 0.6], focus: "0% 0%" });
  const p = imagePlacement(item, square);
  assert.equal(p.fill, 1);
  assert.ok(p.crop.left + p.crop.width >= 3960);
  assert.ok(p.crop.left <= 2800);
  assert.ok(p.crop.top + p.crop.height >= 2700);
});

test("a crop that cannot hold the entire protected group uses the whole photograph", () => {
  const p = imagePlacement(photo({ protect: [0.01, 0.1, 0.98, 0.8] }), square);
  assert.deepEqual(p.crop, { left: 0, top: 0, width: 4000, height: 3000 });
  assert.equal(p.rect.w, 276);
  assert.ok(Math.abs(p.rect.h - 207) < 1e-9);
  assert.equal(p.reason, "subject does not fit the crop");
});

test("unannotated people are not auto-cropped", () => {
  const item = photo();
  item.p.vision = { what: "people" };
  assert.equal(imagePlacement(item, square).crop.width, 4000);
  assert.equal(imagePlacement({ ...item, protect: [0.3, 0.3, 0.2, 0.3] }, square).fill, 1);
});

test("explicit contain works even for a scene the model did not label as people", () => {
  assert.ok(Math.abs(imagePlacement(photo({ fit: "contain" }), square).rect.h - 207) < 1e-9);
});

test("portrait people remain visible in a wide cell", () => {
  const item = { id: "portrait", p: { width: 3000, height: 4000 }, protect: [0.1, 0.05, 0.8, 0.9] };
  const p = imagePlacement(item, { x: 0, y: 0, w: 270, h: 125 });
  assert.equal(p.crop.height, 4000);
  assert.equal(p.rect.h, 125);
  assert.equal(p.rect.w, 93.75);
});

test("matching aspect ratios fill the box without cutting the source", () => {
  const p = imagePlacement(photo({ protect: [0, 0, 1, 1] }), { x: 0, y: 0, w: 200, h: 150 });
  assert.equal(p.fill, 1);
  assert.equal(p.crop.width, 4000);
  assert.equal(p.crop.height, 3000);
});

test("the scorer prefers subject-safe cells that actually fill the page", () => {
  const item = photo({ protect: [0.05, 0.1, 0.9, 0.8] });
  assert.ok(placementCost(item, { x: 0, y: 0, w: 240, h: 180 }) <
    placementCost(item, { x: 0, y: 0, w: 80, h: 260 }));
});

test("malformed subject rectangles and focus points fail explicitly", () => {
  for (const rect of [[0.5, 0, 0.7, 1], [-0.1, 0, 1, 1], [0, 0, 0, 1], [0, 0, NaN, 1], "face"]) {
    assert.throws(() => validateProtection(rect), /protect/);
  }
  assert.throws(() => imagePlacement(photo({ focus: "200% 50%" }), square), /focus/);
});

test("portrait and landscape boxes preserve normalized protected bounds", () => {
  for (const w of [80, 130, 270]) for (const h of [90, 180, 270]) {
    const item = photo({ protect: [0.17, 0.27, 0.6, 0.5] });
    const { crop } = imagePlacement(item, { x: 3, y: 3, w, h });
    assert.ok(crop.left <= 680 && crop.top <= 810);
    assert.ok(crop.left + crop.width >= 3080 && crop.top + crop.height >= 2310);
  }
});
