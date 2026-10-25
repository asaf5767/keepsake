import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { DECOR_MODES, GRAPHICS, WASHES, buildSpreadDecor } from "./editor-decor.mjs";
import { resolveAlbumStyle, stylePreset } from "./style-presets.mjs";

export const PROJECT_KIND = "keepsake-editor-project";
export const PROJECT_SCHEMA_VERSION = 1;

export class ProjectConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = "ProjectConflictError";
  }
}

const plainPhoto = (value) => typeof value === "string" ? value : value?.id;
const finite = (value) => Number.isFinite(value);
const stable = (value) => {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
};

export function sceneDefinitions(album) {
  const result = [];
  (album.chapters || []).forEach((chapter, chapterIndex) => {
    if (!chapter.scenes?.length) {
      throw new Error(`Chapter "${chapter.title || chapterIndex + 1}" needs explicit scenes before opening the local editor.`);
    }
    const chapterId = chapter.id || `chapter-${String(chapterIndex + 1).padStart(2, "0")}`;
    chapter.scenes.forEach((scene, sceneIndex) => {
      const id = scene.id || `${chapterId}-scene-${String(sceneIndex + 1).padStart(2, "0")}`;
      const photos = (scene.photos || []).map(plainPhoto).filter(Boolean);
      if (photos.length < 2 || photos.length > 10) throw new Error(`Scene "${scene.title}" needs 2-10 photos.`);
      result.push({
        id,
        chapterId,
        chapterTitle: chapter.title || "",
        kicker: chapter.kicker || "",
        title: scene.title || "",
        photos,
        mainPhoto: (scene.photos || []).find((photo) => typeof photo === "object" && photo.role === "main")?.id,
      });
    });
  });
  return result;
}

export function albumFingerprint(album) {
  const photoSettings = album.photoSettings || {};
  const scenes = (album.chapters || []).flatMap((chapter, chapterIndex) => {
    const chapterId = chapter.id || `chapter-${String(chapterIndex + 1).padStart(2, "0")}`;
    if (chapter.scenes?.length) {
      return chapter.scenes.map((scene, sceneIndex) => ({
        id: scene.id || `${chapterId}-scene-${String(sceneIndex + 1).padStart(2, "0")}`,
        chapterId,
        chapterTitle: chapter.title || "",
        kicker: chapter.kicker || "",
        title: scene.title || "",
        photos: (scene.photos || []).map(plainPhoto).filter(Boolean),
        mainPhoto: (scene.photos || []).find((photo) => typeof photo === "object" && photo.role === "main")?.id,
      }));
    }
    return [{
      id: `${chapterId}-automatic`,
      chapterId,
      chapterTitle: chapter.title || "",
      kicker: chapter.kicker || "",
      title: chapter.title || "",
      photos: (chapter.photos || []).map(plainPhoto).filter(Boolean),
    }];
  });
  const referenced = new Set(scenes.flatMap((scene) => scene.photos));
  for (const value of [
    ...(album.cover?.photos || [album.cover?.photo]),
    ...(album.titlePage?.photos || [album.titlePage?.photo]),
    album.closing?.photo,
  ]) if (value) referenced.add(plainPhoto(value));
  const structure = {
    chapterStyle: album.chapterStyle || "compact",
    direction: album.direction || "ltr",
    geometry: {
      trimWidthMm: album.trimWidthMm ?? album.trimMm ?? 300,
      trimHeightMm: album.trimHeightMm ?? album.trimMm ?? 300,
      bleedMm: album.bleedMm ?? 3,
      marginMm: album.marginMm ?? 12,
      bindingMm: album.bindingMm ?? 3,
      gutterMm: album.gutterMm ?? 3,
    },
    cover: album.cover,
    titlePage: album.titlePage,
    closingPhoto: album.closing?.photo,
    ...(album.showHeadings === false ? { showHeadings: false } : {}),
    ...(album.callouts === true ? { callouts: true } : {}),
    ...(album.stylePreset !== undefined ? { stylePreset: album.stylePreset } : {}),
    scenes,
    photoSettings: Object.fromEntries([...referenced].sort().map((code) => [code, photoSettings[code] || null])),
  };
  return createHash("sha256").update(JSON.stringify(stable(structure))).digest("hex");
}

export function defaultProjectPath(albumPath) {
  const parsed = path.parse(path.resolve(albumPath));
  return path.join(parsed.dir, `${parsed.name}.project.json`);
}

