import {
  CALLOUT_PRESETS,
  GRAPHICS,
  WASHES,
  buildSpreadDecor,
  graphicSvgMarkup,
  washSvgMarkup,
} from "/editor-decor.mjs";
import { makeEditorLayouts } from "/editor-layouts.mjs";
import { placementWarnings, protectedBounds, resolveFramePlacement } from "/editor-placement.mjs";

const token = new URL(location.href).searchParams.get("token");
if (!token) throw new Error("This Keepsake editor link has no session token.");

async function api(path, options = {}) {
  const headers = { "X-Keepsake-Token": token, ...(options.headers || {}) };
  if (options.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
  const response = await fetch(path, { ...options, headers });
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(value.error || `Request failed (${response.status}).`);
  return value;
}

const data = await api("/api/project");
const app = document.querySelector("#app");
const byPhoto = new Map(data.photos.map((photo) => [photo.id, photo]));
const themes = {
  white: { name: "Clean white", paper: "#ffffff", ink: "#141414", muted: "#7c7c7c" },
  cream: { name: "Warm cream", paper: "#f6f2ea", ink: "#1b1a18", muted: "#857e72" },
  dark: { name: "After dark", paper: "#121212", ink: "#f3f3f3", muted: "#9b9b9b" },
};
let project = data.project;
let dirty = false;
let saving = false;
let exporting = false;
let exportResult = data.export || (data.hasOutput ? { revision: null } : null);
const history = [];
const ui = {
  view: "board",
  active: project.order[0],
  selected: null,
  panel: "inspect",
  previewLayout: null,
  guides: false,
  libraryFilter: "scene",
  query: "",
  draggedSpread: null,
};
let pointer = null;
let toastTimer;

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[character]);
const pct = (value, total) => `${value / total * 100}%`;
const textDirection = (value) => /[\u0590-\u05ff]/.test(value || "") || project.book.direction === "rtl" ? "rtl" : "ltr";
const photoUrl = (code) => `/photo/${encodeURIComponent(code)}?token=${encodeURIComponent(token)}`;
const bookUrl = (file) => `/book/${file}?token=${encodeURIComponent(token)}`;
const geometry = () => project.book.geometry;
const activeSpread = () => project.spreads[ui.active];
const selectedLayer = () => {
  const spread = activeSpread();
  if (!spread || !ui.selected) return null;
  return spread.frames.find((frame) => frame.id === ui.selected) ||
    spread.texts.find((text) => text.id === ui.selected) ||
    (spread.graphics || []).find((graphic) => graphic.id === ui.selected) || null;
};
const isFrame = (layer) => !!layer?.photo;
const isGraphic = (layer) => !!layer?.kind && !!GRAPHICS[layer.kind];
const currentTheme = () => themes[project.book.theme] || themes.white;

function toast(message, error = false) {
  const element = document.querySelector("#toast");
  element.textContent = message;
  element.classList.toggle("error", error);
  element.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove("show"), 3200);
}

function remember(fn, { invalidateReview = "active" } = {}) {
  history.push(structuredClone(project));
  if (history.length > 60) history.shift();
  fn();
  dirty = true;
  if (invalidateReview === "all") {
    for (const id of project.order) project.spreads[id].reviewed = false;
  } else if (invalidateReview === "active") {
    const spread = activeSpread();
    if (spread) spread.reviewed = false;
  }
  render();
}

function undo() {
  if (!history.length) return;
  project = history.pop();
  dirty = true;
  ui.selected = null;
  ui.previewLayout = null;
  render();
  toast("Last change undone.");
}

function usedPhotos() {
  const used = new Map();
  for (const id of project.order) {
    for (const frame of project.spreads[id].frames) {
      if (!frame.hidden) used.set(frame.photo, [...(used.get(frame.photo) || []), id]);
    }
  }
  return used;
}

function photoForFrame(frame) {
  const photo = byPhoto.get(frame.photo);
  if (!photo) throw new Error(`Photo ${frame.photo} is not available.`);
  return photo;
}

function frameWarnings(frame) {
  const placement = resolveFramePlacement(photoForFrame(frame), frame);
  return placementWarnings(photoForFrame(frame), placement, {
    pageWidth: geometry().pageWidth,
    binding: geometry().binding,
  });
}

function frameMarkup(frame, { miniature = false } = {}) {
  if (frame.hidden) return "";
  const photo = photoForFrame(frame);
  const placement = resolveFramePlacement(photo, frame);
  const pageWidth = geometry().pageWidth, pageHeight = geometry().pageHeight;
  const spreadWidth = pageWidth * 2, rect = placement.rect, crop = placement.crop, box = frame.box;
  const selected = !miniature && ui.selected === frame.id;
  const warnings = placementWarnings(photo, placement, { pageWidth, binding: geometry().binding });
  const subject = !miniature && ui.guides ? protectedBounds(photo, placement) : null;
  const interaction = miniature ? "" : `role="button" tabindex="0" aria-label="Photograph ${esc(frame.photo)}"`;
  return `<div class="layer photo-layer ${selected ? "selected" : ""} ${warnings.length ? "warning" : ""}"
      data-layer="${esc(frame.id)}" data-kind="frame" ${interaction}
      style="left:${pct(box.x, spreadWidth)};top:${pct(box.y, pageHeight)};width:${pct(box.w, spreadWidth)};height:${pct(box.h, pageHeight)}"
      title="${esc(warnings.join(" ") || `${frame.photo} · ${placement.reason}`)}">
    <div class="photo-clip ${frame.mat ? "mat-frame" : ""}" style="left:${pct(rect.x - box.x, box.w)};top:${pct(rect.y - box.y, box.h)};width:${pct(rect.w, box.w)};height:${pct(rect.h, box.h)}">
      <img src="${photoUrl(frame.photo)}" alt="${esc(frame.photo)}" loading="${miniature ? "lazy" : "eager"}"
        style="left:${-crop.left / crop.width * 100}%;top:${-crop.top / crop.height * 100}%;width:${photo.width / crop.width * 100}%;height:${photo.height / crop.height * 100}%">
    </div>
    ${subject ? `<span class="subject-guide" style="left:${pct(subject.x - box.x, box.w)};top:${pct(subject.y - box.y, box.h)};width:${pct(subject.w, box.w)};height:${pct(subject.h, box.h)}"></span>` : ""}
    ${miniature ? "" : '<span class="resize-handle" aria-hidden="true"></span>'}
  </div>`;
}

