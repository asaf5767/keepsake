import test from "node:test";
import assert from "node:assert/strict";
import { makeEditorLayouts } from "../scripts/editor-layouts.mjs";
import { buildSpreadDecor } from "../scripts/editor-decor.mjs";

const spec = { pageWidth: 306, pageHeight: 306, bleed: 3, margin: 10, binding: 4, gutter: 3 };
const photos = [
  { frameId: "f1", id: "P001", width: 4000, height: 3000, protect: [0.15, 0.2, 0.7, 0.7], subject: "people", main: true, role: "main" },
  { frameId: "f2", id: "P002", width: 3000, height: 4000, protect: [0.2, 0.1, 0.6, 0.8], subject: "people", role: "support" },
  { frameId: "f3", id: "P003", width: 3000, height: 4000, protect: [0.15, 0.1, 0.7, 0.85], subject: "people", role: "support" },
  { frameId: "f4", id: "P004", width: 3000, height: 4000, protect: [0.2, 0.1, 0.6, 0.8], subject: "people", role: "support" },
];

test("layout families keep every stable frame once and stay inside the spread", () => {
  const options = makeEditorLayouts(photos, spec);
  assert.deepEqual(options.map((option) => option.key),
    ["portrait-lead", "reverse-lead", "framed-haven", "overlap-story", "center-note-grid", "wide-story", "portrait-row", "story-mosaic"]);
  for (const option of options.filter((candidate) => candidate.available)) {
    assert.deepEqual(new Set(option.frames.map((frame) => frame.id)), new Set(photos.map((photo) => photo.frameId)));
    assert.ok(option.wash && typeof option.wash.left === "string" && typeof option.wash.right === "string");
    assert.ok(Array.isArray(option.graphics));
    for (const frame of option.frames) {
      assert.ok(frame.box.x >= 0 && frame.box.y >= 0);
      assert.ok(frame.box.x + frame.box.w <= spec.pageWidth * 2);
      assert.ok(frame.box.y + frame.box.h <= spec.pageHeight);
    }
    for (const graphic of option.graphics) {
      assert.ok(graphic.box.x >= 0 && graphic.box.y >= 0);
      assert.ok(graphic.box.x + graphic.box.w <= spec.pageWidth * 2);
      assert.ok(graphic.box.y + graphic.box.h <= spec.pageHeight);
    }
  }
});

test("wide story is blocked when all photos are protected portraits", () => {
  const portraits = photos.map((photo) => ({ ...photo, width: 3000, height: 4000 }));
  const wide = makeEditorLayouts(portraits, spec).find((option) => option.key === "wide-story");
  assert.equal(wide.available, false);
  assert.match(wide.reason, /wide crop/);
});

test("a two-photo scene offers a facing pair without a mosaic", () => {
  const options = makeEditorLayouts(photos.slice(0, 2), spec);
  assert.ok(options.find((option) => option.key === "portrait-row").available);
  assert.equal(options.some((option) => option.key === "story-mosaic"), false);
});

test("RTL layout choices mirror the complete spread", () => {
  const ltr = makeEditorLayouts(photos, spec).find((option) => option.key === "portrait-lead");
  const rtl = makeEditorLayouts(photos, { ...spec, direction: "rtl" }).find((option) => option.key === "portrait-lead");
  for (let index = 0; index < ltr.frames.length; index++) {
    assert.ok(Math.abs(rtl.frames[index].box.x -
      (2 * spec.pageWidth - ltr.frames[index].box.x - ltr.frames[index].box.w)) < 1e-9);
  }
});

test("the date line and the spread title never overlap", () => {
  for (const option of makeEditorLayouts(photos, spec)) {
    const k = option.kickerBox, t = option.titleBox;
    const overlapX = k.x < t.x + t.w && t.x < k.x + k.w;
    const overlapY = k.y < t.y + t.h && t.y < k.y + k.h;
    assert.equal(overlapX && overlapY, false, option.key);
  }
});

test("crafted layouts attach watercolor washes, matted frames and flourishes", () => {
  const options = makeEditorLayouts(photos, spec);
  const framed = options.find((option) => option.key === "framed-haven");
  assert.ok(framed.available);
  assert.notEqual(framed.wash.right, "none");
  assert.equal(framed.frames[0].mat, true);
  assert.ok(framed.graphics.some((g) => g.kind === "flourish-heart"));

  const center = options.find((option) => option.key === "center-note-grid");
  assert.ok(center.available);
  assert.ok(center.graphics.some((g) => g.kind === "flourish-scroll"));
});

test("phrases are opt-in and do not remove washes or artwork", () => {
  const params = { sceneId: "s", spec, index: 1, recipe: "overlap-story", frames: [], texts: [] };
  const plain = buildSpreadDecor(params);
  assert.equal(plain.texts.length, 0);
  assert.ok(plain.graphics.length > 0);
  assert.notEqual(plain.wash.right, "none");
  const hebrew = buildSpreadDecor({ ...params, callouts: true, direction: "rtl" });
  assert.ok(hebrew.texts.some(t => t.role === "callout"));
  assert.ok(hebrew.texts.every(t => !/[a-z]/i.test(t.text)));
});

test("title-free layouts use the top margin for photos", () => {
  const titled = makeEditorLayouts(photos, spec).find(o => o.key === "portrait-lead");
  const quiet = makeEditorLayouts(photos, { ...spec, showHeadings: false }).find(o => o.key === "portrait-lead");
  assert.equal(quiet.frames[0].box.y, spec.bleed + spec.margin);
  assert.ok(quiet.frames[0].box.h > titled.frames[0].box.h);
  assert.equal(quiet.callouts.length, 0);
});