function geometry(album) {
  const trimWidth = album.trimWidthMm ?? album.trimMm ?? 300;
  const trimHeight = album.trimHeightMm ?? album.trimMm ?? 300;
  const bleed = album.bleedMm ?? 3;
  return {
    pageWidth: trimWidth + 2 * bleed,
    pageHeight: trimHeight + 2 * bleed,
    trimWidth,
    trimHeight,
    bleed,
    margin: album.marginMm ?? 12,
    binding: album.bindingMm ?? 3,
    gutter: album.gutterMm ?? 3,
  };
}

export function createEditorProject({ album, layout, albumPath = "album.json" }) {
  const sourceFingerprint = albumFingerprint(album);
  album = resolveAlbumStyle(album);
  if ((album.chapterStyle || "compact") !== "compact") throw new Error("The local editor supports the compact design.");
  const definitions = sceneDefinitions(album);
  const evidence = new Map((layout.scenes || []).map((scene) => [scene.id, scene]));
  const spec = geometry(album);
  const decorMode = DEFAULTS_DECOR(album.decor);
  const spreads = {};
  for (const [spreadIndex, definition] of definitions.entries()) {
    const scene = evidence.get(definition.id);
    if (!scene?.frames?.length) {
      throw new Error(`Build evidence for "${definition.title}" is missing editable frames. Rebuild the album with this Keepsake version.`);
    }
    const baseFrames = scene.frames.map((frame, index) => ({
      id: frame.id || `${definition.id}-frame-${String(index + 1).padStart(2, "0")}`,
      photo: frame.photo,
      role: frame.role || (frame.photo === definition.mainPhoto ? "main" : "support"),
      box: { ...frame.box },
      fit: frame.fit || "safe",
      focusX: frame.focusX ?? 50,
      focusY: frame.focusY ?? 50,
      zoom: frame.zoom ?? 1,
      mat: frame.mat,
      hidden: !!frame.hidden,
    }));
    const baseTexts = (scene.texts || []).map((text, index) => ({
      id: text.id || `${definition.id}-text-${String(index + 1).padStart(2, "0")}`,
      role: text.role || "note",
      fontStyle: text.fontStyle || "sans",
      text: text.text || "",
      box: { ...text.box },
      fontPt: text.fontPt || (text.role === "title" ? 17.9 : 8.5),
      weight: text.weight || (text.role === "title" ? 700 : 500),
      color: text.color || (text.role === "title" ? "#141414" : "#7c7c7c"),
      align: text.align || "left",
      hidden: !!text.hidden,
    }));
    const fallbackDecor = buildSpreadDecor({
      sceneId: definition.id,
      index: spreadIndex,
      recipe: scene.recipe || "custom",
      frames: baseFrames,
      texts: baseTexts,
      spec: { ...spec, frameMat: album.stylePreset === undefined ? undefined : stylePreset(album.stylePreset).frameMat },
      direction: album.direction || "ltr",
      decor: decorMode,
      callouts: album.callouts === true,
    });
    const wash = scene.wash || fallbackDecor.wash;
    const graphics = (scene.graphics || fallbackDecor.graphics || []).map((graphic, index) => ({
      id: graphic.id || `${definition.id}-graphic-${String(index + 1).padStart(2, "0")}`,
      kind: graphic.kind,
      box: { ...graphic.box },
      color: graphic.color || GRAPHICS[graphic.kind]?.defaultColor || "#3a322d",
      hidden: !!graphic.hidden,
    }));
    const texts = scene.texts?.some((t) => t.role === "callout") ? baseTexts : fallbackDecor.texts;
    spreads[definition.id] = {
      id: definition.id,
      chapterId: definition.chapterId,
      chapterTitle: definition.chapterTitle,
      title: definition.title,
      kicker: definition.kicker,
      layout: scene.recipe || "custom",
      wash: {
        left: wash?.left || "none",
        right: wash?.right || "none",
      },
      reviewed: false,
      frames: fallbackDecor.frames.map((frame) => ({
        ...frame,
        mat: !!frame.mat,
      })),
      texts,
      graphics,
    };
  }
  const now = new Date().toISOString();
  return {
    kind: PROJECT_KIND,
    schemaVersion: PROJECT_SCHEMA_VERSION,
    revision: 0,
    id: randomUUID(),
    createdAt: now,
    updatedAt: now,
    source: {
      album: path.basename(albumPath),
      fingerprint: sourceFingerprint,
    },
    book: {
      title: album.title || "",
      subtitle: album.subtitle || "",
      theme: album.theme || "white",
      ...(album.stylePreset !== undefined ? { stylePreset: album.stylePreset } : {}),
      decor: decorMode,
      showHeadings: album.showHeadings !== false,
      callouts: album.callouts === true,
      font: album.font || (album.direction === "rtl" ? "Heebo" : "Montserrat"),
      direction: album.direction || "ltr",
      geometry: spec,
    },
    order: definitions.map((scene) => scene.id),
    spreads,
  };
}