function textMarkup(text, { miniature = false } = {}) {
  if (text.hidden) return "";
  const pageWidth = geometry().pageWidth, pageHeight = geometry().pageHeight, box = text.box;
  const interaction = miniature ? "" : `role="button" tabindex="0" aria-label="${esc(text.role)} text: ${esc(text.text)}"`;
  const scriptCls = text.fontStyle === "script" ? "script-text" : "";
  return `<div class="layer text-layer ${scriptCls} ${!miniature && ui.selected === text.id ? "selected" : ""}"
      data-layer="${esc(text.id)}" data-kind="text" ${interaction}
      dir="${textDirection(text.text)}"
      style="left:${pct(box.x, pageWidth * 2)};top:${pct(box.y, pageHeight)};width:${pct(box.w, pageWidth * 2)};height:${pct(box.h, pageHeight)};
      font-size:${(text.fontPt * 25.4 / 72 / (pageWidth * 2) * 100).toFixed(4)}cqw;font-weight:${text.weight || 500};color:${esc(text.color)};text-align:${text.align}">${esc(text.text)}${miniature ? "" : '<span class="resize-handle" aria-hidden="true"></span>'}</div>`;
}

function graphicMarkup(graphic, { miniature = false } = {}) {
  if (graphic.hidden || !GRAPHICS[graphic.kind]) return "";
  const pageWidth = geometry().pageWidth, pageHeight = geometry().pageHeight, box = graphic.box;
  const interaction = miniature ? "" : `role="button" tabindex="0" aria-label="Graphic ${esc(GRAPHICS[graphic.kind].name)}"`;
  return `<div class="layer graphic-layer ${!miniature && ui.selected === graphic.id ? "selected" : ""}"
      data-layer="${esc(graphic.id)}" data-kind="graphic" ${interaction}
      style="left:${pct(box.x, pageWidth * 2)};top:${pct(box.y, pageHeight)};width:${pct(box.w, pageWidth * 2)};height:${pct(box.h, pageHeight)}"
      title="${esc(GRAPHICS[graphic.kind].name)}">${graphicSvgMarkup(graphic)}${miniature ? "" : '<span class="resize-handle" aria-hidden="true"></span>'}</div>`;
}

function washLayerMarkup(spread) {
  const left = spread.wash?.left || "none";
  const right = spread.wash?.right || "none";
  return `${left !== "none" ? `<div class="wash-half left" data-wash-left="${esc(left)}">${washSvgMarkup(left, "left")}</div>` : ""}${right !== "none" ? `<div class="wash-half right" data-wash-right="${esc(right)}">${washSvgMarkup(right, "right")}</div>` : ""}`;
}

function previewSpread(option) {
  const spread = structuredClone(activeSpread());
  spread.frames = [...option.frames, ...spread.frames.filter((frame) => frame.hidden)];
  spread.wash = option.wash ? { ...option.wash } : (spread.wash || { left: "none", right: "none" });
  spread.graphics = structuredClone(option.graphics || []);
  spread.texts = [
    ...spread.texts.filter((text) => text.role !== "callout"),
    ...structuredClone(option.callouts || []),
  ];
  const title = spread.texts.find((text) => text.role === "title");
  const kicker = spread.texts.find((text) => text.role === "kicker");
  const defaultAlign = project.book.direction === "rtl" ? "right" : "left";
  if (title) {
    title.box = { ...option.titleBox };
    title.align = option.key === "center-note-grid" ? "center" : defaultAlign;
    title.fontPt = option.key === "center-note-grid" ? 12.5 : 17.9;
    title.weight = option.key === "center-note-grid" ? 500 : 700;
  }
  if (kicker) {
    kicker.box = { ...option.kickerBox };
    kicker.align = option.key === "center-note-grid" ? "center" : defaultAlign;
  }
  spread.layout = option.key;
  return spread;
}

function currentCanvasSpread() {
  const option = layoutOptions().find((candidate) => candidate.key === ui.previewLayout);
  return option ? previewSpread(option) : activeSpread();
}

function spreadMarkup(spread, miniature = false) {
  const theme = currentTheme();
  return `<div class="spread-paper ${miniature ? "miniature" : ""}" style="background:${theme.paper};color:${theme.ink};font-family:'${project.book.font}',sans-serif">
    ${washLayerMarkup(spread)}
    ${spread.frames.map((frame) => frameMarkup(frame, { miniature })).join("")}
    ${(spread.graphics || []).map((graphic) => graphicMarkup(graphic, { miniature })).join("")}
    ${spread.texts.map((text) => textMarkup(text, { miniature })).join("")}
    <span class="fold"></span>
  </div>`;
}

function bookendMarkup(kind) {
  const bookend = data.bookends[kind];
  const title = kind === "closing" ? bookend.text || project.book.title : project.book.title;
  const subtitle = kind === "closing" ? "" : project.book.subtitle;
  const photos = bookend.photos || [];
  const images = kind === "cover" && photos.length >= 3
    ? `<img class="bookend-main" src="${photoUrl(photos[0])}" alt="" loading="lazy">
       <img class="bookend-support-one" src="${photoUrl(photos[1])}" alt="" loading="lazy">
       <img class="bookend-support-two" src="${photoUrl(photos[2])}" alt="" loading="lazy">`
    : photos[0] ? `<img class="bookend-main" src="${photoUrl(photos[0])}" alt="" loading="lazy">` : "";
  return `<div class="spread-paper miniature bookend ${kind}" style="background:${currentTheme().paper};color:${currentTheme().ink};font-family:'${project.book.font}',sans-serif">
    ${images}
    <div class="bookend-title"><strong>${esc(title)}</strong>${subtitle ? `<span>${esc(subtitle)}</span>` : ""}</div>
    <span class="fold"></span>
  </div>`;
}

