import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import {
  ProjectConflictError,
  albumFingerprint,
  createEditorProject,
  defaultProjectPath,
  loadEditorProject,
  saveEditorProject,
  sceneDefinitions,
} from "./editor-project.mjs";

const run = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(here);
const editorRoot = path.join(root, "editor");
const buildScript = path.join(here, "build.mjs");
const MAX_BODY = 5 * 1024 * 1024;

const readJson = async (file) => JSON.parse(await fs.readFile(file, "utf8"));
const exists = async (file) => fs.access(file).then(() => true, () => false);
const photoCode = (value) => typeof value === "string" ? value : value?.id;

async function buildAlbum(albumPath, projectPath, outputPath) {
  const args = [buildScript, albumPath, "--out", outputPath];
  if (projectPath) args.push("--project", projectPath);
  return run(process.execPath, args, { timeout: 300000, maxBuffer: 4 * 1024 * 1024 });
}

async function ensureEditableLayout(albumPath, outputPath) {
  const layoutPath = path.join(outputPath, "layout.json");
  try {
    const layout = await readJson(layoutPath);
    const album = await readJson(albumPath);
    if (layout.sourceFingerprint === albumFingerprint(album) &&
        layout.scenes?.length && layout.scenes.every((scene) => scene.id && scene.frames?.length)) return layout;
  } catch {}
  await buildAlbum(albumPath, null, outputPath);
  const layout = await readJson(layoutPath);
  if (!layout.scenes?.every((scene) => scene.id && scene.frames?.length)) {
    throw new Error("The album build did not produce editable scene evidence.");
  }
  return layout;
}

function sanitizePhoto(photo, settings, usedOn) {
  return {
    id: photo.code,
    day: photo.date?.slice(0, 10),
    width: photo.width,
    height: photo.height,
    orientation: photo.orientation,
    quality: photo.quality,
    status: photo.status,
    what: photo.vision?.what,
    subject: settings?.subject,
    protect: settings?.protect,
    sourceFit: settings?.fit,
    sourceFocus: settings?.focus,
    usedOn,
  };
}

async function bodyJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY) throw Object.assign(new Error("Request is too large."), { statusCode: 413 });
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const json = (response, status, value) => {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(value));
};

export async function prepareEditor({
  albumPath,
  projectPath = defaultProjectPath(albumPath),
  outputPath = path.join(path.dirname(path.resolve(albumPath)), "book"),
} = {}) {
  if (!albumPath) throw new Error("An album.json path is required.");
  albumPath = path.resolve(albumPath);
  projectPath = path.resolve(projectPath);
  outputPath = path.resolve(outputPath);
  const album = await readJson(albumPath);
  if ((album.chapterStyle || "compact") !== "compact") throw new Error("The local editor needs chapterStyle: compact.");
  sceneDefinitions(album);
  const cullPath = path.resolve(path.dirname(albumPath), album.cull || "cull.json");
  const cull = await readJson(cullPath);
  const photoCodes = new Set(cull.photos.map((photo) => photo.code));

  let project;
  if (await exists(projectPath)) {
    project = await loadEditorProject(projectPath, { album, photoCodes });
  } else {
    const layout = await ensureEditableLayout(albumPath, outputPath);
    project = createEditorProject({ album, layout, albumPath });
    project = await saveEditorProject(projectPath, project, {
      expectedRevision: 0,
      album,
      photoCodes,
    });
  }
  const usedOn = new Map();
  for (const id of project.order) {
    for (const frame of project.spreads[id].frames) {
      if (!frame.hidden) usedOn.set(frame.photo, [...(usedOn.get(frame.photo) || []), id]);
    }
  }
  const referenced = new Set([
    ...project.order.flatMap((id) => project.spreads[id].frames.map((frame) => frame.photo)),
    ...(album.cover?.photos || [album.cover?.photo]).map(photoCode).filter(Boolean),
    ...(album.titlePage?.photos || [album.titlePage?.photo]).map(photoCode).filter(Boolean),
    photoCode(album.closing?.photo),
  ].filter(Boolean));
  const available = cull.photos.filter((photo) => photo.status === "keep" || referenced.has(photo.code));
  const photos = available.map((photo) =>
    sanitizePhoto(photo, album.photoSettings?.[photo.code], usedOn.get(photo.code) || []));
  const photoFiles = new Map(available.map((photo) => [photo.code, photo.decodePath || photo.path]));
  const bookends = {
    cover: {
      title: project.book.title,
      subtitle: project.book.subtitle,
      photos: (album.cover?.photos || [album.cover?.photo]).map(photoCode).filter(Boolean),
    },
    opening: {
      title: project.book.title,
      subtitle: project.book.subtitle,
      photos: (album.titlePage?.photos || [album.titlePage?.photo]).map(photoCode).filter(Boolean),
    },
    closing: {
      text: album.closing?.text || "",
      photos: [photoCode(album.closing?.photo)].filter(Boolean),
    },
  };
  let lastExport = null;
  try {
    const exportedLayout = await readJson(path.join(outputPath, "layout.json"));
    if (exportedLayout.editorProject?.revision) {
      lastExport = {
        revision: exportedLayout.editorProject.revision,
        completedAt: null,
        stdout: "",
      };
    }
  } catch {}
  return {
    albumPath,
    projectPath,
    outputPath,
    album,
    cull,
    photoCodes,
    photos,
    photoFiles,
    bookends,
    project,
    exporting: false,
    lastExport,
    hasOutput: await exists(path.join(outputPath, "album.pdf")),
  };
}

