import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import zlib from "node:zlib";
import {
  detectSourceKind,
  extractZipPhotos,
  icloudPartitionHost,
  parseGoogleDriveEmbeddedListHtml,
  parseGoogleDriveFolderId,
  parseGooglePhotosSharedHtml,
  parseIcloudSharedAlbumToken,
  resolvePhotoSource,
  selectIcloudPhotoAssets,
} from "../scripts/sources.mjs";

function makeTestZipBuffer(entries) {
  const localParts = [];
  const cdParts = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, "utf8");
    const raw = Buffer.from(entry.data);
    const compressed = entry.deflate ? zlib.deflateRawSync(raw) : raw;
    const method = entry.deflate ? 8 : 0;
    const dosTime = (14 << 11) | (30 << 5) | 10;
    const dosDate = ((2026 - 1980) << 9) | (4 << 5) | 2;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(0, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, nameBuf, compressed);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0, 8);
    cd.writeUInt16LE(method, 10);
    cd.writeUInt16LE(dosTime, 12);
    cd.writeUInt16LE(dosDate, 14);
    cd.writeUInt32LE(0, 16);
    cd.writeUInt32LE(compressed.length, 20);
    cd.writeUInt32LE(raw.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0, 30);
    cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34);
    cd.writeUInt16LE(0, 36);
    cd.writeUInt32LE(0, 38);
    cd.writeUInt32LE(offset, 42);
    cdParts.push(cd, nameBuf);

    offset += 30 + nameBuf.length + compressed.length;
  }

  const cdBuf = Buffer.concat(cdParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, cdBuf, eocd]);
}

test("detectSourceKind identifies folders, zip files, Google Photos, iCloud, and Google Drive links", () => {
  assert.equal(detectSourceKind("C:\\Photos\\Rome"), "folder");
  assert.equal(detectSourceKind("C:\\Downloads\\trip.zip"), "zip");
  assert.equal(detectSourceKind("https://photos.app.goo.gl/AbCdEf123"), "google-photos");
  assert.equal(detectSourceKind("https://photos.google.com/share/AF1QipN123?key=xyz"), "google-photos");
  assert.equal(detectSourceKind("https://www.icloud.com/sharedalbum/#B0z5qXGF1"), "icloud-shared");
  assert.equal(detectSourceKind("https://drive.google.com/drive/folders/1R7lZvw8P-QY9j9e032E62SaqrUkzcVyQ"), "google-drive");
});

test("extractZipPhotos unpacks stored and deflated photos while skipping macOS resource forks", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "keepsake-zip-"));
  const zipPath = path.join(tmp, "album.zip");
  const zipBuf = makeTestZipBuffer([
    { name: "Rome/IMG_0001.JPG", data: "fake-jpeg-1", deflate: false },
    { name: "Rome/IMG_0002.png", data: "fake-png-2-compressed", deflate: true },
    { name: "__MACOSX/Rome/._IMG_0001.JPG", data: "junk", deflate: false },
    { name: "Rome/notes.txt", data: "not a photo", deflate: false },
  ]);
  await fs.writeFile(zipPath, zipBuf);

  const dest = path.join(tmp, "out");
  const files = await extractZipPhotos(zipPath, dest);
  assert.equal(files.length, 2);
  assert.equal(await fs.readFile(path.join(dest, "IMG_0001.JPG"), "utf8"), "fake-jpeg-1");
  assert.equal(await fs.readFile(path.join(dest, "IMG_0002.png"), "utf8"), "fake-png-2-compressed");
  await fs.rm(tmp, { recursive: true, force: true });
});

