// Shared watercolor washes, subtle vector graphics, badges and callout presets
// for Keepsake's crafted album design and local Storyboard editor.

export const DECOR_MODES = ["crafted", "none"];

export const WASHES = {
  none: {
    name: "Clean paper",
    tint: null,
    deep: null,
    soft: null,
  },
  sky: {
    name: "Powder blue wash",
    tint: "#cfe1ec",
    deep: "#9dc0d6",
    soft: "#eaf2f7",
  },
  rose: {
    name: "Dusty rose wash",
    tint: "#e6cdd2",
    deep: "#c99da7",
    soft: "#f6eaed",
  },
  sand: {
    name: "Warm sand wash",
    tint: "#ece0d0",
    deep: "#cfb89b",
    soft: "#f8f3eb",
  },
  sage: {
    name: "Soft sage wash",
    tint: "#d6e3d8",
    deep: "#a3bca7",
    soft: "#eef4ef",
  },
  lavender: {
    name: "Soft lilac wash",
    tint: "#dfd7e8",
    deep: "#b3a3c7",
    soft: "#f2eff7",
  },
};

export function washSvgMarkup(washKey, side = "left") {
  const wash = WASHES[washKey];
  if (!wash || !wash.tint) return "";
  const flip = side === "right" ? ' transform="scale(-1,1) translate(-300,0)"' : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300" preserveAspectRatio="none">
    <defs>
      <linearGradient id="wg-${washKey}-${side}" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${wash.tint}" stop-opacity="0.72"/>
        <stop offset="55%" stop-color="${wash.soft}" stop-opacity="0.88"/>
        <stop offset="100%" stop-color="${wash.deep}" stop-opacity="0.48"/>
      </linearGradient>
      <radialGradient id="wr1-${washKey}-${side}" cx="28%" cy="24%" r="62%">
        <stop offset="0%" stop-color="${wash.deep}" stop-opacity="0.34"/>
        <stop offset="70%" stop-color="${wash.tint}" stop-opacity="0.12"/>
        <stop offset="100%" stop-color="${wash.soft}" stop-opacity="0"/>
      </radialGradient>
      <radialGradient id="wr2-${washKey}-${side}" cx="78%" cy="76%" r="58%">
        <stop offset="0%" stop-color="${wash.deep}" stop-opacity="0.28"/>
        <stop offset="65%" stop-color="${wash.tint}" stop-opacity="0.1"/>
        <stop offset="100%" stop-color="${wash.soft}" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <g${flip}>
      <path d="M0,0 L294,0 C298,38 292,76 296,118 C299,162 291,208 296,254 C298,274 294,290 290,300 L0,300 Z" fill="url(#wg-${washKey}-${side})"/>
      <ellipse cx="88" cy="74" rx="145" ry="110" fill="url(#wr1-${washKey}-${side})"/>
      <ellipse cx="222" cy="226" rx="135" ry="105" fill="url(#wr2-${washKey}-${side})"/>
      <path d="M12,18 C72,10 148,14 276,12 C282,66 278,136 282,282 C192,288 88,284 14,286 C8,210 14,96 12,18 Z" fill="none" stroke="#ffffff" stroke-opacity="0.38" stroke-width="1.2"/>
    </g>
  </svg>`;
}

export function washDataUri(washKey, side = "left") {
  const svg = washSvgMarkup(washKey, side);
  if (!svg) return "";
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg.replace(/\s+/g, " ").trim())}`;
}