function header() {
  const status = saving ? "Saving…" : exporting ? "Exporting PDFs…" :
    dirty ? "Unsaved changes" : `Saved revision ${project.revision}`;
  const stalePdf = !exportResult || exportResult.revision !== project.revision;
  return `<header class="topbar">
    <div class="brand"><span>k</span><div>keepsake<small>Local album editor</small></div></div>
    <div class="book-name">${esc(project.book.title)}<small>${esc(project.book.subtitle || data.projectFile)}</small></div>
    <div class="save-state ${dirty ? "dirty" : ""}">${status}</div>
    ${exportResult ? `<a class="button quiet ${stalePdf ? "stale" : ""}" href="${bookUrl("album.pdf")}" target="_blank" rel="noopener" title="${stalePdf ? "This PDF is older than the saved project." : "PDF exported from this saved revision."}">${stalePdf ? "Last PDF (older)" : "Open PDF"}</a>` : ""}
    <button class="quiet" data-action="undo" ${history.length ? "" : "disabled"}>Undo</button>
    <button data-action="save" ${dirty && !saving && !exporting ? "" : "disabled"}>Save</button>
    <button class="primary" data-action="export" ${saving || exporting ? "disabled" : ""}>${exporting ? "Exporting…" : "Export PDFs"}</button>
  </header>`;
}

function fixedCard(kind, index, title) {
  return `<article class="board-card fixed">
    <div class="board-image">${bookendMarkup(kind)}</div>
    <div class="board-caption"><small>${String(index).padStart(2, "0")} · Bookend</small><h2>${esc(title)}</h2><span>Fixed structure</span></div>
  </article>`;
}

function board() {
  const cards = [
    fixedCard("cover", 1, "Front cover"),
    fixedCard("opening", 2, "Opening page"),
    ...project.order.map((id, index) => {
      const spread = project.spreads[id];
      return `<article class="board-card ${spread.reviewed ? "reviewed" : ""}" draggable="true" data-spread="${id}">
        <button class="board-image" data-action="open-spread" data-id="${id}">${spreadMarkup(spread, true)}</button>
        <div class="board-caption"><small>${String(index + 3).padStart(2, "0")} · ${esc(spread.chapterTitle)}</small>
          <h2>${esc(spread.title)}</h2>
          <div><span>${spread.reviewed ? "Reviewed" : esc(spread.layout)}</span>
            <button data-action="move" data-id="${id}" data-delta="-1" aria-label="Move earlier">&larr;</button>
            <button data-action="move" data-id="${id}" data-delta="1" aria-label="Move later">&rarr;</button>
            <button data-action="open-spread" data-id="${id}">Edit</button>
          </div>
        </div>
      </article>`;
    }),
    fixedCard("closing", project.order.length + 3, "Closing page"),
  ];
  const reviewed = project.order.filter((id) => project.spreads[id].reviewed).length;
  return `<main class="storyboard">
    <section class="board-title"><div><div class="eyebrow">The whole story</div><h1>Your book, at a glance.</h1>
      <p>Reorder scenes, open a spread, save the project, then export through Keepsake.</p></div>
      <div class="review-progress"><strong>${reviewed}/${project.order.length}</strong><span>spreads reviewed</span></div>
      <button data-action="style">Book style</button>
    </section>
    <section class="board-grid">${cards.join("")}</section>
    <p class="board-note">Cover, opening and closing stay fixed. Every other card is a saved, editable spread.</p>
  </main>`;
}

function layoutOptions() {
  const spread = activeSpread();
  if (!spread) return [];
  const spreadIndex = Math.max(0, project.order.indexOf(spread.id));
  const photos = spread.frames.filter((frame) => !frame.hidden).map((frame) => ({
    ...byPhoto.get(frame.photo),
    frameId: frame.id,
    sceneId: spread.id,
    id: frame.photo,
    main: frame.role === "main",
    role: frame.role,
  }));
  return makeEditorLayouts(photos, {
    ...geometry(),
    direction: project.book.direction,
    decor: project.book.decor || "crafted",
    showHeadings: project.book.showHeadings !== false,
    callouts: project.book.callouts === true,
    spreadIndex,
  });
}

function layoutPanel() {
  const options = layoutOptions();
  return `<div class="panel-heading"><div class="eyebrow">Same photographs</div><h2>Choose a layout</h2>
    <p>Only safe options can be applied. Previewing does not change the project.</p></div>
    <div class="layout-grid">${options.map((option) => `<button class="layout-choice ${ui.previewLayout === option.key ? "active" : ""}"
      data-action="preview-layout" data-layout="${option.key}" ${option.available ? "" : "disabled"} title="${esc(option.reason || option.description)}">
      ${spreadMarkup(previewSpread(option), true)}
      <strong>${esc(option.name)}</strong><span>${option.available ? `${Math.round(option.coverage * 100)}% photo coverage` : "Not safe for these photos"}</span>
    </button>`).join("")}</div>
    <div class="sticky-actions"><button data-action="cancel-preview">Cancel</button>
      <button class="primary" data-action="apply-layout" ${ui.previewLayout ? "" : "disabled"}>Apply layout</button></div>`;
}

