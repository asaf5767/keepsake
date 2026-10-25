import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { reviewPhotos } from "../scripts/review.mjs";
const require = createRequire(new URL("../scripts/package.json", import.meta.url));
const sharp = require("sharp");

test("review views preserve whole photographs and validate code selection", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "keepsake-review-"));
  try {
    const input = path.join(root, "wide.jpg");
    await sharp({ create: { width: 1200, height: 400, channels: 3, background: "#608060" } }).jpeg().toFile(input);
    await fs.writeFile(path.join(root, "cull.json"), JSON.stringify({ photos: [
      { code: "P001", path: input, file: "wide.jpg", width: 1200, height: 400, status: "keep" },
      { code: "R001", path: input, file: "wide.jpg", width: 1200, height: 400, status: "reject" },
    ] }));
    const result = await reviewPhotos(root);
    assert.deepEqual(result.photos.map(p => p.code), ["P001"]);
    const image = await sharp(path.join(root, "review", "P001.jpg")).metadata();
    assert.equal(image.width, 1200);
    assert.equal(image.height, 400);
    assert.equal(result.sheets.length, 1);
    assert.match(result.warning, /not proof/);
    await assert.rejects(reviewPhotos(root, { codes: ["P099"] }), /Unknown photo codes/);
    assert.deepEqual((await reviewPhotos(root, { codes: ["R001"] })).photos.map(p => p.code), ["R001"]);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