test("Google Photos shared album HTML parser and downloader fetch original photos and timestamps", async () => {
  const html = `<script>AF_initDataCallback({key: 'ds:1', hash: '1', data:[null,[["AF1Qip1",["https://lh3.googleusercontent.com/pw/AP1GczTestOne",4032,3024,null,null,1],1712059200000],["AF1Qip2",["https://lh3.googleusercontent.com/pw/AP1GczTestTwo",3024,4032],1712062800000]]], sideChannel: {}});</script>`;
  const parsed = parseGooglePhotosSharedHtml(html);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].baseUrl, "https://lh3.googleusercontent.com/pw/AP1GczTestOne");
  assert.equal(parsed[0].timestampMs, 1712059200000);

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "keepsake-gphotos-"));
  const fakeFetch = async (url) => {
    if (url.startsWith("https://photos.app.goo.gl/")) {
      return { ok: true, status: 200, text: async () => html };
    }
    return {
      ok: true,
      status: 200,
      headers: new Map([["content-type", "image/jpeg"]]),
      arrayBuffer: async () => new Uint8Array([0xff, 0xd8, 0xff, 0xd9]).buffer,
    };
  };
  const resolved = await resolvePhotoSource("https://photos.app.goo.gl/testAlbum", {
    workDir: tmp,
    fetchImpl: fakeFetch,
  });
  assert.equal(resolved.kind, "google-photos");
  const downloaded = await fs.readdir(resolved.srcDir);
  assert.deepEqual(downloaded, ["gphoto-0001.jpg", "gphoto-0002.jpg"]);
  await fs.rm(tmp, { recursive: true, force: true });
});

test("Apple iCloud Shared Album resolver follows 330 partition redirect and picks largest photo derivatives", async () => {
  assert.equal(parseIcloudSharedAlbumToken("https://www.icloud.com/sharedalbum/#B0z5qXGF1"), "B0z5qXGF1");
  assert.match(icloudPartitionHost("A01xyz"), /^p\d{2}-sharedstreams\.icloud\.com$/);

  const webstream = {
    photos: [
      {
        photoGuid: "guid-1",
        dateCreated: "2026-04-01T12:00:00Z",
        derivatives: {
          small: { checksum: "chk-small", width: "720", height: "540" },
          large: { checksum: "chk-large", width: "4032", height: "3024" },
        },
      },
      {
        photoGuid: "guid-video",
        mediaAssetType: "video",
        derivatives: { v: { checksum: "chk-vid", width: "1920", height: "1080" } },
      },
    ],
  };
  const webasseturls = {
    items: {
      "chk-small": { url_location: "cvws.icloud-content.com", url_path: "/small.jpg" },
      "chk-large": { url_location: "cvws.icloud-content.com", url_path: "/large.jpg" },
    },
  };
  const selected = selectIcloudPhotoAssets(webstream, webasseturls);
  assert.equal(selected.length, 1);
  assert.equal(selected[0].url, "https://cvws.icloud-content.com/large.jpg");

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "keepsake-icloud-"));
  let redirected = false;
  const fakeFetch = async (url) => {
    if (url.endsWith("/webstream") && !redirected) {
      redirected = true;
      return {
        ok: false,
        status: 330,
        headers: new Map([["X-Apple-MMe-Host", "p42-sharedstreams.icloud.com"]]),
      };
    }
    if (url.endsWith("/webstream")) {
      return { ok: true, status: 200, json: async () => webstream };
    }
    if (url.endsWith("/webasseturls")) {
      return { ok: true, status: 200, json: async () => webasseturls };
    }
    return {
      ok: true,
      status: 200,
      headers: new Map([["content-type", "image/jpeg"]]),
      arrayBuffer: async () => new Uint8Array([0xff, 0xd8, 0xff, 0xd9]).buffer,
    };
  };
  const resolved = await resolvePhotoSource("https://www.icloud.com/sharedalbum/#B0z5qXGF1", {
    workDir: tmp,
    fetchImpl: fakeFetch,
  });
  assert.equal(resolved.kind, "icloud-shared");
  const files = await fs.readdir(resolved.srcDir);
  assert.deepEqual(files, ["icloud-0001.jpg"]);
  await fs.rm(tmp, { recursive: true, force: true });
});

test("Google Drive shared folder parser and downloader extract photo entries", async () => {
  const id = parseGoogleDriveFolderId("https://drive.google.com/drive/folders/1R7lZvw8P-QY9j9e032E62SaqrUkzcVyQ?usp=sharing");
  assert.equal(id, "1R7lZvw8P-QY9j9e032E62SaqrUkzcVyQ");
  const html = `
    <div class="flip-entry" id="entry-fileA"><div class="flip-entry-title">IMG_1001.jpg</div></div>
    <div class="flip-entry" id="entry-fileB"><div class="flip-entry-title">notes.pdf</div></div>
  `;
  const entries = parseGoogleDriveEmbeddedListHtml(html);
  assert.deepEqual(entries, [{ id: "fileA", name: "IMG_1001.jpg" }]);
});