function photoLibrary() {
  const used = usedPhotos();
  const scenePhotos = new Set(activeSpread().frames.map((frame) => frame.photo));
  const query = ui.query.trim().toLowerCase();
  const photos = data.photos.filter((photo) => {
    if (query && !`${photo.id} ${photo.day || ""} ${photo.what || ""}`.toLowerCase().includes(query)) return false;
    if (ui.libraryFilter === "scene") return scenePhotos.has(photo.id);
    if (ui.libraryFilter === "unused") return !used.has(photo.id);
    return true;
  });
  return `<div class="panel-heading"><div class="eyebrow">Photo library</div><h2>Replace a photograph</h2>
    <p>Select a photo frame on the spread, then choose a photograph here.</p></div>
    <input class="search" data-search placeholder="Search by code, date or type" value="${esc(ui.query)}">
    <div class="filter-row">${["scene", "unused", "all"].map((filter) =>
      `<button class="${ui.libraryFilter === filter ? "active" : ""}" data-action="photo-filter" data-filter="${filter}">${filter}</button>`).join("")}</div>
    <div class="photo-library">${photos.map((photo) => `<button class="photo-choice" data-action="replace-photo" data-photo="${photo.id}">
      <img src="${photoUrl(photo.id)}" alt="${esc(photo.id)}" loading="lazy"><span>${photo.id}${used.has(photo.id) ? " · used" : ""}</span>
    </button>`).join("")}</div>`;
}

function numberField(label, field, value, min, max, step = 1) {
  return `<label>${label}<input type="number" data-layer-field="${field}" value="${Number(value).toFixed(1)}" min="${min}" max="${max}" step="${step}"></label>`;
}

function decorPanel() {
  const spread = activeSpread();
  const leftWash = spread.wash?.left || "none";
  const rightWash = spread.wash?.right || "none";
  return `<div class="panel-heading"><div class="eyebrow">Crafted touches</div><h2>Washes, graphics &amp; callouts</h2>
    <p>Add soft watercolor page washes, subtle ornaments, seam stickers or short script words.</p></div>
    <div class="field-grid">
      <label>Left page wash<select data-wash-side="left">${Object.entries(WASHES).map(([key, item]) =>
        `<option value="${key}" ${leftWash === key ? "selected" : ""}>${esc(item.name)}</option>`).join("")}</select></label>
      <label>Right page wash<select data-wash-side="right">${Object.entries(WASHES).map(([key, item]) =>
        `<option value="${key}" ${rightWash === key ? "selected" : ""}>${esc(item.name)}</option>`).join("")}</select></label>
    </div>
    <div class="eyebrow" style="margin:16px 0 8px">Add graphic or badge</div>
    <div class="graphic-grid">${Object.entries(GRAPHICS).map(([key, item]) =>
      `<button class="graphic-choice" data-action="add-graphic" data-graphic="${key}" title="${esc(item.name)}">
        <span class="graphic-thumb">${item.svg(item.defaultColor)}</span>
        <small>${esc(item.name)}</small>
      </button>`).join("")}</div>
    <div class="eyebrow" style="margin:18px 0 8px">Add optional callout</div>
    <div class="callout-list">${CALLOUT_PRESETS.map((preset) =>
      `<button class="callout-chip" data-action="add-callout" data-callout="${preset.key}">${esc(preset.label)}</button>`).join("")}</div>`;
}

function inspector() {
  const layer = selectedLayer();
  if (!layer) {
    const spread = activeSpread();
    const visibleGraphics = (spread.graphics || []).filter((g) => !g.hidden).length;
    const washText = [spread.wash?.left !== "none" ? `L: ${spread.wash?.left}` : null, spread.wash?.right !== "none" ? `R: ${spread.wash?.right}` : null]
      .filter(Boolean).join(" · ") || "clean paper";
    return `<div class="panel-heading"><div class="eyebrow">${esc(spread.chapterTitle)}</div><h2>${esc(spread.title)}</h2>
      <p>${spread.reviewed ? "This spread is marked reviewed." : "Select a photograph, graphic or words on the spread to edit them."}</p></div>
      <button class="${spread.reviewed ? "" : "primary"} wide-button" data-action="review">${spread.reviewed ? "Mark as needing review" : "Mark spread reviewed"}</button>
      <div class="spread-summary"><span>${spread.frames.filter((frame) => !frame.hidden).length} photos · ${visibleGraphics} graphics</span><span>${esc(washText)}</span></div>
      <div class="button-row"><button class="wide-button" data-action="decor">Edit washes &amp; graphics</button></div>`;
  }
  const pageWidth = geometry().pageWidth, pageHeight = geometry().pageHeight;
  if (isFrame(layer)) {
    const warnings = frameWarnings(layer);
    return `<div class="panel-heading"><div class="eyebrow">Photograph</div><h2>${esc(layer.photo)}</h2>
      <p>${warnings.length ? esc(warnings.join(" ")) : "The saved crop keeps the marked subject in frame."}</p></div>
      <div class="field-grid">${numberField("X · mm", "x", layer.box.x, 0, pageWidth * 2 - layer.box.w)}
        ${numberField("Y · mm", "y", layer.box.y, 0, pageHeight - layer.box.h)}
        ${numberField("Width · mm", "w", layer.box.w, 10, pageWidth * 2 - layer.box.x)}
        ${numberField("Height · mm", "h", layer.box.h, 8, pageHeight - layer.box.y)}</div>
      <label class="field"><input type="checkbox" data-layer-check="mat" ${layer.mat ? "checked" : ""}> White photo border</label>
      <label class="field">Framing<select data-layer-field="fit">
        <option value="safe" ${layer.fit === "safe" ? "selected" : ""}>Subject-aware</option>
        <option value="contain" ${layer.fit === "contain" ? "selected" : ""}>Keep the whole photo</option>
        <option value="cover" ${layer.fit === "cover" ? "selected" : ""}>Manual fill</option>
      </select></label>
      <label class="field">Zoom<input type="range" data-layer-field="zoom" min="1" max="3" step=".05" value="${layer.zoom}"></label>
      <div class="field-grid">${numberField("Focus X · %", "focusX", layer.focusX, 0, 100)}
        ${numberField("Focus Y · %", "focusY", layer.focusY, 0, 100)}</div>
      <div class="button-row"><button data-action="photos">Replace photo</button><button data-action="remove-layer">Remove</button></div>`;
  }
  if (isGraphic(layer)) {
    const entry = GRAPHICS[layer.kind];
    return `<div class="panel-heading"><div class="eyebrow">Graphic</div><h2>${esc(entry?.name || layer.kind)}</h2>
      <p>Drag on the spread to reposition, or swap the ornament below.</p></div>
      <label class="field">Ornament<select data-layer-field="kind">${Object.entries(GRAPHICS).map(([key, item]) =>
        `<option value="${key}" ${layer.kind === key ? "selected" : ""}>${esc(item.name)}</option>`).join("")}</select></label>
      <label class="field">Colour<input type="color" data-layer-field="color" value="${esc(layer.color || entry?.defaultColor || "#3a322d")}"></label>
      <div class="field-grid">${numberField("X · mm", "x", layer.box.x, 0, pageWidth * 2 - layer.box.w)}
        ${numberField("Y · mm", "y", layer.box.y, 0, pageHeight - layer.box.h)}
        ${numberField("Width · mm", "w", layer.box.w, 8, pageWidth * 2 - layer.box.x)}
        ${numberField("Height · mm", "h", layer.box.h, 6, pageHeight - layer.box.y)}</div>
      <button data-action="remove-layer">Remove graphic</button>`;
  }
  return `<div class="panel-heading"><div class="eyebrow">Words</div><h2>${esc(layer.role === "title" ? "Spread title" : layer.role === "kicker" ? "Date or chapter line" : layer.role === "callout" ? "Callout" : "Text note")}</h2></div>
    <label class="field">Wording<textarea id="wording">${esc(layer.text)}</textarea></label>
    <button class="primary wide-button" data-action="apply-text">Apply wording</button>
    <div class="field-grid">${numberField("Size · pt", "fontPt", layer.fontPt, 6, 144)}
      <label>Colour<input type="color" data-layer-field="color" value="${esc(layer.color)}"></label></div>
    <div class="field-grid">
      <label>Style<select data-layer-field="fontStyle"><option value="sans" ${(layer.fontStyle || "sans") === "sans" ? "selected" : ""}>Clean sans</option><option value="script" ${layer.fontStyle === "script" ? "selected" : ""}>Handwritten script</option></select></label>
      <label>Alignment<select data-layer-field="align"><option ${layer.align === "left" ? "selected" : ""}>left</option><option ${layer.align === "center" ? "selected" : ""}>center</option><option ${layer.align === "right" ? "selected" : ""}>right</option></select></label>
    </div>
    <div class="field-grid">${numberField("X · mm", "x", layer.box.x, 0, pageWidth * 2 - layer.box.w)}
      ${numberField("Y · mm", "y", layer.box.y, 0, pageHeight - layer.box.h)}
      ${numberField("Width · mm", "w", layer.box.w, 10, pageWidth * 2 - layer.box.x)}
      ${numberField("Height · mm", "h", layer.box.h, 8, pageHeight - layer.box.y)}</div>
    <button data-action="remove-layer">Remove text</button>`;
}

