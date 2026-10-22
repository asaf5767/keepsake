import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  ProjectConflictError,
  albumFingerprint,
  createEditorProject,
  loadEditorProject,
  saveEditorProject,
  validateEditorProject,
} from "../scripts/editor-project.mjs";

const album = {
  title: "Fixture",
  subtitle: "One day",
  chapterStyle: "compact",
  trimMm: 180,
  bleedMm: 3,
  cover: { photos: ["P001", "P002", "P003"] },
  photoSettings: { P001: { protect: [0.2, 0.1, 0.6, 0.8] } },
  chapters: [{ title: "Morning", kicker: "1 April", scenes: [
    { title: "First scene", photos: [{ id: "P001", role: "main" }, "P002", "P003"] },
    { title: "Second scene", photos: ["P004", { id: "P005", role: "main" }] },
  ] }],
};
const layout = {
  scenes: [
    {
      id: "chapter-01-scene-01", recipe: "portrait-lead",
      frames: [
        { id: "chapter-01-scene-01-frame-01", photo: "P001", role: "main", box: { x: 15, y: 30, w: 150, h: 140 } },
        { id: "chapter-01-scene-01-frame-02", photo: "P002", box: { x: 201, y: 30, w: 75, h: 68 } },
        { id: "chapter-01-scene-01-frame-03", photo: "P003", box: { x: 201, y: 102, w: 75, h: 68 } },
      ],
      texts: [
        { id: "chapter-01-scene-01-title", role: "title", text: "First scene", box: { x: 15, y: 12, w: 150, h: 12 } },
      ],
    },
    {
      id: "chapter-01-scene-02", recipe: "facing-pair",
      frames: [
        { id: "chapter-01-scene-02-frame-01", photo: "P004", box: { x: 15, y: 30, w: 150, h: 140 } },
        { id: "chapter-01-scene-02-frame-02", photo: "P005", role: "main", box: { x: 201, y: 30, w: 150, h: 140 } },
      ],
      texts: [],
    },
  ],
};
const codes = new Set(["P001", "P002", "P003", "P004", "P005"]);

test("a project has stable spread, frame and text identities", () => {
  const first = createEditorProject({ album, layout, albumPath: "C:\\work\\album.json" });
  const second = createEditorProject({ album, layout, albumPath: "C:\\work\\album.json" });
  assert.deepEqual(first.order, ["chapter-01-scene-01", "chapter-01-scene-02"]);
  assert.deepEqual(first.spreads[first.order[0]].frames.map((frame) => frame.id),
    second.spreads[second.order[0]].frames.map((frame) => frame.id));
  assert.equal(first.source.fingerprint, albumFingerprint(album));
  assert.notEqual(first.id, second.id);
  validateEditorProject(first, { album, photoCodes: codes });
});

test("save is atomic, revisioned and reloadable", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "keepsake-project-"));
  try {
    const file = path.join(root, "album.project.json");
    const project = createEditorProject({ album, layout });
    const saved = await saveEditorProject(file, project, { expectedRevision: 0, album, photoCodes: codes });
    assert.equal(saved.revision, 1);
    saved.spreads[saved.order[0]].title = "Changed";
    const savedAgain = await saveEditorProject(file, saved, { expectedRevision: 1, album, photoCodes: codes });
    assert.equal(savedAgain.revision, 2);
    assert.deepEqual(await loadEditorProject(file, { album, photoCodes: codes }), savedAgain);
    await assert.rejects(
      saveEditorProject(file, savedAgain, { expectedRevision: 1, album, photoCodes: codes }),
      ProjectConflictError,
    );
    assert.deepEqual((await fs.readdir(root)).sort(), ["album.project.json"]);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("album structure changes and unsafe project input are rejected", () => {
  const project = createEditorProject({ album, layout });
  const changed = structuredClone(album);
  changed.chapters[0].scenes[0].photos.pop();
  assert.throws(() => validateEditorProject(project, { album: changed, photoCodes: codes }), /does not match/);
  project.spreads[project.order[0]].frames[0].box.x = -1;
  assert.throws(() => validateEditorProject(project, { album, photoCodes: codes }), /invalid spread box/);
});
