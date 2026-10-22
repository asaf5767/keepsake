import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { startEditorServer } from "../scripts/editor-server.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, "..", "scripts", "package.json"));
const sharp = require("sharp");

test("the loopback editor saves, rejects stale writes, reopens and exports", { timeout: 240000 }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "keepsake-editor-"));
  let editor;
  try {
    const photos = [];
    for (let i = 1; i <= 4; i++) {
      const width = i % 2 ? 1200 : 1600, height = i % 2 ? 1600 : 1200;
      const file = path.join(root, `photo-${i}.jpg`);
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#c6d6c1"/><circle cx="${width / 2}" cy="${height / 2}" r="${Math.min(width, height) / 4}" fill="#a9483c"/></svg>`;
      await sharp(Buffer.from(svg)).jpeg().toFile(file);
      photos.push({
        code: `P00${i}`, file: path.basename(file), path: file, width, height,
        aspect: width / height, date: `2026-04-01T10:0${i}:00`, quality: 0.8,
        status: "keep", vision: { what: "people" },
      });
    }
    await fs.writeFile(path.join(root, "cull.json"), JSON.stringify({ photos }));
    const album = {
      title: "Editor fixture", subtitle: "Local and saved", chapterStyle: "compact",
      trimMm: 180, minPages: 0, cull: "cull.json",
      cover: { photos: ["P001", "P002", "P003"] },
      titlePage: { photo: "P002" }, closing: { photo: "P004" },
      photoSettings: Object.fromEntries(photos.map((photo) => [photo.code, {
        subject: "people", protect: [0.25, 0.2, 0.5, 0.65],
      }])),
      chapters: [{ title: "One day", kicker: "1 April", scenes: [
        { title: "A saved spread", photos: [{ id: "P001", role: "main" }, "P002", "P003"] },
      ] }],
    };
    const albumPath = path.join(root, "album.json");
    await fs.writeFile(albumPath, JSON.stringify(album));
    editor = await startEditorServer({ albumPath, port: 0, token: "test-token" });
    const base = `http://127.0.0.1:${editor.port}`;
    const auth = { "X-Keepsake-Token": "test-token" };

    assert.equal((await fetch(`${base}/api/project`)).status, 403);
    const firstResponse = await fetch(`${base}/api/project`, { headers: auth });
    assert.equal(firstResponse.status, 200);
    const first = await firstResponse.json();
    assert.equal(first.project.revision, 1);
    assert.equal(first.photos.length, 4);
    assert.equal((await fetch(`${base}/photo/P001`)).status, 403);
    assert.equal((await fetch(`${base}/photo/P001`, { headers: auth })).status, 200);

    const changed = structuredClone(first.project);
    const spread = changed.spreads[changed.order[0]];
    spread.title = "Reopened exactly";
    spread.texts.find((text) => text.role === "title").text = "Reopened exactly";
    spread.frames[0].box.x += 7;
    const savedResponse = await fetch(`${base}/api/project`, {
      method: "PUT",
      headers: { ...auth, "Content-Type": "application/json", "If-Match": "1" },
      body: JSON.stringify(changed),
    });
    assert.equal(savedResponse.status, 200);
    const saved = (await savedResponse.json()).project;
    assert.equal(saved.revision, 2);

    const stale = await fetch(`${base}/api/project`, {
      method: "PUT",
      headers: { ...auth, "Content-Type": "application/json", "If-Match": "1" },
      body: JSON.stringify(changed),
    });
    assert.equal(stale.status, 409);

    const exported = await fetch(`${base}/api/export`, { method: "POST", headers: auth });
    assert.equal(exported.status, 200, await exported.text());
    const layout = JSON.parse(await fs.readFile(path.join(root, "book", "layout.json"), "utf8"));
    assert.equal(layout.editorProject.revision, 2);
    assert.equal(layout.scenes[0].texts.find((text) => text.role === "title").text, "Reopened exactly");
    assert.equal(layout.scenes[0].frames[0].box.x, spread.frames[0].box.x);

    await editor.close();
    editor = await startEditorServer({ albumPath, port: 0, token: "second-token" });
    const reopened = await (await fetch(`http://127.0.0.1:${editor.port}/api/project`, {
      headers: { "X-Keepsake-Token": "second-token" },
    })).json();
    assert.equal(reopened.project.revision, 2);
    assert.equal(reopened.project.spreads[reopened.project.order[0]].title, "Reopened exactly");
    assert.equal(reopened.hasOutput, true);
    assert.equal(reopened.export.revision, 2);
  } finally {
    if (editor?.server.listening) await editor.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