function stylePanel() {
  const decorMode = project.book.decor || "crafted";
  return `<div class="panel-heading"><div class="eyebrow">Whole book</div><h2>Paper, type &amp; decor</h2>
    <p>These settings also update the existing cover, opening and closing templates when you export.</p></div>
    <label class="field">Book title<input data-book-field="title" value="${esc(project.book.title)}"></label>
    <label class="field">Subtitle<input data-book-field="subtitle" value="${esc(project.book.subtitle)}"></label>
    <label class="field"><input type="checkbox" data-book-check="showHeadings" ${project.book.showHeadings !== false ? "checked" : ""}> Show spread headings</label>
    <div class="paper-row">${Object.entries(themes).map(([key, theme]) =>
      `<button class="paper ${project.book.theme === key ? "active" : ""}" data-action="theme" data-theme="${key}" title="${theme.name}"><span style="background:${theme.paper}"></span>${theme.name}</button>`).join("")}</div>
    <label class="field">Typeface<select data-book-field="font"><option ${project.book.font === "Montserrat" ? "selected" : ""}>Montserrat</option><option ${project.book.font === "Heebo" ? "selected" : ""}>Heebo</option></select></label>
    <label class="field">Album decor style<select data-action-select="book-decor">
      <option value="crafted" ${decorMode === "crafted" ? "selected" : ""}>Crafted washes &amp; subtle graphics</option>
      <option value="none" ${decorMode === "none" ? "selected" : ""}>Minimal clean paper only</option>
    </select></label>`;
}

function sidePanel() {
  if (ui.panel === "layouts") return layoutPanel();
  if (ui.panel === "photos") return photoLibrary();
  if (ui.panel === "decor") return decorPanel();
  if (ui.panel === "style") return stylePanel();
  return inspector();
}

function editor() {
  const spread = activeSpread();
  const canvas = currentCanvasSpread();
  const warnings = canvas.frames.filter((frame) => !frame.hidden).flatMap(frameWarnings);
  return `<main class="spread-editor">
    <div class="editor-toolbar"><button data-action="back">&larr; Storyboard</button>
      <div><strong>${esc(spread.title)}</strong><small>${esc(spread.chapterTitle)} · ${dirty ? "working copy" : `saved revision ${project.revision}`}</small></div>
      <button class="${ui.panel === "layouts" ? "active" : ""}" data-action="layouts">Layouts</button>
      <button class="${ui.panel === "photos" ? "active" : ""}" data-action="photos">Photos</button>
      <button class="${ui.panel === "decor" ? "active" : ""}" data-action="decor">Decor</button>
      <button data-action="add-text">+ Text</button>
      <button class="${ui.panel === "style" ? "active" : ""}" data-action="style">Book style</button>
      <button class="${ui.guides ? "active" : ""}" data-action="guides">Subject guides</button>
      <button class="${spread.reviewed ? "reviewed" : ""}" data-action="review">${spread.reviewed ? "Reviewed" : "Mark reviewed"}</button>
    </div>
    <div class="editor-body">
      <section class="canvas-column">
        <div class="canvas-wrap"><div id="spread-canvas">${spreadMarkup(canvas)}</div></div>
        <div class="canvas-note ${warnings.length ? "warning" : ""}">${ui.previewLayout ? "Preview only — apply it to change the project." :
          warnings.length ? esc([...new Set(warnings)].join(" ")) : "Drag objects to move them. Pull the bottom-right handle to resize."}</div>
      </section>
      <aside class="side-panel">${sidePanel()}</aside>
    </div>
  </main>`;
}