export const GRAPHICS = {
  "flourish-scroll": {
    name: "Scroll flourish",
    category: "flourish",
    defaultSize: { w: 46, h: 11 },
    defaultColor: "#3a322d",
    svg: (color = "#3a322d") => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 48" fill="none">
      <path d="M12 24 C34 24, 48 11, 68 13 C82 14, 92 26, 100 26 C108 26, 118 14, 132 13 C152 11, 166 24, 188 24" stroke="${color}" stroke-width="1.7" stroke-linecap="round"/>
      <path d="M62 24 C74 33, 89 35, 100 21 C111 35, 126 33, 138 24" stroke="${color}" stroke-width="1.4" stroke-linecap="round"/>
      <circle cx="12" cy="24" r="2.2" fill="${color}"/>
      <circle cx="188" cy="24" r="2.2" fill="${color}"/>
      <circle cx="100" cy="14" r="2" fill="${color}"/>
    </svg>`,
  },
  "flourish-heart": {
    name: "Heart line flourish",
    category: "flourish",
    defaultSize: { w: 56, h: 12 },
    defaultColor: "#2f2926",
    svg: (color = "#2f2926") => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 50" fill="none">
      <path d="M14 28 C10 21, 19 17, 23 23 C27 29, 58 28, 98 28" stroke="${color}" stroke-width="1.6" stroke-linecap="round"/>
      <path d="M226 28 C230 21, 221 17, 217 23 C213 29, 182 28, 142 28" stroke="${color}" stroke-width="1.6" stroke-linecap="round"/>
      <path d="M120 34 C111 26, 104 19, 108 13 C112 8, 118 11, 120 16 C122 11, 128 8, 132 13 C136 19, 129 26, 120 34 Z" stroke="${color}" stroke-width="1.6" fill="none" stroke-linejoin="round"/>
      <path d="M96 28 C104 28, 109 24, 113 21 M144 28 C136 28, 131 24, 127 21" stroke="${color}" stroke-width="1.4" stroke-linecap="round"/>
    </svg>`,
  },
  "boho-arrow": {
    name: "Feathered arrow",
    category: "motif",
    defaultSize: { w: 48, h: 13 },
    defaultColor: "#4a3531",
    svg: (color = "#4a3531") => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220 56" fill="none">
      <line x1="28" y1="28" x2="188" y2="28" stroke="${color}" stroke-width="2" stroke-linecap="round"/>
      <path d="M18 28 L42 19 L36 28 L42 37 Z" fill="${color}"/>
      <path d="M164 18 L180 28 L164 38 M174 18 L190 28 L174 38 M184 18 L200 28 L184 38" stroke="${color}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M106 18 C101 12, 95 16, 103 28 C95 40, 101 44, 106 38" stroke="${color}" stroke-width="1.6" stroke-linecap="round"/>
      <path d="M106 28 C112 36, 117 41, 122 44 M102 28 C98 37, 94 42, 90 45" stroke="${color}" stroke-width="1.4" stroke-linecap="round"/>
      <circle cx="105" cy="28" r="2.6" fill="#c97a63"/>
    </svg>`,
  },
  "botanical-flower": {
    name: "Watercolor blossom",
    category: "motif",
    defaultSize: { w: 44, h: 20 },
    defaultColor: "#6d3b5e",
    svg: (color = "#6d3b5e") => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 92" fill="none">
      <g opacity="0.88">
        <path d="M86 46 C58 34, 38 38, 22 48 C40 56, 62 56, 86 46 Z" fill="#6f8c69" fill-opacity="0.55"/>
        <path d="M114 46 C142 34, 162 38, 178 48 C160 56, 138 56, 114 46 Z" fill="#6f8c69" fill-opacity="0.55"/>
        <path d="M84 42 C66 24, 48 22, 34 28 C46 39, 64 44, 84 42 Z" fill="#8aa382" fill-opacity="0.65"/>
        <path d="M116 42 C134 24, 152 22, 166 28 C154 39, 136 44, 116 42 Z" fill="#8aa382" fill-opacity="0.65"/>
        <path d="M86 52 C68 64, 50 68, 38 62 C48 53, 66 50, 86 52 Z" fill="#587354" fill-opacity="0.5"/>
        <path d="M114 52 C132 64, 150 68, 162 62 C152 53, 134 50, 114 52 Z" fill="#587354" fill-opacity="0.5"/>
      </g>
      <g>
        <circle cx="100" cy="30" r="14" fill="${color}" fill-opacity="0.72"/>
        <circle cx="115" cy="41" r="14" fill="${color}" fill-opacity="0.65"/>
        <circle cx="109" cy="58" r="14" fill="${color}" fill-opacity="0.74"/>
        <circle cx="91" cy="58" r="14" fill="${color}" fill-opacity="0.68"/>
        <circle cx="85" cy="41" r="14" fill="${color}" fill-opacity="0.72"/>
        <circle cx="100" cy="45" r="7" fill="#f3d68b"/>
        <circle cx="100" cy="45" r="3.5" fill="#47233b"/>
      </g>
    </svg>`,
  },
  "lavender-sprig": {
    name: "Botanical sprig",
    category: "motif",
    defaultSize: { w: 46, h: 15 },
    defaultColor: "#7a6888",
    svg: (color = "#7a6888") => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 210 68" fill="none">
      <path d="M24 42 C72 52, 138 52, 186 42" stroke="#6d7f68" stroke-width="1.7" stroke-linecap="round"/>
      <ellipse cx="56" cy="37" rx="9" ry="4.5" transform="rotate(-22 56 37)" fill="#85967e" fill-opacity="0.75"/>
      <ellipse cx="154" cy="37" rx="9" ry="4.5" transform="rotate(22 154 37)" fill="#85967e" fill-opacity="0.75"/>
      <ellipse cx="78" cy="49" rx="8" ry="4" transform="rotate(18 78 49)" fill="#6d7f68" fill-opacity="0.7"/>
      <ellipse cx="132" cy="49" rx="8" ry="4" transform="rotate(-18 132 49)" fill="#6d7f68" fill-opacity="0.7"/>
      <circle cx="105" cy="40" r="10" fill="${color}" fill-opacity="0.76"/>
      <circle cx="92" cy="43" r="7.5" fill="${color}" fill-opacity="0.58"/>
      <circle cx="118" cy="43" r="7.5" fill="${color}" fill-opacity="0.58"/>
      <circle cx="105" cy="40" r="3.2" fill="#efe2b2"/>
    </svg>`,
  },
  "badge-love-circle": {
    name: "Love circle badge",
    category: "badge",
    defaultSize: { w: 34, h: 34 },
    defaultColor: "#2b2523",
    svg: (color = "#2b2523") => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" fill="none">
      <circle cx="60" cy="60" r="56" fill="#ffffff" fill-opacity="0.94"/>
      <circle cx="60" cy="60" r="51" stroke="${color}" stroke-width="1.5"/>
      <circle cx="60" cy="60" r="47" stroke="${color}" stroke-width="0.8" stroke-dasharray="2 2"/>
      <text x="60" y="64" text-anchor="middle" font-family="'Segoe Script','Brush Script MT','Snell Roundhand','Apple Chancery',cursive" font-size="31" font-style="italic" fill="${color}">love</text>
      <path d="M36 77 C48 83, 72 83, 84 77" stroke="${color}" stroke-width="1.3" stroke-linecap="round"/>
      <path d="M60 83 C56 79, 54 76, 56 74 C58 72, 60 74, 60 76 C60 74, 62 72, 64 74 C66 76, 64 79, 60 83 Z" fill="${color}"/>
    </svg>`,
  },
  "badge-love-frame": {
    name: "Love stamp frame",
    category: "badge",
    defaultSize: { w: 38, h: 38 },
    defaultColor: "#2b2523",
    svg: (color = "#2b2523") => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 130 130" fill="none">
      <rect x="18" y="18" width="94" height="94" rx="14" fill="#ffffff" fill-opacity="0.86" stroke="${color}" stroke-width="1.5"/>
      <rect x="24" y="24" width="82" height="82" rx="10" stroke="${color}" stroke-width="0.9"/>
      <path d="M46 18 C54 8, 76 8, 84 18 M46 112 C54 122, 76 122, 84 112 M18 46 C8 54, 8 76, 18 84 M112 46 C122 54, 122 76, 112 84" stroke="${color}" stroke-width="1.4" stroke-linecap="round"/>
      <text x="65" y="72" text-anchor="middle" font-family="'Segoe Script','Brush Script MT','Snell Roundhand','Apple Chancery',cursive" font-size="33" font-style="italic" fill="${color}">love</text>
    </svg>`,
  },
  "badge-heart": {
    name: "Heart sticker badge",
    category: "badge",
    defaultSize: { w: 28, h: 28 },
    defaultColor: "#b85c5c",
    svg: (color = "#b85c5c") => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none">
      <circle cx="50" cy="50" r="45" fill="#ffffff" fill-opacity="0.94" stroke="#3a322d" stroke-width="1.3"/>
      <path d="M50 70 C34 56, 26 45, 31 35 C35 28, 45 30, 50 38 C55 30, 65 28, 69 35 C74 45, 66 56, 50 70 Z" fill="${color}" fill-opacity="0.85" stroke="#3a322d" stroke-width="1.4" stroke-linejoin="round"/>
    </svg>`,
  },
  "compass-star": {
    name: "Compass star",
    category: "motif",
    defaultSize: { w: 26, h: 26 },
    defaultColor: "#3d4a54",
    svg: (color = "#3d4a54") => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none">
      <path d="M50 10 L57 43 L90 50 L57 57 L50 90 L43 57 L10 50 L43 43 Z" stroke="${color}" stroke-width="1.6" fill="${color}" fill-opacity="0.14" stroke-linejoin="round"/>
      <circle cx="50" cy="50" r="18" stroke="${color}" stroke-width="1.1" stroke-dasharray="2 3"/>
      <circle cx="50" cy="50" r="3" fill="${color}"/>
    </svg>`,
  },
};

export const CALLOUT_PRESETS = [
  { key: "happy-flower", label: "Happy + blossom", text: "Happy", fontStyle: "script", graphic: "botanical-flower" },
  { key: "relax-sprig", label: "Relax + sprig", text: "Relax", fontStyle: "script", graphic: "lavender-sprig" },
  { key: "moments-arrow", label: "Moments + arrow", text: "Moments", fontStyle: "script", graphic: "boho-arrow" },
  { key: "he-love-arrow", label: "רגעים של אהבה + חץ", text: "רגעים של אהבה", fontStyle: "script", graphic: "boho-arrow" },
  { key: "he-memories", label: "זכרונות מרגשים + עיטור", text: "זכרונות מרגשים", fontStyle: "script", graphic: "flourish-scroll" },
  { key: "he-together", label: "נהנים ומבלים ביחד", text: "נהנים ומבלים ביחד", fontStyle: "sans", graphic: "flourish-scroll" },
  { key: "he-joy", label: "כמה אושר!", text: "כמה אושר!", fontStyle: "sans", graphic: "flourish-scroll" },
  { key: "he-pause", label: "לקחת פסק זמן + חץ", text: '"לקחת פסק זמן ולא לחשוב"', fontStyle: "script", graphic: "boho-arrow" },
];

export function graphicSvgMarkup(graphic) {
  const entry = GRAPHICS[graphic?.kind];
  if (!entry) return "";
  return entry.svg(graphic.color || entry.defaultColor);
}

const WASH_CYCLE = ["sky", "rose", "sand", "sage", "lavender"];

const overlaps = (a, b, pad = 2) =>
  a.x < b.x + b.w + pad &&
  a.x + a.w + pad > b.x &&
  a.y < b.y + b.h + pad &&
  a.y + a.h + pad > b.y;

// Clamp a box so it always stays strictly inside the two-page spread.
function clampBox(rect, spec) {
  const maxW = spec.pageWidth * 2, maxH = spec.pageHeight;
  const w = Math.max(8, Math.min(maxW - 4, +rect.w.toFixed(2)));
  const h = Math.max(6, Math.min(maxH - 4, +rect.h.toFixed(2)));
  const x = Math.max(2, Math.min(maxW - w - 2, +rect.x.toFixed(2)));
  const y = Math.max(2, Math.min(maxH - h - 2, +rect.y.toFixed(2)));
  return { x, y, w, h };
}

// Find a calm open rectangle on either page of the spread where a small motif
// or short script callout can breathe without touching any photo or text box.
function findCalmPocket(frames, texts, spec) {
  const { pageWidth: W, pageHeight: H, bleed: B, margin: M, binding: IE } = spec;
  const contentW = W - 2 * B - M - IE;
  const contentH = H - 2 * B - 2 * M;
  const occupied = [
    ...frames.filter((f) => !f.hidden).map((f) => f.box),
    ...texts.filter((t) => !t.hidden).map((t) => t.box),
  ];
  const pocketH = Math.min(38, Math.max(24, contentH * 0.13));
  const candidates = [
    // Below a framed or upper photo on the right or left page
    { x: W + B + IE + contentW * 0.12, y: H - B - M - pocketH, w: contentW * 0.76, h: pocketH, side: "right" },
    { x: B + M + contentW * 0.12, y: H - B - M - pocketH, w: contentW * 0.76, h: pocketH, side: "left" },
    // Lower-right or lower-left quadrant (e.g., beside a tall portrait photo in overlap-story)
    { x: B + M + contentW * 0.57, y: B + M + contentH * 0.55, w: contentW * 0.41, h: Math.max(32, contentH * 0.34), side: "left" },
    { x: W + B + IE + contentW * 0.57, y: B + M + contentH * 0.55, w: contentW * 0.41, h: Math.max(32, contentH * 0.34), side: "right" },
    { x: B + M + contentW * 0.02, y: B + M + contentH * 0.55, w: contentW * 0.41, h: Math.max(32, contentH * 0.34), side: "left" },
    { x: W + B + IE + contentW * 0.02, y: B + M + contentH * 0.55, w: contentW * 0.41, h: Math.max(32, contentH * 0.34), side: "right" },
  ];
  for (const cand of candidates) {
    if (cand.x < B || cand.y < B || cand.x + cand.w > 2 * W - B || cand.y + cand.h > H - B) continue;
    if (occupied.every((box) => !overlaps(cand, box, 3))) return cand;
  }
  return null;
}

// Find a vertical or horizontal seam between two neighbouring photos on the same page for a sticker badge.
function findPhotoSeam(frames, spec) {
  const visible = frames.filter((f) => !f.hidden);
  for (let i = 0; i < visible.length; i++) {
    for (let j = i + 1; j < visible.length; j++) {
      const a = visible[i].box, b = visible[j].box;
      const samePage = (a.x + a.w <= spec.pageWidth + 1 && b.x + b.w <= spec.pageWidth + 1) ||
        (a.x >= spec.pageWidth - 1 && b.x >= spec.pageWidth - 1);
      if (!samePage) continue;
      // Vertical seam between side-by-side photos
      const [left, right] = a.x <= b.x ? [a, b] : [b, a];
      const gapX = right.x - (left.x + left.w);
      const yTop = Math.max(left.y, right.y), yBot = Math.min(left.y + left.h, right.y + right.h);
      if (gapX >= -2 && gapX <= 14 && yBot - yTop >= 42) {
        const size = Math.min(32, Math.max(22, (yBot - yTop) * 0.28));
        const cx = left.x + left.w + gapX / 2;
        const cy = yTop + (yBot - yTop) * 0.66;
        return { x: +(cx - size / 2).toFixed(2), y: +(cy - size / 2).toFixed(2), w: +size.toFixed(2), h: +size.toFixed(2) };
      }
      // Horizontal seam between stacked photos
      const [top, bot] = a.y <= b.y ? [a, b] : [b, a];
      const gapY = bot.y - (top.y + top.h);
      const xLeft = Math.max(top.x, bot.x), xRight = Math.min(top.x + top.w, bot.x + bot.w);
      if (gapY >= -2 && gapY <= 14 && xRight - xLeft >= 55) {
        const size = Math.min(30, Math.max(22, (xRight - xLeft) * 0.24));
        const cx = xLeft + (xRight - xLeft) * 0.72;
        const cy = top.y + top.h + gapY / 2;
        return { x: +(cx - size / 2).toFixed(2), y: +(cy - size / 2).toFixed(2), w: +size.toFixed(2), h: +size.toFixed(2) };
      }
    }
  }
  return null;
}

export function buildSpreadDecor({
  sceneId,
  index = 0,
  recipe = "",
  frames = [],
  texts = [],
  spec,
  direction = "ltr",
  decor = "crafted",
  callouts = false,
}) {
  if (decor === "none") {
    return {
      wash: { left: "none", right: "none" },
      frames: frames.map((f) => ({ ...f, mat: !!f.mat })),
      texts,
      graphics: [],
    };
  }
  const W = spec.pageWidth, H = spec.pageHeight;
  const isBleed = (f) => f.box.w >= W - 2 && f.box.h >= H - 2;
  const visible = frames.filter((f) => !f.hidden);
  const leftFrames = visible.filter((f) => f.box.x + f.box.w / 2 < W);
  const rightFrames = visible.filter((f) => f.box.x + f.box.w / 2 >= W);
  const leftBleed = leftFrames.some(isBleed);
  const rightBleed = rightFrames.some(isBleed);
  const leftCount = leftFrames.length;
  const rightCount = rightFrames.length;

  const washKey = WASH_CYCLE[index % WASH_CYCLE.length];
  let wash = { left: "none", right: "none" };
  if (leftBleed && !rightBleed) {
    wash = { left: "none", right: washKey };
  } else if (rightBleed && !leftBleed) {
    wash = { left: washKey, right: "none" };
  } else if (recipe === "framed-haven") {
    const framedRight = rightCount === 1;
    wash = framedRight ? { left: "none", right: washKey } : { left: washKey, right: "none" };
  } else if (index % 2 === 0) {
    wash = { left: washKey, right: "none" };
  } else {
    wash = { left: "none", right: washKey };
  }

  // Non-bleed frames sitting on a washed page or marked as inset get a crisp white mat border.
  const decoratedFrames = frames.map((frame, frameIdx) => {
    if (isBleed(frame)) return { ...frame, mat: false };
    const onLeft = frame.box.x + frame.box.w / 2 < W;
    const onWashedSide = (onLeft && wash.left !== "none") || (!onLeft && wash.right !== "none");
    const isInset = recipe === "overlap-story" && frameIdx === frames.length - 1;
    return {
      ...frame,
      mat: frame.mat !== undefined ? !!frame.mat : (onWashedSide || isInset),
    };
  });

  const graphics = [];
  const nextTexts = [...texts.map((t) => ({ ...t }))];
  const gid = (n) => `${sceneId}-graphic-${String(n).padStart(2, "0")}`;

  if (recipe === "framed-haven") {
    // Flourish above and below the solo framed portrait (like 190621 in the reference album).
    const solo = decoratedFrames.find((f) => {
      const onLeft = f.box.x + f.box.w / 2 < W;
      return (onLeft && leftCount === 1) || (!onLeft && rightCount === 1);
    }) || decoratedFrames[0];
    if (solo) {
      const fw = Math.min(58, solo.box.w * 0.42), fh = 12;
      const fx = +(solo.box.x + (solo.box.w - fw) / 2).toFixed(2);
      if (solo.box.y >= 24) {
        graphics.push({
          id: gid(graphics.length + 1),
          kind: "flourish-heart",
          box: { x: fx, y: +(solo.box.y - fh - 5).toFixed(2), w: +fw.toFixed(2), h: fh },
          color: "#2f2926",
          hidden: false,
        });
      }
      if (solo.box.y + solo.box.h + fh + 6 <= spec.pageHeight - spec.bleed) {
        graphics.push({
          id: gid(graphics.length + 1),
          kind: "flourish-heart",
          box: { x: fx, y: +(solo.box.y + solo.box.h + 5).toFixed(2), w: +fw.toFixed(2), h: fh },
          color: "#2f2926",
          hidden: false,
        });
      }
    }
  } else if (recipe === "center-note-grid") {
    // Center tile inside the mosaic gets a scroll flourish under the title/note (like sheet-2 top-right & sheet-3 top-left).
    const kicker = nextTexts.find((t) => t.role === "kicker");
    if (kicker) kicker.align = "center";
    const title = nextTexts.find((t) => t.role === "title");
    if (title) {
      title.align = "center";
      title.fontPt = 12.5;
      title.weight = 500;
      const fw = Math.min(36, title.box.w * 0.72), fh = 9;
      graphics.push({
        id: gid(graphics.length + 1),
        kind: "flourish-scroll",
        box: {
          x: +(title.box.x + (title.box.w - fw) / 2).toFixed(2),
          y: +(title.box.y + title.box.h + 1.5).toFixed(2),
          w: +fw.toFixed(2),
          h: fh,
        },
        color: "#3a322d",
        hidden: false,
      });
    }
  } else {
    const pocket = findCalmPocket(decoratedFrames, nextTexts, spec);
    if (pocket) {
      const cycle = recipe === "overlap-story" ? 1 : (index % 4);
      if (cycle === 0) {
        // Feathered arrow in the open pocket (like 190616 right page)
        const gw = Math.min(50, pocket.w * 0.65), gh = 13;
        graphics.push({
          id: gid(graphics.length + 1),
          kind: "boho-arrow",
          box: {
            x: +(pocket.x + (pocket.w - gw) / 2).toFixed(2),
            y: +(pocket.y + (pocket.h - gh) / 2).toFixed(2),
            w: +gw.toFixed(2),
            h: gh,
          },
          color: "#4a3531",
          hidden: false,
        });
      } else if (!callouts && (cycle === 1 || cycle === 2)) {
        const w = Math.min(44, pocket.w * 0.65), h = 13;
        graphics.push({
          id: gid(graphics.length + 1),
          kind: cycle === 1 ? "botanical-flower" : "lavender-sprig",
          box: { x: pocket.x + (pocket.w - w) / 2, y: pocket.y + (pocket.h - h) / 2, w, h },
          color: "#6d3b5e",
          hidden: false,
        });
      } else if (cycle === 1) {
        // English script accent word + watercolor blossom/sprig (like 190625 "Happy" + flower)
        const words = direction === "rtl" ? ["שמחה", "רגעים", "ביחד"] : ["Happy", "Moments", "Relax"];
        const word = words[(index + (recipe === "overlap-story" ? 1 : 0)) % words.length];
        const motif = word === "Relax" ? "lavender-sprig" : "botanical-flower";
        const tw = Math.min(64, pocket.w * 0.85), th = 16;
        const tx = +(pocket.x + (pocket.w - tw) / 2).toFixed(2);
        const ty = +(pocket.y + Math.max(1, (pocket.h - 34) / 2)).toFixed(2);
        nextTexts.push({
          id: `${sceneId}-callout-01`,
          sceneId,
          role: "callout",
          fontStyle: "script",
          text: word,
          box: { x: tx, y: ty, w: +tw.toFixed(2), h: th },
          fontPt: 14,
          weight: 400,
          color: "#221e1d",
          align: "center",
          hidden: false,
        });
        const gw = Math.min(44, pocket.w * 0.65), gh = 16;
        graphics.push({
          id: gid(graphics.length + 1),
          kind: motif,
          box: {
            x: +(pocket.x + (pocket.w - gw) / 2).toFixed(2),
            y: +(ty + th + 1).toFixed(2),
            w: +gw.toFixed(2),
            h: gh,
          },
          color: "#6d3b5e",
          hidden: false,
        });
      } else if (cycle === 2) {
        // Short warm phrase (Hebrew or English) + arrow or sprig (like sheet-2 top-left & bottom-left)
        const phrase = direction === "rtl" ? "רגעים של אהבה" : "Relax";
        const tw = Math.min(76, pocket.w * 0.9), th = 16;
        const tx = +(pocket.x + (pocket.w - tw) / 2).toFixed(2);
        const ty = +(pocket.y + Math.max(1, (pocket.h - 31) / 2)).toFixed(2);
        nextTexts.push({
          id: `${sceneId}-callout-01`,
          sceneId,
          role: "callout",
          fontStyle: "script",
          text: phrase,
          box: { x: tx, y: ty, w: +tw.toFixed(2), h: th },
          fontPt: 13.5,
          weight: 400,
          color: "#2b2523",
          align: "center",
          hidden: false,
        });
        const gw = Math.min(46, pocket.w * 0.62), gh = 13;
        graphics.push({
          id: gid(graphics.length + 1),
          kind: direction === "rtl" ? "boho-arrow" : "lavender-sprig",
          box: {
            x: +(pocket.x + (pocket.w - gw) / 2).toFixed(2),
            y: +(ty + th + 1).toFixed(2),
            w: +gw.toFixed(2),
            h: gh,
          },
          color: "#4a3531",
          hidden: false,
        });
      } else {
        // Scroll flourish divider
        const gw = Math.min(48, pocket.w * 0.6), gh = 11;
        graphics.push({
          id: gid(graphics.length + 1),
          kind: "flourish-scroll",
          box: {
            x: +(pocket.x + (pocket.w - gw) / 2).toFixed(2),
            y: +(pocket.y + (pocket.h - gh) / 2).toFixed(2),
            w: +gw.toFixed(2),
            h: gh,
          },
          color: "#3a322d",
          hidden: false,
        });
      }
    } else {
      // No open pocket: place a seam sticker badge between neighbouring photos or a header ornament.
      const seam = findPhotoSeam(decoratedFrames, spec);
      const badgeKinds = callouts && direction !== "rtl"
        ? ["badge-love-circle", "badge-heart", "badge-love-frame"] : ["badge-heart"];
      if (seam && index % 2 === 0) {
        graphics.push({
          id: gid(graphics.length + 1),
          kind: badgeKinds[index % badgeKinds.length],
          box: seam,
          color: "#2b2523",
          hidden: false,
        });
      } else {
        // Place a subtle ornament in the header margin opposite the title
        const title = nextTexts.find((t) => t.role === "title");
        const onRightPage = title ? title.box.x >= W : !leftBleed;
        const pageStart = onRightPage ? W : 0;
        const gw = 34, gh = 10;
        const gx = direction === "rtl"
          ? pageStart + spec.bleed + spec.margin + 2
          : pageStart + W - spec.bleed - spec.margin - gw - 2;
        const gy = spec.bleed + spec.margin + 3;
        const headerMotifs = ["flourish-scroll", "boho-arrow", "lavender-sprig"];
        const headerBox = { x: +gx.toFixed(2), y: +gy.toFixed(2), w: gw, h: gh };
        const occupied = [...visible.map(frame => frame.box),
          ...nextTexts.filter(text => !text.hidden && text.text).map(text => text.box)];
        if (occupied.every(rect => !overlaps(headerBox, rect, 2))) graphics.push({
          id: gid(graphics.length + 1),
          kind: headerMotifs[index % headerMotifs.length],
          box: headerBox,
          color: "#3a322d",
          hidden: false,
        });
      }
    }
  }

  return {
    wash,
    frames: decoratedFrames,
    texts: nextTexts.map((t) => ({ ...t, box: clampBox(t.box, spec) })),
    graphics: graphics.map((g) => ({ ...g, box: clampBox(g.box, spec) })),
  };
}
