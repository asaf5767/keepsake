import test from "node:test";
import assert from "node:assert/strict";
import { albumFingerprint, createEditorProject, validateEditorProject } from "../scripts/editor-project.mjs";
import { STYLE_PRESETS, applyStylePreset, choosePresetLayout, resolveAlbumStyle } from "../scripts/style-presets.mjs";
import { makeEditorLayouts } from "../scripts/editor-layouts.mjs";

const album = {
  title: "An existing book", trimMm: 180,
  chapters: [{ scenes: [{ id: "scene-1", title: "", photos: [
    { id: "P001", role: "main" }, "P002", "P003",
  ] }] }],
};
const frames = ["P001", "P002", "P003"].map((photo, i) => ({
  id: `scene-1-frame-${i}`, photo, role: i ? "support" : "main",
  box: { x: i ? 201 : 15, y: i === 2 ? 105 : 32, w: i ? 72 : 150, h: i ? 64 : 138 },
  fit: "contain", focusX: 40, focusY: 65, zoom: 1, mat: false, hidden: false,
}));
const layout = { scenes: [{ id: "scene-1", recipe: "portrait-lead", frames, texts: [] }] };
const photos = new Map(frames.map(frame => [frame.photo, {
  id: frame.photo, width: 1600, height: 1200, subject: "people",
  protect: [0.25, 0.15, 0.5, 0.7],
}]));

test("presets resolve coordinated defaults, preserve explicit overrides and reject unknown keys", () => {
  assert.deepEqual(resolveAlbumStyle(album), album);
  for (const [key, preset] of Object.entries(STYLE_PRESETS)) {
    const resolved = resolveAlbumStyle({ ...album, stylePreset: key, direction: "rtl" });
    assert.equal(resolved.theme, preset.theme);
    assert.equal(resolved.decor, preset.decor);
    assert.equal(resolved.font, "Heebo");
    assert.equal(resolved.callouts, false);
    assert.equal(resolved.showHeadings, false);
    const custom = resolveAlbumStyle({ ...album, stylePreset: key, theme: "white", font: "Heebo", showHeadings: true });
    assert.equal(custom.theme, "white");
    assert.equal(custom.font, "Heebo");
    assert.equal(custom.showHeadings, true);
  }
  for (const stylePreset of ["missing", "constructor", null, 7]) {
    assert.throws(() => resolveAlbumStyle({ ...album, stylePreset }), /Unknown stylePreset/);
  }
});

test("applying a preset preserves manual edits and the original project, with optional safe reflow", () => {
  const project = createEditorProject({ album, layout });
  const spread = project.spreads["scene-1"];
  spread.frames = structuredClone(frames);
  spread.texts.push({ id: "my-note", text: "My own words", role: "note", color: "#884422",
    fontPt: 11, weight: 500, align: "right", box: { x: 30, y: 12, w: 100, h: 14 }, hidden: false });
  spread.graphics.push({ id: "scene-1-graphic-abcdef12", kind: "boho-arrow",
    box: { x: 40, y: 160, w: 40, h: 10 }, color: "#884422", hidden: false });
  const original = structuredClone(project);
  for (const key of Object.keys(STYLE_PRESETS)) {
    const styled = applyStylePreset(project, key);
    const edited = styled.spreads["scene-1"];
    assert.deepEqual(project, original);
    assert.deepEqual(styled.order, original.order);
    assert.deepEqual(edited.frames.map(({ mat, ...frame }) => frame), frames.map(({ mat, ...frame }) => frame));
    assert.ok(edited.frames.every(frame => frame.mat === STYLE_PRESETS[key].frameMat));
    assert.deepEqual(edited.texts.find(text => text.id === "my-note"), spread.texts.find(text => text.id === "my-note"));
    assert.deepEqual(edited.graphics.find(graphic => graphic.id.endsWith("abcdef12")),
      spread.graphics.find(graphic => graphic.id.endsWith("abcdef12")));
    assert.equal(styled.source.fingerprint, project.source.fingerprint);
    validateEditorProject(styled, { album, photoCodes: new Set(photos.keys()) });
    const reflowed = applyStylePreset(project, key, { photos, resetLayouts: true });
    assert.deepEqual(new Set(reflowed.spreads["scene-1"].frames.map(frame => frame.id)), new Set(frames.map(frame => frame.id)));
    validateEditorProject(reflowed, { album, photoCodes: new Set(photos.keys()) });
  }
  const failed = new Map();
  assert.throws(() => applyStylePreset(project, "modern", { resetLayouts: true, photos: failed }), /not available/);
  assert.deepEqual(project, original, "a failed reflow cannot partly modify the project");
});

test("preset project creation uses resolved settings while preserving legacy fingerprint compatibility", () => {
  const old = createEditorProject({ album, layout });
  assert.equal(old.book.stylePreset, undefined);
  assert.equal(old.book.theme, "white");
  for (const key of Object.keys(STYLE_PRESETS)) {
    const source = { ...album, stylePreset: key };
    const project = createEditorProject({ album: source, layout });
    assert.equal(project.book.stylePreset, key);
    assert.equal(project.book.theme, STYLE_PRESETS[key].theme);
    assert.equal(project.book.showHeadings, false);
    assert.equal(project.source.fingerprint, albumFingerprint(source));
    validateEditorProject(project, { album: source, photoCodes: new Set(photos.keys()) });
  }
  old.book.stylePreset = "unknown";
  assert.throws(() => validateEditorProject(old), /Unknown stylePreset/);
});

test("preset layout selection never chooses unsafe candidates or an empty title pocket", () => {
  const spec = createEditorProject({ album, layout }).book.geometry;
  const choices = makeEditorLayouts([...photos.values()].map((photo, i) => ({
    ...photo, main: i === 0, role: i ? "support" : "main", frameId: frames[i].id,
  })), { ...spec, showHeadings: false });
  for (const key of Object.keys(STYLE_PRESETS)) {
    const selected = choosePresetLayout(choices, key);
    assert.ok(selected.available);
    assert.equal(selected.titleTile, false);
  }
  assert.equal(choosePresetLayout(choices.map(choice => ({ ...choice, available: false })), "modern"), undefined);
});