function render() {
  app.className = "";
  app.innerHTML = header() + (ui.view === "board" ? board() : editor()) +
    `<footer><span>${esc(data.projectFile)}</span><span>${dirty ? "Not saved" : `Revision ${project.revision}`}</span><span>Original photographs are read-only</span></footer>`;
  attachCanvas();
}

async function save() {
  if (!dirty || saving) return project;
  saving = true; render();
  try {
    const result = await api("/api/project", {
      method: "PUT",
      headers: { "If-Match": String(project.revision) },
      body: JSON.stringify(project),
    });
    project = result.project;
    dirty = false;
    history.length = 0;
    render();
    toast(`Saved revision ${project.revision}.`);
    return project;
  } catch (error) {
    toast(error.message, true);
    return null;
  } finally {
    saving = false;
    render();
  }
}

async function exportPdfs() {
  if (exporting) return;
  exporting = true; render();
  try {
    if (dirty && !await save()) return;
    const result = await api("/api/export", { method: "POST" });
    exportResult = result.export;
    render();
    toast("PDFs exported from the saved project.");
  } catch (error) {
    toast(error.message, true);
  } finally {
    exporting = false;
    render();
  }
}

function applyLayout() {
  const option = layoutOptions().find((candidate) => candidate.key === ui.previewLayout && candidate.available);
  if (!option) return;
  remember(() => {
    const spread = activeSpread();
    spread.frames = [...option.frames, ...spread.frames.filter((frame) => frame.hidden)];
    spread.wash = option.wash ? { ...option.wash } : (spread.wash || { left: "none", right: "none" });
    spread.graphics = structuredClone(option.graphics || []);
    spread.texts = [
      ...spread.texts.filter((text) => text.role !== "callout"),
      ...structuredClone(option.callouts || []),
    ];
    const title = spread.texts.find((text) => text.role === "title");
    const kicker = spread.texts.find((text) => text.role === "kicker");
    const defaultAlign = project.book.direction === "rtl" ? "right" : "left";
    if (title) {
      title.box = { ...option.titleBox };
      title.align = option.key === "center-note-grid" ? "center" : defaultAlign;
      title.fontPt = option.key === "center-note-grid" ? 12.5 : 17.9;
      title.weight = option.key === "center-note-grid" ? 500 : 700;
    }
    if (kicker) {
      kicker.box = { ...option.kickerBox };
      kicker.align = option.key === "center-note-grid" ? "center" : defaultAlign;
    }
    spread.layout = option.key;
    ui.previewLayout = null;
    ui.selected = null;
    ui.panel = "inspect";
  });
  toast(`${option.name} applied. Save when it feels right.`);
}

function moveSpread(id, delta) {
  const from = project.order.indexOf(id), to = from + delta;
  if (from < 0 || to < 0 || to >= project.order.length) return;
  remember(() => {
    const [spread] = project.order.splice(from, 1);
    project.order.splice(to, 0, spread);
  }, { invalidateReview: false });
}

function mutateLayer(field, value) {
  const layer = selectedLayer();
  if (!layer) return;
  const g = geometry();
  if (["x", "y", "w", "h", "focusX", "focusY", "zoom", "fontPt"].includes(field)) {
    value = Number(value);
    if (!Number.isFinite(value)) return toast("Enter a valid number.", true);
    if (field === "x") value = Math.max(0, Math.min(g.pageWidth * 2 - layer.box.w, value));
    if (field === "y") value = Math.max(0, Math.min(g.pageHeight - layer.box.h, value));
    if (field === "w") value = Math.max(10, Math.min(g.pageWidth * 2 - layer.box.x, value));
    if (field === "h") value = Math.max(8, Math.min(g.pageHeight - layer.box.y, value));
    if (field === "focusX" || field === "focusY") value = Math.max(0, Math.min(100, value));
    if (field === "zoom") value = Math.max(1, Math.min(3, value));
    if (field === "fontPt") value = Math.max(6, Math.min(144, value));
  }
  remember(() => {
    if (["x", "y", "w", "h"].includes(field)) layer.box[field] = value;
    else if (["focusX", "focusY", "zoom", "fontPt"].includes(field)) layer[field] = value;
    else layer[field] = value;
  });
}

