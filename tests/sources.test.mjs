import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test, { after } from "node:test";
import zlib from "node:zlib";
import {
  detectSourceKind,
  extractZipPhotos,
  icloudPartitionHost,
  parseGoogleDriveEmbeddedListHtml,
  parseGoogleDriveFolderId,
  parseGooglePhotosSharedHtml,
  parseGooglePhotosSharedPage,
  parseGooglePhotosBatchResponse,
  parseIcloudSharedAlbumToken,
  resolvePhotoSource,
  selectIcloudPhotoAssets,
} from "../scripts/sources.mjs";

const scratch = await fs.mkdtemp(path.join(import.meta.dirname, ".sources-test-"));
after(() => fs.rm(scratch, { recursive: true, force: true }));

const GOOGLE_SHARE = "https://photos.google.com/share/fixture-album?key=fixture-share-key";
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
const textResponse = (text, extra = {}) => ({ ok: true, status: 200, text: async () => text, ...extra });
const imageResponse = () => ({
  ok: true, status: 200, headers: new Map([["content-type", "image/jpeg"]]),
  arrayBuffer: async () => JPEG.buffer,
});

function googleItem(id, { video = false, baseUrl = `https://lh3.googleusercontent.com/pw/${id}`, width = 4032 } = {}) {
  return [id, [baseUrl, width, 3024], 1712059200000, null, 0, 1712062800000,
    null, null, null, video ? { "76647426": [21028, null, 1080, 1920, null, 4] } : {}];
}

function googlePage(items, { token = null, count = items.length, noCount = false, albumId = "fixture-album" } = {}) {
  const metadata = Array(22).fill(null);
  metadata[0] = albumId;
  metadata[19] = "fixture-share-key";
  metadata[21] = noCount ? null : count;
  return [null, items, token, metadata];
}

function googleHtml(page, { wiz = true } = {}) {
  return `<script>${wiz ? 'window.WIZ_global_data = {"FdrFJe":"fixture-session","cfb2h":"fixture-build"};' : ""}
AF_initDataCallback({key: 'ds:0', data:[[[${JSON.stringify(googleItem("cover-not-an-item"))}]]], sideChannel: {}});
AF_initDataCallback({key: 'ds:1', hash: '2', data:${JSON.stringify(page)}, sideChannel: {}});</script>`;
}

function googleBatch(page) {
  const frame = JSON.stringify([["wrb.fr", "snAcKc", JSON.stringify(page), null, null, null, "generic"]]);
  const trailer = JSON.stringify([["di", 0], ["af.httprm", 0]]);
  return `)]}'\n\n${Buffer.byteLength(frame)}\n${frame}\n${Buffer.byteLength(trailer)}\n${trailer}\n`;
}

function googleFetch(initial, continuations = {}, download = imageResponse) {
  const requests = [], imageRequests = [];
  const fetchImpl = async (url, init) => {
    requests.push({ url, init });
    if (url.startsWith("https://photos.app.goo.gl/") || url === GOOGLE_SHARE) {
      return textResponse(googleHtml(initial), { url: GOOGLE_SHARE });
    }
    const u = new URL(url);
    if (u.pathname === "/_/PhotosUi/data/batchexecute") {
      assert.equal(u.origin, "https://photos.google.com");
      assert.equal(u.searchParams.get("rpcids"), "snAcKc");
      assert.equal(u.searchParams.get("source-path"), "/share/fixture-album");
      assert.equal(u.searchParams.get("f.sid"), "fixture-session");
      assert.equal(u.searchParams.get("bl"), "fixture-build");
      assert.equal(u.searchParams.get("rt"), "c");
      assert.equal(init.method, "POST");
      assert.match(init.headers["Content-Type"], /^application\/x-www-form-urlencoded/);
      assert.equal(init.headers.Cookie, undefined);
      const form = new URLSearchParams(init.body);
      assert.deepEqual([...form.keys()], ["f.req"]);
      const envelope = JSON.parse(form.get("f.req"));
      assert.equal(envelope.length, 1);
      assert.equal(envelope[0].length, 1);
      assert.equal(envelope[0][0][0], "snAcKc");
      assert.deepEqual(envelope[0][0].slice(2), [null, "generic"]);
      const args = JSON.parse(envelope[0][0][1]);
      assert.deepEqual(args, ["fixture-album", args[1], null, "fixture-share-key"]);
      assert.ok(Object.hasOwn(continuations, args[1]), "Unexpected continuation token");
      const next = continuations[args[1]];
      if (typeof next === "function") return next(url, init);
      return textResponse(googleBatch(next));
    }
    assert.equal(u.hostname, "lh3.googleusercontent.com");
    imageRequests.push(url);
    return download(url, init);
  };
  return { fetchImpl, requests, imageRequests };
}

async function googleWork() {
  return fs.mkdtemp(path.join(scratch, "google-"));
}

