import { buildSpreadDecor } from "./editor-decor.mjs";
import { makeEditorLayouts } from "./editor-layouts.mjs";

export const PAPER_THEMES = {
  white: { name: "Clean white", paper: "#ffffff", ink: "#141414", muted: "#7c7c7c" },
  cream: { name: "Warm cream", paper: "#f6f2ea", ink: "#1b1a18", muted: "#857e72" },
  dark: { name: "After dark", paper: "#121212", ink: "#f3f3f3", muted: "#9b9b9b" },
};

export const STYLE_PRESETS = {
  modern: {
    name: "Modern",
    description: "White paper, tight photo grids and clean, borderless images.",
    theme: "white", decor: "none", frameMat: false,
    layouts: ["portrait-lead", "reverse-lead", "portrait-row", "wide-story"],
  },
  crafted: {
    name: "Crafted",
    description: "Warm cream, watercolor washes, thin white borders and subtle ornaments.",
    theme: "cream", decor: "crafted", frameMat: true,
    layouts: ["overlap-story", "framed-haven", "portrait-lead", "reverse-lead"],
  },
  gallery: {
    name: "Gallery",
    description: "Dark paper, white photo borders and calm, photo-led compositions.",
    theme: "dark", decor: "none", frameMat: true,
    layouts: ["portrait-row", "portrait-lead", "reverse-lead"],
  },
};

export function stylePreset(key) {
  const preset = Object.hasOwn(STYLE_PRESETS, key) && STYLE_PRESETS[key];
  if (!preset) throw new Error(`Unknown stylePreset "${key}". Use modern, crafted or gallery.`);
  return preset;
}

export function resolveAlbumStyle(album) {
  if (album.stylePreset === undefined) return { ...album };
  const preset = stylePreset(album.stylePreset);
  return {
    theme: preset.theme,
    decor: preset.decor,
    font: album.direction === "rtl" ? "Heebo" : "Montserrat",
    showHeadings: false,
    callouts: false,
    ...album,
  };
}

export function presetLayoutPenalty(key, layout) {
  if (key === undefined) return 0;
  const rank = stylePreset(key).layouts.indexOf(layout);
  return rank < 0 ? 0.5 : rank * 0.08;
}

export function choosePresetLayout(options, key, { showHeadings = false, title = "" } = {}) {
  return options.filter((option) => {
    if (!option.available || option.titleTile && (!showHeadings || !title)) return false;
    const main = option.frames.find((frame) => frame.role === "main");
    const largest = Math.max(...option.frames.map((frame) => frame.box.w * frame.box.h));
    return !main || main.box.w * main.box.h >= largest * 0.9;
  }).sort((a, b) => (a.cost + presetLayoutPenalty(key, a.key)) -
    (b.cost + presetLayoutPenalty(key, b.key)))[0];
}

export function recolorBook(project, nextTheme) {
  const previous = PAPER_THEMES[project.book.theme];
  const next = PAPER_THEMES[nextTheme];
  if (!previous || !next) throw new Error("Unknown paper theme.");
  for (const id of project.order) {
    for (const text of project.spreads[id].texts) {
      if (text.role === "title" || text.color.toLowerCase() === previous.ink) text.color = next.ink;
      else if (text.role === "kicker" || text.color.toLowerCase() === previous.muted) text.color = next.muted;
    }
  }
  project.book.theme = nextTheme;
}

export function applyStylePreset(project, key, { photos, resetLayouts = false } = {}) {
  const preset = stylePreset(key);
  const next = structuredClone(project);
  recolorBook(next, preset.theme);
  Object.assign(next.book, {
    stylePreset: key,
    decor: preset.decor,
    font: next.book.direction === "rtl" ? "Heebo" : "Montserrat",
  });
  next.order.forEach((id, index) => {
    const spread = next.spreads[id];
    const spec = {
      ...next.book.geometry,
      direction: next.book.direction,
      decor: preset.decor,
      frameMat: preset.frameMat,
      callouts: false,
      showHeadings: next.book.showHeadings !== false,
      spreadIndex: index,
    };
    if (resetLayouts) {
      if (!photos) throw new Error("Photographs are required to reset preset layouts.");
      const candidates = spread.frames.filter((frame) => !frame.hidden).map((frame) => {
        const photo = photos.get(frame.photo);
        if (!photo) throw new Error(`Photo ${frame.photo} is not available.`);
        return { ...photo, id: frame.photo, frameId: frame.id, sceneId: id,
          role: frame.role, main: frame.role === "main" };
      });
      const option = choosePresetLayout(makeEditorLayouts(candidates, spec), key, {
        showHeadings: spec.showHeadings, title: spread.title,
      });
      if (!option) throw new Error(`No safe preset layout for "${spread.title || id}". Keep the current layout instead.`);
      spread.frames = [...option.frames, ...spread.frames.filter((frame) => frame.hidden)];
      spread.layout = option.key;
      for (const text of spread.texts) {
        if (text.role === "title") text.box = { ...option.titleBox };
        if (text.role === "kicker") text.box = { ...option.kickerBox };
      }
    }
    const decor = buildSpreadDecor({
      sceneId: id, index, recipe: spread.layout,
      frames: spread.frames, texts: spread.texts,
      spec, direction: next.book.direction, decor: preset.decor, callouts: false,
    });
    spread.wash = decor.wash;
    spread.frames = decor.frames;
    const customGraphics = (spread.graphics || []).filter((graphic) =>
      !new RegExp(`^${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-graphic-\\d{2}$`).test(graphic.id));
    spread.graphics = [...decor.graphics, ...customGraphics];
    spread.reviewed = false;
  });
  return next;
}