function action(name, element) {
  if (name === "save") return void save();
  if (name === "export") return void exportPdfs();
  if (name === "undo") return undo();
  if (name === "back") { ui.view = "board"; ui.selected = null; ui.previewLayout = null; return render(); }
  if (name === "open-spread") {
    ui.active = element.dataset.id; ui.view = "editor"; ui.panel = "inspect"; ui.selected = null; ui.previewLayout = null; return render();
  }
  if (name === "layouts") { ui.panel = "layouts"; ui.previewLayout = null; return render(); }
  if (name === "photos") { ui.panel = "photos"; return render(); }
  if (name === "decor") { ui.panel = "decor"; return render(); }
  if (name === "style") {
    if (ui.view === "board") { ui.view = "editor"; ui.active = project.order[0]; }
    ui.panel = "style"; ui.selected = null; return render();
  }
  if (name === "add-graphic") {
    const kind = element.dataset.graphic;
    const entry = GRAPHICS[kind];
    if (!entry) return;
    return remember(() => {
      const spread = activeSpread(), g = geometry();
      spread.graphics = spread.graphics || [];
      const id = `${spread.id}-graphic-${crypto.randomUUID().slice(0, 8)}`;
      const w = entry.defaultSize.w, h = entry.defaultSize.h;
      spread.graphics.push({
        id,
        kind,
        box: {
          x: Math.round(g.pageWidth + (g.pageWidth - w) / 2),
          y: Math.round(g.pageHeight - g.bleed - g.margin - h - 18),
          w,
          h,
        },
        color: entry.defaultColor,
        hidden: false,
      });
      ui.selected = id;
      ui.panel = "inspect";
    });
  }
  if (name === "add-callout") {
    const preset = CALLOUT_PRESETS.find((item) => item.key === element.dataset.callout);
    if (!preset) return;
    return remember(() => {
      const spread = activeSpread(), g = geometry();
      spread.graphics = spread.graphics || [];
      const textId = `${spread.id}-callout-${crypto.randomUUID().slice(0, 8)}`;
      const graphicId = `${spread.id}-graphic-${crypto.randomUUID().slice(0, 8)}`;
      const tw = 64, th = 16;
      const tx = Math.round(g.pageWidth + (g.pageWidth - tw) / 2);
      const ty = Math.round(g.pageHeight - g.bleed - g.margin - 44);
      spread.texts.push({
        id: textId,
        role: "callout",
        fontStyle: preset.fontStyle || "script",
        text: preset.text,
        box: { x: tx, y: ty, w: tw, h: th },
        fontPt: preset.fontStyle === "script" ? 14 : 12,
        weight: preset.fontStyle === "script" ? 400 : 500,
        color: currentTheme().ink,
        align: "center",
        hidden: false,
      });
      if (preset.graphic && GRAPHICS[preset.graphic]) {
        const entry = GRAPHICS[preset.graphic];
        const gw = entry.defaultSize.w, gh = entry.defaultSize.h;
        spread.graphics.push({
          id: graphicId,
          kind: preset.graphic,
          box: {
            x: Math.round(tx + (tw - gw) / 2),
            y: Math.round(ty + th + 2),
            w: gw,
            h: gh,
          },
          color: entry.defaultColor,
          hidden: false,
        });
      }
      ui.selected = textId;
      ui.panel = "inspect";
    });
  }
  if (name === "guides") { ui.guides = !ui.guides; return render(); }
  if (name === "preview-layout") { ui.previewLayout = element.dataset.layout; return render(); }
  if (name === "cancel-preview") { ui.previewLayout = null; return render(); }
  if (name === "apply-layout") return applyLayout();
  if (name === "move") return moveSpread(element.dataset.id, Number(element.dataset.delta));
  if (name === "review") return remember(() => { activeSpread().reviewed = !activeSpread().reviewed; }, { invalidateReview: false });
  if (name === "photo-filter") { ui.libraryFilter = element.dataset.filter; return render(); }
  if (name === "replace-photo") {
    const layer = selectedLayer();
    if (!isFrame(layer)) return toast("Select a photo frame first.", true);
    return remember(() => {
      layer.photo = element.dataset.photo;
      layer.fit = "safe"; layer.focusX = 50; layer.focusY = 50; layer.zoom = 1;
      ui.panel = "inspect";
    });
  }
  if (name === "apply-text") {
    const layer = selectedLayer(), value = document.querySelector("#wording")?.value;
    if (!layer || isFrame(layer)) return;
    return remember(() => {
      layer.text = value;
      const spread = activeSpread();
      if (layer.role === "title") spread.title = value;
      if (layer.role === "kicker") spread.kicker = value;
    });
  }
  if (name === "add-text") {
    return remember(() => {
      const spread = activeSpread(), g = geometry();
      const id = `${spread.id}-text-${crypto.randomUUID()}`;
      spread.texts.push({
        id, role: "note", text: "A memory worth keeping",
        box: { x: g.pageWidth + g.binding + 18, y: g.pageHeight - 40, w: g.pageWidth - 60, h: 18 },
        fontPt: 11, weight: 500, color: currentTheme().ink, align: "left", hidden: false,
      });
      ui.selected = id; ui.panel = "inspect";
    });
  }
  if (name === "remove-layer") {
    const layer = selectedLayer();
    if (!layer) return;
    if (isFrame(layer) && activeSpread().frames.filter((frame) => !frame.hidden).length <= 1) {
      return toast("A spread needs at least one photograph.", true);
    }
    return remember(() => { layer.hidden = true; ui.selected = null; });
  }
  if (name === "theme") return remember(() => {
    const previous = currentTheme();
    project.book.theme = element.dataset.theme;
    const next = currentTheme();
    for (const id of project.order) {
      for (const text of project.spreads[id].texts) {
        if (text.role === "title" || text.color.toLowerCase() === previous.ink.toLowerCase()) text.color = next.ink;
        else if (text.role === "kicker" || text.color.toLowerCase() === previous.muted.toLowerCase()) text.color = next.muted;
      }
    }
  }, { invalidateReview: "all" });
}

app.addEventListener("click", (event) => {
  const element = event.target.closest("[data-action]");
  if (element) action(element.dataset.action, element);
});

app.addEventListener("change", (event) => {
  const element = event.target;
  if (element.dataset.layerCheck) {
    const layer = selectedLayer();
    if (!layer) return;
    return remember(() => { layer[element.dataset.layerCheck] = element.checked; });
  }
  if (element.dataset.washSide) {
    const side = element.dataset.washSide;
    const value = element.value;
    return remember(() => {
      const spread = activeSpread();
      spread.wash = spread.wash || { left: "none", right: "none" };
      spread.wash[side] = value;
      const g = geometry();
      for (const frame of spread.frames) {
        const onLeft = frame.box.x + frame.box.w / 2 < g.pageWidth;
        if ((side === "left" && onLeft) || (side === "right" && !onLeft)) {
          frame.mat = value !== "none";
        }
      }
    });
  }
  if (element.dataset.bookCheck === "showHeadings") {
    return remember(() => {
      project.book.showHeadings = element.checked;
      for (const id of project.order) {
        for (const text of project.spreads[id].texts) {
          if (text.role === "title" || text.role === "kicker") text.hidden = !element.checked;
        }
      }
    });
  }
  if (element.dataset.actionSelect === "book-decor") {
    const mode = element.value;
    return remember(() => {
      project.book.decor = mode;
      const spec = geometry();
      project.order.forEach((id, index) => {
        const spread = project.spreads[id];
        const decorated = buildSpreadDecor({
          sceneId: id,
          index,
          recipe: spread.layout,
          frames: spread.frames.map(({ mat, ...rest }) => rest),
          texts: spread.texts.filter((t) => t.role !== "callout"),
          spec,
          direction: project.book.direction,
          decor: mode,
          callouts: project.book.callouts === true,
        });
        spread.wash = decorated.wash;
        spread.frames = decorated.frames;
        spread.texts = decorated.texts;
        spread.graphics = decorated.graphics;
      });
    }, { invalidateReview: "all" });
  }
  if (element.dataset.layerField) return mutateLayer(element.dataset.layerField, element.value);
  if (element.dataset.bookField) {
    const field = element.dataset.bookField;
    return remember(() => { project.book[field] = element.value; }, { invalidateReview: "all" });
  }
});