async function assertFailedImport(workDir, fake, pattern) {
  let failure;
  await assert.rejects(resolvePhotoSource(GOOGLE_SHARE, { workDir, fetchImpl: fake.fetchImpl }), (error) => {
    failure = error;
    assert.match(error.message, pattern);
    assert.match(error.message, /Retry.*ZIP/);
    return true;
  });
  const report = JSON.parse(await fs.readFile(path.join(workDir, "source-import.json"), "utf8"));
  assert.equal(report.status, "failed");
  assert.deepEqual(report, failure.importReport);
  assert.ok(report.failures.length > 0);
  assert.equal((await fs.readdir(workDir)).some((name) => name.startsWith(".google-photos-import-")), false);
  return report;
}

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
  assert.equal(detectSourceKind("https://photos.app.goo.gl/fixtureShortAlbum"), "google-photos");
  assert.equal(detectSourceKind(GOOGLE_SHARE), "google-photos");
  assert.equal(detectSourceKind("https://www.icloud.com/sharedalbum/#B0zFixtureAlbum"), "icloud-shared");
  assert.equal(detectSourceKind("https://drive.google.com/drive/folders/fixture-drive-folder-id"), "google-drive");
});

test("extractZipPhotos unpacks stored and deflated photos while skipping macOS resource forks", async () => {
  const tmp = await fs.mkdtemp(path.join(scratch, "keepsake-zip-"));
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

test("Google Photos shared album HTML parser and downloader request download-endpoint photos and preserve timestamps", async () => {
  const html = `<script>AF_initDataCallback({key: 'ds:1', hash: '1', data:[null,[["AF1Qip1",["https://lh3.googleusercontent.com/pw/AP1GczTestOne",4032,3024,null,null,1],1712059200000],["AF1Qip2",["https://lh3.googleusercontent.com/pw/AP1GczTestTwo",3024,4032],1712062800000]],null], sideChannel: {}});</script>`;
  const parsed = parseGooglePhotosSharedHtml(html);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].baseUrl, "https://lh3.googleusercontent.com/pw/AP1GczTestOne");
  assert.equal(parsed[0].timestampMs, 1712059200000);

  const tmp = await fs.mkdtemp(path.join(scratch, "keepsake-gphotos-"));
  const fakeFetch = async (url) => {
    if (url.startsWith("https://photos.app.goo.gl/")) {
      return { ok: true, status: 200, text: async () => html };
    }
    assert.match(url, /=d$/);
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
  assert.equal(resolved.importReport.status, "complete");
  assert.equal(resolved.importReport.expectedItems, null);
  assert.match(resolved.importReport.completenessEvidence, /expected count unavailable/);
  assert.equal(resolved.importReport.downloadQuality.originalQualityVerified, false);
  assert.equal((await fs.stat(path.join(resolved.srcDir, downloaded[0]))).mtimeMs, 1712059200000);
  await fs.rm(tmp, { recursive: true, force: true });
});

test("Apple iCloud Shared Album resolver follows 330 partition redirect and picks largest photo derivatives", async () => {
  assert.equal(parseIcloudSharedAlbumToken("https://www.icloud.com/sharedalbum/#B0zFixtureAlbum"), "B0zFixtureAlbum");
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

  const tmp = await fs.mkdtemp(path.join(scratch, "keepsake-icloud-"));
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
  const resolved = await resolvePhotoSource("https://www.icloud.com/sharedalbum/#B0zFixtureAlbum", {
    workDir: tmp,
    fetchImpl: fakeFetch,
  });
  assert.equal(resolved.kind, "icloud-shared");
  const files = await fs.readdir(resolved.srcDir);
  assert.deepEqual(files, ["icloud-0001.jpg"]);
  await fs.rm(tmp, { recursive: true, force: true });
});

test("Google Drive shared folder parser and downloader extract photo entries", async () => {
  const id = parseGoogleDriveFolderId("https://drive.google.com/drive/folders/fixture-drive-folder-id?usp=sharing");
  assert.equal(id, "fixture-drive-folder-id");
  const html = `
    <div class="flip-entry" id="entry-fileA"><div class="flip-entry-title">IMG_1001.jpg</div></div>
    <div class="flip-entry" id="entry-fileB"><div class="flip-entry-title">notes.pdf</div></div>
  `;
  const entries = parseGoogleDriveEmbeddedListHtml(html);
  assert.deepEqual(entries, [{ id: "fileA", name: "IMG_1001.jpg" }]);
});

test("Google Photos follows all public continuation pages, deduplicates remote IDs, skips videos and reports fallback quality", async () => {
  const a = googleItem("photo-a"), b = googleItem("photo-b"), c = googleItem("photo-c"), d = googleItem("photo-d");
  const fake = googleFetch(
    googlePage([a, googleItem("video", { video: true }), b], { token: "next-1", count: 5 }),
    {
      "next-1": googlePage([googleItem("photo-a", { baseUrl: "https://lh3.googleusercontent.com/pw/changed-a" }), c], { token: "next-2", count: 5 }),
      "next-2": googlePage([b, c, d], { count: 5 }),
    },
    (url) => url.endsWith("/photo-b=d")
      ? { ok: false, status: 403, headers: new Map() } : imageResponse(),
  );
  const workDir = await googleWork();
  const resolved = await resolvePhotoSource("https://photos.app.goo.gl/fixture", { workDir, fetchImpl: fake.fetchImpl });
  const r = resolved.importReport;
  assert.equal(r.status, "complete");
  assert.equal(r.expectedItems, 5);
  assert.equal(r.discoveredItems, 5);
  assert.equal(r.duplicateItems, 3);
  assert.equal(r.skippedVideos, 1);
  assert.equal(r.photoItems, 4);
  assert.equal(r.downloadedItems, 4);
  assert.equal(r.paginationComplete, true);
  assert.equal(r.completenessEvidence, "expected-count-and-terminal-page");
  assert.deepEqual(r.pages.map((p) => [p.items, p.uniqueItems, p.duplicateItems]), [[3, 3, 0], [2, 1, 1], [3, 1, 2]]);
  assert.deepEqual(r.downloadQuality, { downloadEndpoint: 3, fallback4096: 1, originalQualityVerified: false });
  assert.deepEqual(r.downloads.map((item) => item.remoteId), ["photo-a", "photo-b", "photo-c", "photo-d"]);
  assert.match(r.downloads[1].fallbackReason, /HTTP 403/);
  assert.equal(fake.imageRequests.length, 5);
  assert.ok(fake.imageRequests.every((url) => !/video|cover-not-an-item|changed-a/.test(url)));
  assert.equal((await fs.readdir(resolved.srcDir)).length, 4);
  const persisted = await fs.readFile(resolved.importReportPath, "utf8");
  assert.deepEqual(JSON.parse(persisted), r);
  assert.doesNotMatch(persisted, /next-1|next-2|fixture-session|fixture-build|fixture-share-key|baseUrl/);
});

test("Google Photos fixture imports more than 500 photos without a fixed initial-page limit", async () => {
  const all = Array.from({ length: 505 }, (_, i) => googleItem(`photo-${i}`));
  const fake = googleFetch(googlePage(all.slice(0, 250), { token: "page-2", count: 505 }), {
    "page-2": googlePage(all.slice(250, 500), { token: "page-3", count: 505 }),
    "page-3": googlePage(all.slice(500), { count: 505 }),
  });
  const resolved = await resolvePhotoSource(GOOGLE_SHARE, { workDir: await googleWork(), fetchImpl: fake.fetchImpl });
  assert.equal(resolved.importReport.downloadedItems, 505);
  assert.equal(resolved.importReport.pages.length, 3);
  assert.equal((await fs.readdir(resolved.srcDir)).length, 505);
});

test("Google Photos deduplication uses remote IDs rather than shared or changing URLs", async () => {
  const sameUrl = "https://lh3.googleusercontent.com/pw/same-url";
  const page = googlePage([
    googleItem("a", { baseUrl: sameUrl }), googleItem("b", { baseUrl: sameUrl }),
    googleItem("a", { baseUrl: "https://lh3.googleusercontent.com/pw/new-url" }),
  ], { count: 2 });
  assert.equal(parseGooglePhotosSharedHtml(googleHtml(page)).length, 2);
  const fake = googleFetch(page);
  const resolved = await resolvePhotoSource(GOOGLE_SHARE, { workDir: await googleWork(), fetchImpl: fake.fetchImpl });
  assert.equal(resolved.importReport.downloadedItems, 2);
  assert.equal(resolved.importReport.duplicateItems, 1);
  assert.equal(fake.imageRequests.length, 2);
});

test("Google Photos rejects too few or too many unique IDs before downloading", async (t) => {
  for (const count of [1, 3]) await t.test(`expected ${count}, got 2`, async () => {
    const fake = googleFetch(googlePage([googleItem("a"), googleItem("b")], { count }));
    const workDir = await googleWork();
    const report = await assertFailedImport(workDir, fake, /count mismatch.*expected.*discovered 2/);
    assert.equal(report.expectedItems, count);
    assert.equal(report.discoveredItems, 2);
    assert.equal(report.paginationComplete, false);
    assert.equal(fake.imageRequests.length, 0);
    await assert.rejects(fs.access(path.join(workDir, "photos")), { code: "ENOENT" });
  });
});

test("Google Photos does not mistake overlapping page length for expected unique count", async () => {
  const a = googleItem("a");
  const fake = googleFetch(googlePage([a], { token: "next", count: 2 }), { next: googlePage([a], { count: 2 }) });
  const report = await assertFailedImport(await googleWork(), fake, /count mismatch.*discovered 1/);
  assert.equal(report.duplicateItems, 1);
  assert.equal(fake.imageRequests.length, 0);
});

test("Google Photos rejects changing expected counts during continuation", async () => {
  const fake = googleFetch(googlePage([googleItem("a")], { token: "next", count: 2 }), {
    next: googlePage([googleItem("b")], { count: 3 }),
  });
  await assertFailedImport(await googleWork(), fake, /count changed/);
  assert.equal(fake.imageRequests.length, 0);
});

test("Google Photos derives public album identity and key from a short-link redirect when metadata is absent", async () => {
  const initial = [null, [googleItem("a")], "next", null];
  const fake = googleFetch(initial, { next: googlePage([googleItem("b")], { count: 2 }) });
  const resolved = await resolvePhotoSource("https://photos.app.goo.gl/fixture", {
    workDir: await googleWork(), fetchImpl: fake.fetchImpl,
  });
  assert.equal(resolved.importReport.expectedItems, 2);
  assert.equal(resolved.importReport.downloadedItems, 2);
});

test("Google Photos rejects a duplicate ID whose media type changed instead of treating a poster as a photo", async () => {
  const fake = googleFetch(googlePage([googleItem("a")], { token: "next", count: 1 }), {
    next: googlePage([googleItem("a", { video: true })], { count: 1 }),
  });
  await assertFailedImport(await googleWork(), fake, /changed media type/);
  assert.equal(fake.imageRequests.length, 0);
});

test("Google Photos rejects repeated and cyclic continuation tokens", async (t) => {
  for (const cycle of [false, true]) await t.test(cycle ? "cycle" : "repeat", async () => {
    const fake = googleFetch(googlePage([googleItem("a")], { token: "token-a", noCount: true }), {
      "token-a": googlePage([googleItem("b")], { token: cycle ? "token-b" : "token-a", noCount: true }),
      "token-b": googlePage([googleItem("c")], { token: "token-a", noCount: true }),
    });
    const report = await assertFailedImport(await googleWork(), fake, /Repeated.*continuation token/);
    assert.equal(report.pages.length, cycle ? 3 : 2);
    assert.equal(fake.imageRequests.length, 0);
    assert.doesNotMatch(JSON.stringify(report), /token-a|token-b/);
  });
});

test("Google Photos rejects empty or nonprogressing nonterminal continuation pages", async (t) => {
  for (const rows of [[], [googleItem("a")]]) await t.test(`${rows.length} rows`, async () => {
    const fake = googleFetch(googlePage([googleItem("a")], { token: "next", noCount: true }), {
      next: googlePage(rows, { token: "still-more", noCount: true }),
    });
    await assertFailedImport(await googleWork(), fake, /Empty album page|made no progress/);
  });
});

test("Google Photos continuation HTTP and network failures never return a partial album", async (t) => {
  for (const network of [false, true]) await t.test(network ? "network" : "HTTP", async () => {
    const fake = googleFetch(googlePage([googleItem("a")], { token: "next", count: 2 }), {
      next: () => {
        if (network) throw new Error("private-session-token must not appear in report");
        return { ok: false, status: 503 };
      },
    });
    const report = await assertFailedImport(await googleWork(), fake, /Continuation request.*(?:503|network error)/);
    assert.equal(report.pages.length, 1);
    assert.equal(report.paginationComplete, false);
    assert.equal(fake.imageRequests.length, 0);
    assert.doesNotMatch(JSON.stringify(report), /private-session-token/);
  });
});

test("Google Photos rejects a continuation response whose body fails during reading", async () => {
  const fake = googleFetch(googlePage([googleItem("a")], { token: "next", count: 2 }), {
    next: () => textResponse("", { text: async () => { throw new Error("private-session-token"); } }),
  });
  const report = await assertFailedImport(await googleWork(), fake, /response could not be read completely/);
  assert.equal(report.paginationComplete, false);
  assert.doesNotMatch(JSON.stringify(report), /private-session-token/);
});

test("Google Photos rejects malformed, missing, wrong-RPC and rejected continuation payloads", async (t) => {
  const bodies = [
    ")]}'\n10\n[[",
    JSON.stringify([["wrb.fr", "wrong-rpc", JSON.stringify(googlePage([]))]]),
    JSON.stringify([["wrb.fr", "snAcKc", null, null, null, [5]]]),
    JSON.stringify([["wrb.fr", "snAcKc", "private-token-invalid-json"]]),
    googleBatch([null, [googleItem("b")]]),
    googleBatch([null, [googleItem("b")], 99]),
  ];
  for (const [i, body] of bodies.entries()) await t.test(`payload ${i}`, async () => {
    const fake = googleFetch(googlePage([googleItem("a")], { token: "next", count: 2 }), {
      next: () => textResponse(body),
    });
    const report = await assertFailedImport(await googleWork(), fake, /import incomplete/);
    assert.equal(fake.imageRequests.length, 0);
    assert.doesNotMatch(JSON.stringify(report), /private-token-invalid-json/);
  });
});

test("Google Photos requires structured completion evidence and refuses the old URL regex fallback", () => {
  assert.throws(() => parseGooglePhotosSharedPage(googleHtml([null, [googleItem("a")]])), /completion marker/);
  assert.throws(() => parseGooglePhotosSharedPage('"https://lh3.googleusercontent.com/pw/only-a-url",4032,3024'), /structured/);
  assert.throws(() => parseGooglePhotosSharedPage(googleHtml(googlePage([["bad-record"]]))), /Unrecognized media record/);
  assert.throws(() => parseGooglePhotosSharedPage(googleHtml(googlePage([googleItem("a")], { count: -1 }))), /expected album item count/);
  const withTiny = parseGooglePhotosSharedPage(googleHtml(googlePage([googleItem("tiny", { width: 100 })])));
  assert.equal(withTiny.items.length, 1, "tiny items belong in the album count; culling decides print suitability");
});

test("Google Photos refuses pagination without public request context or after a nonpublic redirect", async (t) => {
  for (const finalUrl of [GOOGLE_SHARE, "https://accounts.google.com/login"]) await t.test(finalUrl, async () => {
    const fake = { fetchImpl: async () => textResponse(
      googleHtml(googlePage([googleItem("a")], { token: "next", count: 2 }), { wiz: false }), { url: finalUrl },
    ) };
    await assertFailedImport(await googleWork(), fake, /Missing public-page request context|did not resolve to a public/);
  });
});

test("Google Photos parses framed responses with escaped bracket-like strings and Unicode safely", () => {
  const page = googlePage([googleItem('escaped-"]-\\-שלום')], { count: 1 });
  assert.equal(parseGooglePhotosBatchResponse(googleBatch(page)).items[0].remoteId, 'escaped-"]-\\-שלום');
  const duplicateEnvelope = JSON.stringify([
    ["wrb.fr", "snAcKc", JSON.stringify(page)], ["wrb.fr", "snAcKc", JSON.stringify(page)],
  ]);
  assert.throws(() => parseGooglePhotosBatchResponse(duplicateEnvelope), /ambiguous/);
});

test("Google Photos fails cleanly on initial HTTP, network and response-read errors", async (t) => {
  for (const mode of ["http", "network", "body"]) await t.test(mode, async () => {
    const fake = { fetchImpl: async () => {
      if (mode === "network") throw new Error("private share key");
      if (mode === "http") return { ok: false, status: 403 };
      return textResponse("", { text: async () => { throw new Error("private share key"); } });
    } };
    const report = await assertFailedImport(await googleWork(), fake, /Public album/);
    assert.equal(report.downloadedItems, 0);
    assert.doesNotMatch(JSON.stringify(report), /private share key/);
  });
});

test("Google Photos can use a validated fallback after original-endpoint network failure", async () => {
  const fake = googleFetch(googlePage([googleItem("a")]), {}, (url) => {
    if (url.endsWith("=d")) throw new Error("fetch failed");
    return imageResponse();
  });
  const resolved = await resolvePhotoSource(GOOGLE_SHARE, { workDir: await googleWork(), fetchImpl: fake.fetchImpl });
  assert.equal(resolved.importReport.downloadQuality.fallback4096, 1);
  assert.match(resolved.importReport.downloads[0].fallbackReason, /network/);
});

test("Google Photos rejects download HTTP/network/body/invalid-content failures without publishing partial files", async (t) => {
  for (const mode of ["http", "network", "body", "html", "empty", "fake-jpeg"]) await t.test(mode, async () => {
    const fake = googleFetch(googlePage([googleItem("a"), googleItem("b")]), {}, (url) => {
      if (url.includes("/a=")) return imageResponse();
      if (mode === "http") return { ok: false, status: 503, headers: new Map() };
      if (mode === "network") throw new Error("private-url-token");
      if (mode === "body") return { ...imageResponse(), arrayBuffer: async () => { throw new Error("private-url-token"); } };
      return {
        ...imageResponse(),
        headers: new Map([["content-type", mode === "html" ? "text/html" : "image/jpeg"]]),
        arrayBuffer: async () => mode === "empty" ? new ArrayBuffer(0) : Buffer.from("<html>Not a photo</html>"),
      };
    });
    const workDir = await googleWork();
    const report = await assertFailedImport(workDir, fake, /1 photo download\(s\) failed; 1\/2 downloaded/);
    assert.equal(report.downloadedItems, 1);
    assert.equal(report.paginationComplete, true);
    assert.ok(report.failures.some((failure) => failure.item === 2 && /Photo #2/.test(failure.message)));
    assert.doesNotMatch(JSON.stringify(report), /private-url-token/);
    await assert.rejects(fs.access(path.join(workDir, "photos")), { code: "ENOENT" });
  });
});

test("Google Photos all-video albums explicitly fail instead of importing poster frames", async () => {
  const fake = googleFetch(googlePage([googleItem("v", { video: true })]));
  const report = await assertFailedImport(await googleWork(), fake, /No supported still photos.*1 video/);
  assert.equal(report.skippedVideos, 1);
  assert.equal(fake.imageRequests.length, 0);
});

test("Google Photos reruns replace importer-owned output without retaining stale indexed images", async () => {
  const workDir = await googleWork();
  const first = googleFetch(googlePage([googleItem("a"), googleItem("b")]));
  await resolvePhotoSource(GOOGLE_SHARE, { workDir, fetchImpl: first.fetchImpl });
  const failing = googleFetch(googlePage([googleItem("c")]), {}, () => { throw new Error("offline"); });
  await assertFailedImport(workDir, failing, /download\(s\) failed/);
  assert.equal((await fs.readdir(path.join(workDir, "photos"))).length, 2, "failed rerun leaves the previous completed directory intact");
  const second = googleFetch(googlePage([googleItem("c")]));
  const resolved = await resolvePhotoSource(GOOGLE_SHARE, { workDir, fetchImpl: second.fetchImpl });
  assert.deepEqual(await fs.readdir(resolved.srcDir), ["gphoto-0001.jpg"]);
  assert.deepEqual(resolved.importReport.downloads.map((item) => item.remoteId), ["c"]);
  assert.equal((await fs.readdir(workDir)).some((name) => name.startsWith(".google-photos-import-")), false);
});

test("Google Photos refuses to mix an import into an unrelated existing photos directory", async () => {
  const workDir = await googleWork();
  await fs.mkdir(path.join(workDir, "photos"));
  await fs.writeFile(path.join(workDir, "photos", "user-photo.jpg"), "leave me alone");
  const fake = googleFetch(googlePage([googleItem("a")]));
  await assertFailedImport(workDir, fake, /not owned by this importer.*fresh/);
  assert.equal(await fs.readFile(path.join(workDir, "photos", "user-photo.jpg"), "utf8"), "leave me alone");
  assert.deepEqual(await fs.readdir(path.join(workDir, "photos")), ["user-photo.jpg"]);
});

test("Google Photos keeps embedded album identity, initial share key and each continuation token distinct", async () => {
  const initial = googlePage([googleItem("row-a")], { token: "bootstrap-cursor", count: 3, albumId: "embedded-album" });
  initial[3][19] = "embedded-share-key";
  const second = googlePage([googleItem("row-b")], { token: "continuation-cursor", count: 3, albumId: "embedded-album" });
  second[3][19] = "do-not-substitute-this-key";
  const cursors = [];
  const fetchImpl = async (url, init) => {
    if (url === GOOGLE_SHARE) return textResponse(googleHtml(initial), { url: GOOGLE_SHARE });
    if (url.startsWith("https://photos.google.com/_/PhotosUi/data/batchexecute")) {
      const u = new URL(url);
      assert.equal(u.searchParams.get("source-path"), "/share/fixture-album");
      const envelope = JSON.parse(new URLSearchParams(init.body).get("f.req"));
      const args = JSON.parse(envelope[0][0][1]);
      assert.deepEqual(args, ["embedded-album", cursors.length ? "continuation-cursor" : "bootstrap-cursor", null, "embedded-share-key"]);
      cursors.push(args[1]);
      return textResponse(googleBatch(cursors.length === 1 ? second : [null, [googleItem("row-c")], null]));
    }
    return imageResponse();
  };
  const resolved = await resolvePhotoSource(GOOGLE_SHARE, { workDir: await googleWork(), fetchImpl });
  assert.deepEqual(cursors, ["bootstrap-cursor", "continuation-cursor"]);
  assert.equal(resolved.importReport.downloadedItems, 3);
  assert.doesNotMatch(JSON.stringify(resolved.importReport), /bootstrap-cursor|continuation-cursor|embedded-share-key/);
});

test("Google Photos rejects continuation metadata for a different album", async () => {
  const fake = googleFetch(googlePage([googleItem("a")], { token: "next", count: 2 }), {
    next: googlePage([googleItem("b")], { count: 2, albumId: "another-album" }),
  });
  await assertFailedImport(await googleWork(), fake, /different album/);
  assert.equal(fake.imageRequests.length, 0);
});

test("Google Photos local write or timestamp failures cannot leave an original beside a successful fallback", async (t) => {
  for (const mode of ["write", "timestamp"]) await t.test(mode, async () => {
    const fake = googleFetch(googlePage([googleItem("a")]), {}, (url) => {
      if (url.endsWith("=d")) return imageResponse();
      return {
        ...imageResponse(), headers: new Map([["content-type", "image/png"]]),
        arrayBuffer: async () => Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      };
    });
    const workDir = await googleWork();
    const originalWrite = fs.writeFile, originalUtimes = fs.utimes;
    try {
      if (mode === "write") fs.writeFile = async (file, data, ...options) => {
        if (path.basename(String(file)) === "gphoto-0001.jpg") {
          await originalWrite(file, "partial local write");
          throw new Error("injected local write failure");
        }
        return originalWrite(file, data, ...options);
      };
      else fs.utimes = async () => { throw new Error("injected timestamp failure"); };
      const report = await assertFailedImport(workDir, fake, /1 photo download\(s\) failed; 0\/1 downloaded/);
      assert.match(report.failures[0].message, /could not be saved locally/);
      assert.equal(fake.imageRequests.length, 1, "local filesystem failures must not retry as a different image format");
      await assert.rejects(fs.access(path.join(workDir, "photos")), { code: "ENOENT" });
    } finally {
      fs.writeFile = originalWrite;
      fs.utimes = originalUtimes;
    }
  });
});

test("Google Photos publication faults restore previous photos and ownership, and clean partial staging", async (t) => {
  for (const previous of [false, true]) {
    for (const phase of ["prepare-sidecar", "backup-photos", "install-photos", "install-sidecar", "complete-report"]) {
      if (!previous && phase === "backup-photos") continue;
      await t.test(`${previous ? "rerun" : "first import"}: ${phase}`, async () => {
        const workDir = await googleWork();
        const dest = path.join(workDir, "photos");
        const marker = path.join(workDir, ".google-photos-ownership.json");
        if (previous) {
          const old = googleFetch(googlePage([googleItem("old-a"), googleItem("old-b")]));
          await resolvePhotoSource(GOOGLE_SHARE, { workDir, fetchImpl: old.fetchImpl });
        }
        const oldMarker = previous ? await fs.readFile(marker, "utf8") : null;
        const originalWrite = fs.writeFile, originalRename = fs.rename;
        const fault = () => Object.assign(new Error(`injected ${phase} failure`), { code: "EIO" });
        let injected = false;
        try {
          fs.writeFile = async (file, data, ...options) => {
            const name = path.basename(String(file));
            if ((phase === "prepare-sidecar" && name.startsWith(".google-photos-import-") && name.endsWith("-ownership.json")) ||
                (phase === "complete-report" && name === "source-import.json" && JSON.parse(data).status === "complete")) {
              injected = true;
              throw fault();
            }
            return originalWrite(file, data, ...options);
          };
          fs.rename = async (from, to) => {
            const source = String(from), target = String(to);
            const fromName = path.basename(source);
            if ((phase === "backup-photos" && source === dest && target.endsWith("-previous")) ||
                (phase === "install-photos" && target === dest && fromName.startsWith(".google-photos-import-") && !fromName.endsWith("-previous")) ||
                (phase === "install-sidecar" && target === marker && fromName.endsWith("-ownership.json") && !fromName.endsWith("-previous-ownership.json"))) {
              injected = true;
              throw fault();
            }
            return originalRename(from, to);
          };
          const next = googleFetch(googlePage([googleItem("next")]));
          await assertFailedImport(workDir, next, /injected.*failure/);
          assert.equal(injected, true);
          if (previous) {
            assert.deepEqual(await fs.readdir(dest), ["gphoto-0001.jpg", "gphoto-0002.jpg"]);
            assert.equal(await fs.readFile(marker, "utf8"), oldMarker);
            assert.deepEqual(await fs.readFile(path.join(dest, "gphoto-0001.jpg")), Buffer.from(JPEG));
          } else {
            await assert.rejects(fs.access(dest), { code: "ENOENT" });
            await assert.rejects(fs.access(marker), { code: "ENOENT" });
          }
          await assert.rejects(fs.access(path.join(workDir, ".google-photos-import.lock")), { code: "ENOENT" });
        } finally {
          fs.writeFile = originalWrite;
          fs.rename = originalRename;
        }
      });
    }
  }
});

test("Google Photos backup cleanup failure preserves a complete new import and records an explicit warning", async () => {
  const workDir = await googleWork();
  const old = googleFetch(googlePage([googleItem("old-a"), googleItem("old-b")]));
  await resolvePhotoSource(GOOGLE_SHARE, { workDir, fetchImpl: old.fetchImpl });
  const originalRm = fs.rm;
  let backup;
  try {
    fs.rm = async (location, ...args) => {
      if (String(location).startsWith(workDir) && String(location).endsWith("-previous")) {
        backup = String(location);
        throw new Error("injected backup cleanup failure");
      }
      return originalRm(location, ...args);
    };
    const next = googleFetch(googlePage([googleItem("next")]));
    const resolved = await resolvePhotoSource(GOOGLE_SHARE, { workDir, fetchImpl: next.fetchImpl });
    assert.equal(resolved.importReport.status, "complete");
    assert.equal(resolved.importReport.warnings.length, 1);
    assert.match(resolved.importReport.warnings[0], /previous import backup could not be removed/);
    assert.deepEqual(await fs.readdir(resolved.srcDir), ["gphoto-0001.jpg"]);
    assert.equal((await fs.readdir(backup)).length, 2);
    const persisted = JSON.parse(await fs.readFile(resolved.importReportPath, "utf8"));
    assert.deepEqual(persisted, resolved.importReport);
    await assert.rejects(fs.access(path.join(workDir, ".google-photos-import.lock")), { code: "ENOENT" });
  } finally {
    fs.rm = originalRm;
  }
});

test("Google Photos refuses same-name files whose contents no longer match the ownership sidecar", async () => {
  const workDir = await googleWork();
  const first = googleFetch(googlePage([googleItem("a")]));
  const resolved = await resolvePhotoSource(GOOGLE_SHARE, { workDir, fetchImpl: first.fetchImpl });
  const file = path.join(resolved.srcDir, "gphoto-0001.jpg");
  const marker = path.join(workDir, ".google-photos-ownership.json");
  const originalMarker = await fs.readFile(marker, "utf8");
  assert.match(JSON.parse(originalMarker).sha256["gphoto-0001.jpg"], /^[a-f0-9]{64}$/);
  await fs.writeFile(file, "a user photo or another import with the same name");
  const next = googleFetch(googlePage([googleItem("b")]));
  await assertFailedImport(workDir, next, /not owned by this importer.*fresh/);
  assert.equal(await fs.readFile(file, "utf8"), "a user photo or another import with the same name");
  assert.equal(await fs.readFile(marker, "utf8"), originalMarker);
});

test("Google Photos refuses unrelated ownership sidecar directories without replacing user content", async () => {
  const workDir = await googleWork();
  const marker = path.join(workDir, ".google-photos-ownership.json");
  await fs.mkdir(marker);
  await fs.writeFile(path.join(marker, "user-file"), "preserve this");
  const fake = googleFetch(googlePage([googleItem("a")]));
  await assertFailedImport(workDir, fake, /ownership metadata not owned/);
  assert.equal(await fs.readFile(path.join(marker, "user-file"), "utf8"), "preserve this");
  await assert.rejects(fs.access(path.join(workDir, "photos")), { code: "ENOENT" });
});

test("Google Photos overlapping imports cannot overwrite an active attempt's report or publish into its work directory", async () => {
  const workDir = await googleWork();
  const initial = googleFetch(googlePage([googleItem("a")]));
  let release, markEntered;
  const gate = new Promise((resolve) => { release = resolve; });
  const entered = new Promise((resolve) => { markEntered = resolve; });
  const first = resolvePhotoSource(GOOGLE_SHARE, { workDir, fetchImpl: async (url, init) => {
    if (url === GOOGLE_SHARE) {
      markEntered();
      await gate;
    }
    return initial.fetchImpl(url, init);
  } });
  try {
    await entered;
    const before = await fs.readFile(path.join(workDir, "source-import.json"), "utf8");
    const other = googleFetch(googlePage([googleItem("b")]));
    await assert.rejects(resolvePhotoSource(GOOGLE_SHARE, { workDir, fetchImpl: other.fetchImpl }), /Another Google Photos import.*no import is running/);
    assert.equal(other.requests.length, 0);
    assert.equal(await fs.readFile(path.join(workDir, "source-import.json"), "utf8"), before);
  } finally {
    release();
    await first;
  }
  assert.equal(JSON.parse(await fs.readFile(path.join(workDir, "source-import.json"), "utf8")).status, "complete");
  await assert.rejects(fs.access(path.join(workDir, ".google-photos-import.lock")), { code: "ENOENT" });
});

test("Google Photos preserves recoverable old backups if filesystem faults also prevent publication rollback", async () => {
  const workDir = await googleWork();
  const first = googleFetch(googlePage([googleItem("old-a"), googleItem("old-b")]));
  await resolvePhotoSource(GOOGLE_SHARE, { workDir, fetchImpl: first.fetchImpl });
  const marker = path.join(workDir, ".google-photos-ownership.json");
  const oldMarker = await fs.readFile(marker, "utf8");
  const originalRename = fs.rename;
  try {
    fs.rename = async (from, to) => {
      const source = String(from), target = String(to), name = path.basename(source);
      if ((target === marker && name.endsWith("-ownership.json") && !name.endsWith("-previous-ownership.json")) ||
          (target === path.join(workDir, "photos") && name.endsWith("-previous"))) {
        throw new Error("injected double publication/rollback fault");
      }
      return originalRename(from, to);
    };
    const next = googleFetch(googlePage([googleItem("new")]));
    await assert.rejects(resolvePhotoSource(GOOGLE_SHARE, { workDir, fetchImpl: next.fetchImpl }), /rollback could not finish.*backups were preserved/);
    const entries = await fs.readdir(workDir, { withFileTypes: true });
    const photoBackup = entries.find((entry) => entry.isDirectory() && entry.name.endsWith("-previous"));
    const markerBackup = entries.find((entry) => entry.isFile() && entry.name.endsWith("-previous-ownership.json"));
    assert.ok(photoBackup);
    assert.ok(markerBackup);
    assert.deepEqual(await fs.readdir(path.join(workDir, photoBackup.name)), ["gphoto-0001.jpg", "gphoto-0002.jpg"]);
    assert.deepEqual(await fs.readFile(path.join(workDir, photoBackup.name, "gphoto-0001.jpg")), Buffer.from(JPEG));
    assert.equal(await fs.readFile(path.join(workDir, markerBackup.name), "utf8"), oldMarker);
    assert.equal(entries.filter((entry) => entry.name.startsWith(".google-photos-import-")).length, 2, "only explicit recovery backups remain, not the new partial staging directory");
    assert.equal(JSON.parse(await fs.readFile(path.join(workDir, "source-import.json"), "utf8")).status, "failed");
    await assert.rejects(fs.access(path.join(workDir, ".google-photos-import.lock")), { code: "ENOENT" });
  } finally {
    fs.rename = originalRename;
  }
});

test("Google Photos cancels discarded response bodies before fallback to avoid exhausting download connections", async () => {
  let cancelled = 0;
  const fake = googleFetch(googlePage([googleItem("a")]), {}, (url) => {
    if (url.endsWith("=d")) return {
      ok: false, status: 403, headers: new Map([["content-type", "text/html"]]),
      body: { cancel: async () => { cancelled++; } },
    };
    assert.equal(cancelled, 1);
    return imageResponse();
  });
  const resolved = await resolvePhotoSource(GOOGLE_SHARE, { workDir: await googleWork(), fetchImpl: fake.fetchImpl });
  assert.equal(resolved.importReport.downloadQuality.fallback4096, 1);
  assert.equal(cancelled, 1);
});
