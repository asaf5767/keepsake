import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { createEditorProject, saveEditorProject } from "../scripts/editor-project.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, "..", "scripts", "package.json"));
const sharp = require("sharp");
const { PDFDocument } = require("pdf-lib");
const script = path.join(here, "..", "scripts", "build.mjs");

test("photo-first, RTL and legacy PDF output preserve the rendering contract", { timeout: 240000 }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "keepsake-render-"));
  try {
    const photos = [];
    for (let i = 1; i <= 6; i++) {
      const portrait = i % 2 === 1;
      const width = portrait ? 1200 : 1600, height = portrait ? 1600 : 1200;
      const file = path.join(root, `photo-${i}.jpg`);
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#b3cad8"/><rect x="${width * 0.25}" y="${height * 0.15}" width="${width * 0.5}" height="${height * 0.7}" fill="#b44338"/></svg>`;
      await sharp(Buffer.from(svg)).jpeg().toFile(file);
      photos.push({ code: `P00${i}`, file, path: file, width, height, aspect: width / height,
        date: `2026-04-01T10:0${i}:00`, quality: 0.8, status: "keep", flags: [], vision: { what: "people" } });
    }
    await fs.writeFile(path.join(root, "cull.json"), JSON.stringify({ photos }));
    const base = {
      title: "Fixture", trimMm: 180, minPages: 0, cull: path.join(root, "cull.json"),
      cover: { photos: ["P001", "P002", "P003"] }, titlePage: { photo: "P002" },
      closing: { photo: "P006" },
      photoSettings: Object.fromEntries(photos.map((p) => [p.code, { protect: [0.25, 0.15, 0.5, 0.7] }])),
      chapters: [{ title: "One day", kicker: "1 April", scenes: [
        { title: "First scene", photos: [{ id: "P001", role: "main" }, "P002", "P003"] },
        { title: "Second scene", photos: ["P004", { id: "P005", role: "main" }, "P006"] },
      ] }],
    };
    for (const mode of ["compact", "rtl", "color"]) {
      const dir = path.join(root, mode);
      await fs.mkdir(dir);
      const album = structuredClone(base);
      if (mode === "rtl") {
        album.direction = "rtl";
        album.title = "ספר תמונות";
        album.chapters[0].scenes[0].title = "יום בעיר";
      }
      if (mode === "color") {
        album.chapterStyle = "color";
        album.chapters = [{ title: "Legacy day", photos: photos.map((p) => p.code) }];
      }
      const manifest = path.join(dir, "album.json");
      await fs.writeFile(manifest, JSON.stringify(album));
      const run = spawnSync(process.execPath, [script, manifest], { encoding: "utf8", timeout: 90000 });
      assert.equal(run.status, 0, `${mode}: ${run.error || ""}\n${run.stdout}\n${run.stderr}`);
      const out = path.join(dir, "book");
      const layout = JSON.parse(await fs.readFile(path.join(out, "layout.json"), "utf8"));
      assert.match(layout.sourceFingerprint, /^[0-9a-f]{64}$/);
      const inside = await PDFDocument.load(await fs.readFile(path.join(out, "interior.pdf")));
      const reading = await PDFDocument.load(await fs.readFile(path.join(out, "album.pdf")));
      assert.equal(inside.getPageCount(), layout.pageCount);
      assert.equal(reading.getPageCount(), inside.getPageCount() + 1);
      const ptToMm = (x) => x * 25.4 / 72;
      for (const page of inside.getPages()) {
        assert.ok(Math.abs(ptToMm(page.getMediaBox().width) - 186) < 1e-6);
        assert.ok(Math.abs(ptToMm(page.getTrimBox().width) - 180) < 1e-6);
      }
      assert.ok(Math.abs(ptToMm(reading.getPage(0).getCropBox().width) - 180) < 1e-6);
      if (mode !== "color") {
        assert.equal(layout.pageCount, 6);
        assert.equal(layout.scenes.length, 2);
        assert.deepEqual(new Set(layout.scenes[0].photos), new Set(["P001", "P002", "P003"]));
        assert.deepEqual(new Set(layout.scenes[1].photos), new Set(["P004", "P005", "P006"]));
        assert.ok(layout.coverage.every((p) => !["opener", "blank", "band"].includes(p.kind)));
        for (const p of layout.placements) {
          assert.ok(p.rect.w > 0 && p.rect.h > 0);
          const [x, y, w, h] = p.protection;
          assert.ok(p.crop.left <= x * p.sourceSize.width);
          assert.ok(p.crop.top <= y * p.sourceSize.height);
          assert.ok(p.crop.left + p.crop.width >= (x + w) * p.sourceSize.width);
          assert.ok(p.crop.top + p.crop.height >= (y + h) * p.sourceSize.height);
        }
        assert.ok(layout.scenes.every((scene) => scene.id && scene.frames.length && scene.texts.length));
      } else {
        assert.ok(layout.coverage.some((p) => p.kind === "opener"));
      }
      assert.match(await fs.readFile(path.join(out, "preview.html"), "utf8"), /Download album PDF/);
      if (mode !== "color") {
        const projectFile = path.join(dir, "album.project.json");
        const project = createEditorProject({ album, layout, albumPath: manifest });
        project.order.reverse();
        const spread = project.spreads[project.order[0]];
        const editedTitle = mode === "rtl" ? "סצנה ערוכה" : "Edited second scene";
        spread.title = editedTitle;
        const title = spread.texts.find((text) => text.role === "title");
        title.text = editedTitle;
        const moved = spread.frames[0];
        moved.photo = "P001";
        moved.box.x += 8;
        const saved = await saveEditorProject(projectFile, project, {
          expectedRevision: 0,
          album,
          photoCodes: new Set(photos.map((photo) => photo.code)),
        });
        const editedOut = path.join(dir, "edited-book");
        const edited = spawnSync(process.execPath, [
          script, manifest, "--project", projectFile, "--out", editedOut,
        ], { encoding: "utf8", timeout: 90000 });
        assert.equal(edited.status, 0, `${edited.error || ""}\n${edited.stdout}\n${edited.stderr}`);
        const editedLayout = JSON.parse(await fs.readFile(path.join(editedOut, "layout.json"), "utf8"));
        assert.equal(editedLayout.editorProject.revision, saved.revision);
        assert.equal(editedLayout.scenes[0].id, project.order[0]);
        assert.equal(editedLayout.scenes[0].frames[0].photo, "P001");
        assert.equal(editedLayout.scenes[0].frames[0].box.x, moved.box.x);
        assert.equal(editedLayout.scenes[0].texts.find((text) => text.role === "title").text, editedTitle);
        assert.match(await fs.readFile(path.join(editedOut, "interior.html"), "utf8"), new RegExp(editedTitle));
        const editedPdf = await PDFDocument.load(await fs.readFile(path.join(editedOut, "interior.pdf")));
        assert.equal(editedPdf.getPageCount(), layout.pageCount);
      }
    }
    const invalid = structuredClone(base);
    invalid.photoSettings.P001.protect = [0.9, 0.9, 0.8, 0.8];
    const invalidPath = path.join(root, "invalid.json");
    await fs.writeFile(invalidPath, JSON.stringify(invalid));
    const bad = spawnSync(process.execPath, [script, invalidPath], { encoding: "utf8", timeout: 10000 });
    assert.notEqual(bad.status, 0);
    assert.match(bad.stderr, /P001: protect/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
