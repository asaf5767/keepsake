import test from "node:test";
import assert from "node:assert/strict";
import { placementWarnings, protectedBounds, resolveFramePlacement } from "../scripts/editor-placement.mjs";

const portrait = { id: "P001", width: 3000, height: 4000, subject: "people", protect: [0.2, 0.1, 0.6, 0.8] };
const box = { x: 20, y: 30, w: 120, h: 220 };

test("safe and contained frames keep a marked subject", () => {
  for (const fit of ["safe", "contain"]) {
    const placement = resolveFramePlacement(portrait, { fit, box, focusX: 50, focusY: 50, zoom: 1 });
    assert.equal(protectedBounds(portrait, placement).clipped, false);
    assert.deepEqual(placementWarnings(portrait, placement, { pageWidth: 306, binding: 4 }), []);
  }
});

test("manual fill uses focus and zoom and reports a clipped subject", () => {
  const placement = resolveFramePlacement(portrait, {
    fit: "cover", box: { x: 20, y: 30, w: 240, h: 80 }, focusX: 0, focusY: 0, zoom: 2,
  });
  assert.equal(placement.reason, "manual crop");
  assert.ok(placement.crop.width < portrait.width);
  assert.match(placementWarnings(portrait, placement, { pageWidth: 306, binding: 4 }).join(" "), /outside the crop/);
});

test("a subject crossing the binding is reported", () => {
  const placement = resolveFramePlacement(portrait, {
    fit: "contain", box: { x: 250, y: 30, w: 120, h: 220 }, focusX: 50, focusY: 50, zoom: 1,
  });
  assert.match(placementWarnings(portrait, placement, { pageWidth: 306, binding: 4 }).join(" "), /centre fold/);
});