export async function startEditorServer({
  albumPath,
  projectPath,
  outputPath,
  port = 4179,
  token = randomBytes(24).toString("base64url"),
} = {}) {
  const context = await prepareEditor({ albumPath, projectPath, outputPath });
  const thumbnails = new Map();
  const staticFiles = new Map([
    ["/", [path.join(editorRoot, "index.html"), "text/html; charset=utf-8"]],
    ["/preview.html", [path.join(editorRoot, "index.html"), "text/html; charset=utf-8"]],
    ["/app.js", [path.join(editorRoot, "app.js"), "text/javascript; charset=utf-8"]],
    ["/app.css", [path.join(editorRoot, "app.css"), "text/css; charset=utf-8"]],
    ["/composition.mjs", [path.join(here, "composition.mjs"), "text/javascript; charset=utf-8"]],
    ["/editor-decor.mjs", [path.join(here, "editor-decor.mjs"), "text/javascript; charset=utf-8"]],
    ["/editor-placement.mjs", [path.join(here, "editor-placement.mjs"), "text/javascript; charset=utf-8"]],
    ["/editor-layouts.mjs", [path.join(here, "editor-layouts.mjs"), "text/javascript; charset=utf-8"]],
    ["/style-presets.mjs", [path.join(here, "style-presets.mjs"), "text/javascript; charset=utf-8"]],
    ["/font/Montserrat.ttf", [path.join(root, "assets", "fonts", "Montserrat.ttf"), "font/ttf"]],
    ["/font/Heebo.ttf", [path.join(root, "assets", "fonts", "Heebo.ttf"), "font/ttf"]],
  ]);

  const authorized = (request, url) =>
    request.headers["x-keepsake-token"] === token || url.searchParams.get("token") === token;
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    try {
      const protectedRoute = url.pathname.startsWith("/api/") ||
        url.pathname.startsWith("/photo/") || url.pathname.startsWith("/book/");
      if (protectedRoute && !authorized(request, url)) {
        json(response, 403, { error: "This Keepsake editor link is not authorized." });
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/project") {
        json(response, 200, {
          project: context.project,
          photos: context.photos,
          bookends: context.bookends,
          projectFile: path.basename(context.projectPath),
          outputFolder: path.basename(context.outputPath),
          export: context.lastExport,
          hasOutput: context.hasOutput,
        });
        return;
      }
      if (request.method === "PUT" && url.pathname === "/api/project") {
        const expected = Number(request.headers["if-match"]);
        if (!Number.isInteger(expected)) {
          json(response, 428, { error: "A saved project revision is required." });
          return;
        }
        const candidate = await bodyJson(request);
        context.project = await saveEditorProject(context.projectPath, candidate, {
          expectedRevision: expected,
          album: context.album,
          photoCodes: context.photoCodes,
        });
        json(response, 200, { project: context.project });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/export") {
        if (context.exporting) {
          json(response, 409, { error: "An export is already running." });
          return;
        }
        context.exporting = true;
        try {
          const result = await buildAlbum(context.albumPath, context.projectPath, context.outputPath);
          const layout = await readJson(path.join(context.outputPath, "layout.json"));
          if (layout.editorProject?.revision !== context.project.revision) {
            throw new Error("The renderer did not export the current saved project revision.");
          }
          context.lastExport = {
            revision: context.project.revision,
            completedAt: new Date().toISOString(),
            stdout: result.stdout.trim(),
          };
          context.hasOutput = true;
          json(response, 200, { export: context.lastExport });
        } finally {
          context.exporting = false;
        }
        return;
      }
      const photo = /^\/photo\/([PR]\d+)$/.exec(url.pathname)?.[1];
      if (request.method === "GET" && photo && context.photoFiles.has(photo)) {
        if (!thumbnails.has(photo)) {
          thumbnails.set(photo, sharp(context.photoFiles.get(photo)).rotate()
            .resize(1200, 1200, { fit: "inside", withoutEnlargement: true })
            .jpeg({ quality: 86 }).toBuffer());
        }
        response.writeHead(200, {
          "Content-Type": "image/jpeg",
          "Cache-Control": "private, max-age=3600",
          "X-Content-Type-Options": "nosniff",
        });
        response.end(await thumbnails.get(photo));
        return;
      }
      if (request.method === "GET" && url.pathname.startsWith("/book/")) {
        const relative = url.pathname.slice("/book/".length);
        if (!/^(album|interior|cover)\.pdf$|^cover-front\.jpg$|^preview\.html$|^preview\/(?:spread|spreads)-\d+\.jpg$/.test(relative)) {
          response.writeHead(404); response.end("Not found."); return;
        }
        const file = path.join(context.outputPath, ...relative.split("/"));
        const types = { ".pdf": "application/pdf", ".jpg": "image/jpeg", ".html": "text/html; charset=utf-8" };
        response.writeHead(200, {
          "Content-Type": types[path.extname(file)] || "application/octet-stream",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        });
        response.end(await fs.readFile(file));
        return;
      }
      const asset = staticFiles.get(url.pathname);
      if (request.method === "GET" && asset) {
        const headers = {
          "Content-Type": asset[1],
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        };
        if (url.pathname === "/" || url.pathname === "/preview.html") {
          headers["Content-Security-Policy"] = "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";
        }
        response.writeHead(200, headers);
        response.end(await fs.readFile(asset[0]));
        return;
      }
      response.writeHead(404); response.end("Not found.");
    } catch (error) {
      const status = error.statusCode || (error instanceof ProjectConflictError ? 409 : 500);
      if (status >= 500) console.error(error);
      if (!response.headersSent) json(response, status, { error: error.message });
      else response.end();
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  const address = server.address();
  const url = `http://127.0.0.1:${address.port}/preview.html?token=${encodeURIComponent(token)}`;
  return {
    server,
    context,
    token,
    port: address.port,
    url,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}
