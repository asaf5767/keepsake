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
const puppeteer = require("puppeteer-core");

const edge = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

test("Storyboard edits persist and export through the browser workflow", { timeout: 240000 }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "keepsake-editor-ui-"));
  let editor, browser;
  try {
    const photos = [];
    for (let i = 1; i <= 6; i++) {
      const portrait = i % 2 === 0;
      const width = portrait ? 1200 : 1600, height = portrait ? 1600 : 1200;
      const file = path.join(root, `photo-${i}.jpg`);
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="${i < 4 ? "#c5d7bd" : "#c8d2e5"}"/><rect x="${width * .25}" y="${height * .16}" width="${width * .5}" height="${height * .68}" fill="#a84c40"/></svg>`;
      await sharp(Buffer.from(svg)).jpeg().toFile(file);
      photos.push({
        code: `P00${i}`, file: path.basename(file), path: file, width, height,
        aspect: width / height, date: `2026-04-0${i < 4 ? 1 : 2}T10:0${i}:00`,
        quality: 0.8, status: "keep", vision: { what: "people" },
      });
    }
    await fs.writeFile(path.join(root, "cull.json"), JSON.stringify({ photos }));
    const album = {
      title: "UI fixture", subtitle: "Two scenes", chapterStyle: "compact",
      trimMm: 180, minPages: 0, cull: "cull.json",
      cover: { photos: ["P001", "P002", "P003"] }, titlePage: { photo: "P002" },
      closing: { photo: "P006" },
      photoSettings: Object.fromEntries(photos.map((photo) => [photo.code, {
        subject: "people", protect: [0.25, 0.16, 0.5, 0.68],
      }])),
      chapters: [{ title: "The trip", kicker: "April", scenes: [
        { title: "First scene", photos: [{ id: "P001", role: "main" }, "P002", "P003"] },
        { title: "Second scene", photos: [{ id: "P004", role: "main" }, "P005", "P006"] },
      ] }],
    };
    const albumPath = path.join(root, "album.json");
    await fs.writeFile(albumPath, JSON.stringify(album));
    editor = await startEditorServer({ albumPath, port: 0, token: "ui-token" });
    browser = await puppeteer.launch({ executablePath: edge, headless: true, defaultViewport: { width: 1440, height: 950 } });
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(editor.url, { waitUntil: "networkidle0" });
    await page.waitForFunction(() => !!window.keepsakeEditor);

    const initial = await page.evaluate(() => window.keepsakeEditor.getProject());
    const firstId = initial.order[0], secondId = initial.order[1];
    await page.click(`[data-spread="${firstId}"] [data-action="move"][data-delta="1"]`);
    assert.deepEqual((await page.evaluate(() => window.keepsakeEditor.getProject())).order, [secondId, firstId]);

    await page.click(`[data-spread="${firstId}"] [data-action="open-spread"]`);
    await page.click('[data-action="layouts"]');
    await page.click('[data-layout="portrait-row"]');
    await page.click('[data-action="apply-layout"]');

    const textFit = await page.evaluate(() => [...document.querySelectorAll('#spread-canvas [data-kind="text"]')]
      .map((el) => ({ text: el.textContent.trim(), fits: el.scrollHeight <= el.clientHeight + 2 })));
    assert.ok(textFit.some((item) => item.text === "First scene"), "the spread title is drawn on the canvas");
    assert.ok(textFit.every((item) => item.fits), `text layers fit their boxes: ${JSON.stringify(textFit)}`);

    const frameSelector = "#spread-canvas [data-kind=frame]";
    await page.click(frameSelector);
    await page.click('[data-action="photos"]');
    await page.click('[data-action="photo-filter"][data-filter="all"]');
    await page.click('[data-action="replace-photo"][data-photo="P006"]');

    await page.click('[data-action="add-text"]');
    await page.locator("#wording").fill("Saved in the Keepsake project");
    await page.click('[data-action="apply-text"]');

    await page.click('[data-action="decor"]');
    await page.select('[data-wash-side="left"]', "rose");
    await page.click('[data-action="add-graphic"][data-graphic="boho-arrow"]');

    await page.click(frameSelector);
    const beforeDrag = await page.evaluate(() => {
      const project = window.keepsakeEditor.getProject();
      const spread = project.spreads[window.keepsakeEditor.currentSpread()];
      return spread.frames.find((frame) => !frame.hidden).box.x;
    });
    const frame = await page.$(frameSelector);
    const rect = await frame.boundingBox();
    await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
    await page.mouse.down();
    await page.mouse.move(rect.x + rect.width / 2 + 30, rect.y + rect.height / 2 + 8, { steps: 5 });
    await page.mouse.up();
    const afterDrag = await page.evaluate(() => {
      const project = window.keepsakeEditor.getProject();
      const spread = project.spreads[window.keepsakeEditor.currentSpread()];
      return spread.frames.find((frame) => !frame.hidden).box.x;
    });
    assert.notEqual(afterDrag, beforeDrag);

    const beforeResize = await page.evaluate(() => {
      const project = window.keepsakeEditor.getProject();
      const spread = project.spreads[window.keepsakeEditor.currentSpread()];
      return spread.frames.find((frame) => !frame.hidden).box.w;
    });
    const handle = await page.$("#spread-canvas [data-kind=frame].selected .resize-handle");
    const handleRect = await handle.boundingBox();
    await page.mouse.move(handleRect.x + handleRect.width / 2, handleRect.y + handleRect.height / 2);
    await page.mouse.down();
    await page.mouse.move(handleRect.x + handleRect.width / 2 + 24, handleRect.y + handleRect.height / 2 + 8, { steps: 5 });
    await page.mouse.up();
    const afterResize = await page.evaluate(() => {
      const project = window.keepsakeEditor.getProject();
      const spread = project.spreads[window.keepsakeEditor.currentSpread()];
      return spread.frames.find((frame) => !frame.hidden).box.w;
    });
    assert.notEqual(afterResize, beforeResize);

    await page.click('[data-action="style"]');
    await page.click('[data-action="theme"][data-theme="cream"]');
    await page.select('[data-book-field="font"]', "Heebo");
    await page.click('[data-action="review"]');
    await page.click('[data-action="save"]');
    await page.waitForFunction(() => !window.keepsakeEditor.isDirty() && window.keepsakeEditor.getProject().revision === 2);
    const saved = await page.evaluate(() => window.keepsakeEditor.getProject());
    assert.equal(saved.order[1], firstId);
    assert.equal(saved.spreads[firstId].layout, "portrait-row");
    assert.equal(saved.spreads[firstId].reviewed, true);
    assert.equal(saved.book.theme, "cream");
    assert.equal(saved.book.font, "Heebo");
    assert.ok(saved.spreads[firstId].frames.some((item) => item.photo === "P006"));
    assert.ok(saved.spreads[firstId].texts.some((text) => text.text === "Saved in the Keepsake project"));
    assert.equal(saved.spreads[firstId].wash.left, "rose");
    assert.ok(saved.spreads[firstId].graphics.some((graphic) => graphic.kind === "boho-arrow"));

    await page.reload({ waitUntil: "networkidle0" });
    await page.waitForFunction(() => !!window.keepsakeEditor);
    assert.deepEqual(await page.evaluate(() => window.keepsakeEditor.getProject()), saved);

    await page.click(`[data-spread="${firstId}"] [data-action="open-spread"]`);
    await page.setViewport({ width: 760, height: 1000 });
    await page.click('[data-action="layouts"]');
    assert.ok(await page.$('[data-layout="portrait-row"]'));
    await page.click('[data-action="cancel-preview"]');
    await page.click('[data-action="export"]');
    await page.waitForFunction(() => window.keepsakeEditor.exportRevision() === 2, { timeout: 120000 });

    const layout = JSON.parse(await fs.readFile(path.join(root, "book", "layout.json"), "utf8"));
    assert.equal(layout.editorProject.revision, 2);
    assert.equal(layout.scenes[1].id, firstId);
    assert.ok(layout.scenes[1].texts.some((text) => text.text === "Saved in the Keepsake project"));
    assert.equal(layout.scenes[1].wash.left, "rose");
    assert.ok(layout.scenes[1].graphics.some((graphic) => graphic.kind === "boho-arrow"));
    const interiorHtml = await fs.readFile(path.join(root, "book", "interior.html"), "utf8");
    assert.match(interiorHtml, /data-wash="rose"/);
    assert.match(interiorHtml, /data-graphic-kind="boho-arrow"/);
    assert.equal(errors.length, 0, errors.join("\n"));
  } finally {
    if (browser) await browser.close();
    if (editor?.server.listening) await editor.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