app.addEventListener("input", (event) => {
  if (event.target.matches("[data-search]")) {
    ui.query = event.target.value;
    const caret = event.target.selectionStart;
    render();
    const input = document.querySelector("[data-search]");
    input.focus(); input.setSelectionRange(caret, caret);
  }
});

app.addEventListener("dragstart", (event) => {
  const card = event.target.closest("[data-spread]");
  if (!card) return;
  ui.draggedSpread = card.dataset.spread;
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", ui.draggedSpread);
  card.classList.add("dragging");
});
app.addEventListener("dragover", (event) => {
  const card = event.target.closest("[data-spread]");
  if (!card || !ui.draggedSpread) return;
  event.preventDefault();
  card.classList.add("dragover");
});
app.addEventListener("dragleave", (event) => event.target.closest("[data-spread]")?.classList.remove("dragover"));
app.addEventListener("drop", (event) => {
  const card = event.target.closest("[data-spread]");
  if (!card || !ui.draggedSpread) return;
  event.preventDefault();
  const moving = ui.draggedSpread, target = card.dataset.spread;
  ui.draggedSpread = null;
  document.querySelectorAll(".dragging,.dragover").forEach((item) => item.classList.remove("dragging", "dragover"));
  if (moving === target) return;
  remember(() => {
    const from = project.order.indexOf(moving), to = project.order.indexOf(target);
    project.order.splice(from, 1);
    project.order.splice(to, 0, moving);
  }, { invalidateReview: false });
});
app.addEventListener("dragend", () => {
  ui.draggedSpread = null;
  document.querySelectorAll(".dragging,.dragover").forEach((item) => item.classList.remove("dragging", "dragover"));
});

function attachCanvas() {
  const canvas = document.querySelector("#spread-canvas");
  if (!canvas || ui.previewLayout) return;
  canvas.addEventListener("pointerdown", (event) => {
    const element = event.target.closest("[data-layer]");
    if (!element) { ui.selected = null; render(); return; }
    event.preventDefault();
    const layer = activeSpread().frames.find((frame) => frame.id === element.dataset.layer) ||
      activeSpread().texts.find((text) => text.id === element.dataset.layer) ||
      (activeSpread().graphics || []).find((graphic) => graphic.id === element.dataset.layer);
    ui.selected = layer.id;
    const rect = canvas.getBoundingClientRect();
    pointer = {
      element,
      layer,
      before: structuredClone(project),
      box: { ...layer.box },
      x: event.clientX,
      y: event.clientY,
      scaleX: geometry().pageWidth * 2 / rect.width,
      scaleY: geometry().pageHeight / rect.height,
      resize: event.target.classList.contains("resize-handle"),
      moved: false,
    };
    element.setPointerCapture(event.pointerId);
    element.classList.add("selected");
  });
}

window.addEventListener("pointermove", (event) => {
  if (!pointer) return;
  const dx = (event.clientX - pointer.x) * pointer.scaleX;
  const dy = (event.clientY - pointer.y) * pointer.scaleY;
  if (Math.abs(dx) + Math.abs(dy) < 0.5) return;
  pointer.moved = true;
  const g = geometry(), box = pointer.layer.box;
  if (pointer.resize) {
    box.w = Math.max(10, Math.min(g.pageWidth * 2 - box.x, Math.round(pointer.box.w + dx)));
    box.h = Math.max(8, Math.min(g.pageHeight - box.y, Math.round(pointer.box.h + dy)));
  } else {
    box.x = Math.max(0, Math.min(g.pageWidth * 2 - box.w, Math.round(pointer.box.x + dx)));
    box.y = Math.max(0, Math.min(g.pageHeight - box.h, Math.round(pointer.box.y + dy)));
  }
  pointer.element.style.left = pct(box.x, g.pageWidth * 2);
  pointer.element.style.top = pct(box.y, g.pageHeight);
  pointer.element.style.width = pct(box.w, g.pageWidth * 2);
  pointer.element.style.height = pct(box.h, g.pageHeight);
});

window.addEventListener("pointerup", () => {
  if (!pointer) return;
  const completed = pointer;
  pointer = null;
  if (completed.moved) {
    history.push(completed.before);
    dirty = true;
    activeSpread().reviewed = false;
  }
  render();
});

document.addEventListener("keydown", (event) => {
  const editing = event.target.matches("input,textarea,select") || event.target.isContentEditable;
  if (!editing && (event.key === "Enter" || event.key === " ") && event.target.matches("[data-layer]")) {
    event.preventDefault();
    ui.selected = event.target.dataset.layer;
    ui.panel = "inspect";
    render();
    return;
  }
  if (!editing && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
    event.preventDefault(); undo();
  }
  if (!editing && event.key === "Escape" && ui.view === "editor") {
    if (ui.previewLayout) ui.previewLayout = null;
    else { ui.view = "board"; ui.selected = null; }
    render();
  }
});

window.addEventListener("beforeunload", (event) => {
  if (!dirty) return;
  event.preventDefault();
  event.returnValue = "";
});

window.keepsakeEditor = Object.freeze({
  getProject: () => structuredClone(project),
  isDirty: () => dirty,
  currentSpread: () => ui.active,
  exportRevision: () => exportResult?.revision ?? null,
});
render();