const DEFAULTS_DECOR = (value) => DECOR_MODES.includes(value) ? value : "crafted";

const assertBox = (box, width, height, label) => {
  if (!box || ![box.x, box.y, box.w, box.h].every(finite) || box.w <= 0 || box.h <= 0 ||
      box.x < 0 || box.y < 0 || box.x + box.w > width + 0.001 || box.y + box.h > height + 0.001) {
    throw new Error(`${label} has an invalid spread box.`);
  }
};

export function validateEditorProject(project, { album, photoCodes } = {}) {
  if (!project || project.kind !== PROJECT_KIND) throw new Error(`Project kind must be "${PROJECT_KIND}".`);
  if (project.schemaVersion !== PROJECT_SCHEMA_VERSION) throw new Error(`Unsupported project schema ${project.schemaVersion}.`);
  if (!Number.isInteger(project.revision) || project.revision < 0) throw new Error("Project revision must be a nonnegative integer.");
  if (!project.book || !["white", "cream", "dark"].includes(project.book.theme)) throw new Error("Project theme is invalid.");
  if (project.book.decor !== undefined && !DECOR_MODES.includes(project.book.decor)) throw new Error("Project decor mode is invalid.");
  if (project.book.stylePreset !== undefined) stylePreset(project.book.stylePreset);
  for (const key of ["showHeadings", "callouts"]) {
    if (project.book[key] !== undefined && typeof project.book[key] !== "boolean") throw new Error(`Project ${key} must be a boolean.`);
  }
  if (!["Montserrat", "Heebo"].includes(project.book.font)) throw new Error("Project font must be Montserrat or Heebo.");
  if (!["ltr", "rtl"].includes(project.book.direction)) throw new Error("Project direction is invalid.");
  if (typeof project.book.title !== "string" || project.book.title.length > 500 ||
      typeof project.book.subtitle !== "string" || project.book.subtitle.length > 1000) {
    throw new Error("Project title or subtitle is invalid.");
  }
  const pageWidth = project.book.geometry?.pageWidth, pageHeight = project.book.geometry?.pageHeight;
  if (![pageWidth, pageHeight].every((value) => finite(value) && value > 0)) throw new Error("Project page geometry is invalid.");
  if (album && project.source?.fingerprint !== albumFingerprint(album)) {
    throw new Error("The editor project does not match the album structure. Reopen the editor with a new project.");
  }
  if (album) {
    const expected = geometry(album);
    for (const [key, value] of Object.entries(expected)) {
      if (Math.abs(project.book.geometry[key] - value) > 0.001) throw new Error("Project page geometry does not match album.json.");
    }
    if (project.book.direction !== (album.direction || "ltr")) throw new Error("Project direction does not match album.json.");
  }
  if (!Array.isArray(project.order) || new Set(project.order).size !== project.order.length) throw new Error("Project spread order is invalid.");
  if (!project.spreads || new Set(Object.keys(project.spreads)).size !== project.order.length ||
      project.order.some((id) => !project.spreads[id]) || Object.keys(project.spreads).some((id) => !project.order.includes(id))) {
    throw new Error("Project order and spreads must contain the same IDs.");
  }
  if (album) {
    const sourceIds = new Set(sceneDefinitions(album).map((scene) => scene.id));
    if (sourceIds.size !== project.order.length || project.order.some((id) => !sourceIds.has(id))) {
      throw new Error("Project spreads do not match album.json.");
    }
  }
  const ids = new Set();
  for (const id of project.order) {
    const spread = project.spreads[id];
    if (spread.id !== id) throw new Error(`Spread "${id}" has the wrong ID.`);
    if (spread.reviewed !== undefined && typeof spread.reviewed !== "boolean") throw new Error(`Spread "${id}" has an invalid review state.`);
    if (!Array.isArray(spread.frames) || !spread.frames.length) throw new Error(`Spread "${id}" needs at least one frame.`);
    if (!spread.frames.some((frame) => !frame.hidden)) throw new Error(`Spread "${id}" needs at least one visible frame.`);
    for (const frame of spread.frames) {
      if (!frame.id || ids.has(frame.id)) throw new Error(`Frame ID "${frame.id}" is missing or repeated.`);
      ids.add(frame.id);
      if (!frame.photo || photoCodes && !photoCodes.has(frame.photo)) throw new Error(`Frame "${frame.id}" uses an unknown photo.`);
      if (!["main", "support", "detail"].includes(frame.role)) throw new Error(`Frame "${frame.id}" has an invalid role.`);
      if (typeof frame.hidden !== "boolean") throw new Error(`Frame "${frame.id}" has an invalid hidden state.`);
      assertBox(frame.box, pageWidth * 2, pageHeight, `Frame "${frame.id}"`);
      if (!["safe", "contain", "cover"].includes(frame.fit)) throw new Error(`Frame "${frame.id}" has an invalid fit.`);
      if (![frame.focusX, frame.focusY].every((value) => finite(value) && value >= 0 && value <= 100)) {
        throw new Error(`Frame "${frame.id}" has an invalid focus.`);
      }
      if (!finite(frame.zoom) || frame.zoom < 1 || frame.zoom > 3) throw new Error(`Frame "${frame.id}" has an invalid zoom.`);
      if (frame.mat !== undefined && typeof frame.mat !== "boolean") throw new Error(`Frame "${frame.id}" has an invalid mat border state.`);
    }
    if (spread.wash !== undefined) {
      if (!spread.wash || typeof spread.wash !== "object" ||
          !WASHES[spread.wash.left || "none"] || !WASHES[spread.wash.right || "none"]) {
        throw new Error(`Spread "${id}" has an invalid page wash.`);
      }
    }
    if (!Array.isArray(spread.texts)) throw new Error(`Spread "${id}" texts must be an array.`);
    for (const text of spread.texts) {
      if (!text.id || ids.has(text.id)) throw new Error(`Text ID "${text.id}" is missing or repeated.`);
      ids.add(text.id);
      if (typeof text.text !== "string" || text.text.length > 10000) throw new Error(`Text "${text.id}" has invalid wording.`);
      assertBox(text.box, pageWidth * 2, pageHeight, `Text "${text.id}"`);
      if (!finite(text.fontPt) || text.fontPt < 6 || text.fontPt > 144) throw new Error(`Text "${text.id}" has an invalid size.`);
      if (!finite(text.weight) || text.weight < 100 || text.weight > 900) throw new Error(`Text "${text.id}" has an invalid weight.`);
      if (text.fontStyle !== undefined && !["sans", "script"].includes(text.fontStyle)) throw new Error(`Text "${text.id}" has an invalid fontStyle.`);
      if (!/^#[0-9a-f]{6}$/i.test(text.color)) throw new Error(`Text "${text.id}" has an invalid colour.`);
      if (!["left", "center", "right"].includes(text.align)) throw new Error(`Text "${text.id}" has an invalid alignment.`);
      if (typeof text.hidden !== "boolean") throw new Error(`Text "${text.id}" has an invalid hidden state.`);
    }
    if (spread.graphics !== undefined) {
      if (!Array.isArray(spread.graphics)) throw new Error(`Spread "${id}" graphics must be an array.`);
      for (const graphic of spread.graphics) {
        if (!graphic.id || ids.has(graphic.id)) throw new Error(`Graphic ID "${graphic.id}" is missing or repeated.`);
        ids.add(graphic.id);
        if (!GRAPHICS[graphic.kind]) throw new Error(`Graphic "${graphic.id}" uses an unknown graphic kind.`);
        assertBox(graphic.box, pageWidth * 2, pageHeight, `Graphic "${graphic.id}"`);
        if (graphic.color !== undefined && !/^#[0-9a-f]{6}$/i.test(graphic.color)) throw new Error(`Graphic "${graphic.id}" has an invalid colour.`);
        if (typeof graphic.hidden !== "boolean") throw new Error(`Graphic "${graphic.id}" has an invalid hidden state.`);
      }
    }
  }
  return project;
}

export async function loadEditorProject(file, options) {
  const project = JSON.parse(await fs.readFile(file, "utf8"));
  return validateEditorProject(project, options);
}

export async function saveEditorProject(file, project, { expectedRevision, album, photoCodes } = {}) {
  let current = null;
  try {
    current = JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const actualRevision = current?.revision ?? 0;
  if (expectedRevision !== undefined && expectedRevision !== actualRevision) {
    throw new ProjectConflictError(`Project revision changed from ${expectedRevision} to ${actualRevision}. Reload before saving.`);
  }
  const saved = structuredClone(project);
  saved.revision = actualRevision + 1;
  saved.updatedAt = new Date().toISOString();
  validateEditorProject(saved, { album, photoCodes });
  const directory = path.dirname(path.resolve(file));
  await fs.mkdir(directory, { recursive: true });
  const temporary = path.join(directory, `.${path.basename(file)}.${process.pid}.${randomUUID()}.tmp`);
  await fs.writeFile(temporary, JSON.stringify(saved, null, 2) + "\n", "utf8");
  await fs.rename(temporary, file);
  return saved;
}
