import { imagePlacement } from "./composition.mjs";
import { buildSpreadDecor } from "./editor-decor.mjs";
import { photoItem, placementWarnings } from "./editor-placement.mjs";

const box = (x, y, w, h) => ({ x, y, w, h });
const area = (rect) => rect.w * rect.h;

function columns(rect, count, gap) {
  const width = (rect.w - gap * (count - 1)) / count;
  return Array.from({ length: count }, (_, index) =>
    box(rect.x + index * (width + gap), rect.y, width, rect.h));
}

function grid(rect, count, gap) {
  if (count === 1) return [rect];
  if (count === 2) return columns(rect, 2, gap);
  if (count === 3) {
    const [lead, side] = columns(rect, 2, gap);
    const height = (side.h - gap) / 2;
    return [
      lead,
      box(side.x, side.y, side.w, height),
      box(side.x, side.y + height + gap, side.w, height),
    ];
  }
  const rows = Math.ceil(count / 2);
  const height = (rect.h - gap * (rows - 1)) / rows;
  return Array.from({ length: rows }, (_, row) =>
    columns(box(rect.x, rect.y + row * (height + gap), rect.w, height),
      Math.min(2, count - row * 2), gap)).flat();
}

function templates(count, spec) {
  const { pageWidth, pageHeight, bleed, margin, binding, gutter: gap } = spec;
  const outer = bleed + margin, inner = bleed + binding, top = outer + 16;
  const left = box(outer, top, pageWidth - outer - inner, pageHeight - top - outer);
  const right = { ...left, x: pageWidth + inner };
  const heading = box(outer, outer, left.w, 15);
  const headingKicker = box(outer, outer, left.w, 4);
  const headingTitle = box(outer, outer + 6.1, left.w, 9);
  const pairCount = Math.ceil(count / 2);

  const leadWidth = (2 * pageWidth - 2 * outer - gap) * 0.665;
  const wide = box(outer, top, leadWidth, left.h);
  const rail = box(outer + leadWidth + gap, top, 2 * pageWidth - 2 * outer - leadWidth - gap, left.h);
  const railTop = box(rail.x, rail.y, rail.w, (rail.h - gap) * 0.64);
  const wideBoxes = count === 4
    ? [wide, railTop, ...columns(box(rail.x, rail.y + railTop.h + gap, rail.w, rail.h - railTop.h - gap), 2, gap)]
    : [wide, ...grid(rail, count - 1, gap)];

  const fullLeft = box(left.x, outer, left.w, pageHeight - 2 * outer);
  const heroWidth = (fullLeft.w - gap) * 0.74;
  const titleTile = box(fullLeft.x + heroWidth + gap, outer, fullLeft.w - heroWidth - gap, fullLeft.h * 0.28);
  const mosaic = [
    box(fullLeft.x, outer, heroWidth, fullLeft.h),
    box(titleTile.x, titleTile.y + titleTile.h + gap, titleTile.w, fullLeft.h - titleTile.h - gap),
    ...grid({ ...right, y: outer, h: fullLeft.h }, count - 2, gap),
  ];

  // Framed solo portrait on one page (with room for top/bottom flourishes) + mosaic on facing page (ref 190621)
  const framedSolo = box(right.x + 22, outer + 36, right.w - 44, pageHeight - 2 * outer - 72);
  const framedHavenBoxes = [
    framedSolo,
    ...grid(left, count - 1, gap),
  ];

  // Layered inset with calm pocket for script callout + blossom/arrow (ref 190607, 190625, sheet-2 top-left)
  const fullRight = box(right.x, outer, right.w, pageHeight - 2 * outer);
  const tallLeft = box(left.x, top, left.w * 0.54, left.h);
  const overlapInset = box(left.x + left.w * 0.44, top + left.h * 0.04, left.w * 0.56, left.h * 0.42);
  const rightCount = Math.max(1, count - 2);
  const overlapRight = rightCount === 2
    ? [
      box(fullRight.x + 16, outer, fullRight.w - 32, (fullRight.h - gap) / 2),
      box(fullRight.x + 16, outer + (fullRight.h + gap) / 2, fullRight.w - 32, (fullRight.h - gap) / 2),
    ]
    : grid(fullRight, rightCount, gap);
  const overlapBoxes = [
    tallLeft,
    ...overlapRight,
    overlapInset,
  ];

  // Mosaic with a note/flourish tile on the right page (ref sheet-2 top-right, sheet-3 top-left)
  const rowH = (fullRight.h - 2 * gap) / 3;
  const colW = (fullRight.w - 2 * gap) / 3;
  const ringCount = Math.max(1, count - 1);
  const bentoLeftW = (fullRight.w - gap) * 0.56;
  const bentoRightW = fullRight.w - gap - bentoLeftW;
  const bentoTopH = (fullRight.h - gap) * 0.42;
  const centerNoteTile = ringCount === 3
    ? box(fullRight.x + bentoLeftW + gap, outer, bentoRightW, bentoTopH)
    : box(fullRight.x + colW + gap, outer + rowH + gap, colW, rowH);
  const ringByCount = {
    3: [
      box(fullRight.x, outer, bentoLeftW, (fullRight.h - gap) * 0.54),
      box(fullRight.x, outer + (fullRight.h - gap) * 0.54 + gap, bentoLeftW, (fullRight.h - gap) * 0.46),
      box(fullRight.x + bentoLeftW + gap, outer + bentoTopH + gap, bentoRightW, fullRight.h - gap - bentoTopH),
    ],
    4: [
      box(fullRight.x, outer, colW * 2 + gap, rowH),
      box(fullRight.x + 2 * (colW + gap), outer, colW, rowH * 2 + gap),
      box(fullRight.x, outer + rowH + gap, colW, rowH * 2 + gap),
      box(fullRight.x + colW + gap, outer + 2 * (rowH + gap), colW * 2 + gap, rowH),
    ],
    5: [
      box(fullRight.x, outer, colW * 2 + gap, rowH),
      box(fullRight.x + 2 * (colW + gap), outer, colW, rowH),
      box(fullRight.x + 2 * (colW + gap), outer + rowH + gap, colW, rowH),
      box(fullRight.x, outer + rowH + gap, colW, rowH * 2 + gap),
      box(fullRight.x + colW + gap, outer + 2 * (rowH + gap), colW * 2 + gap, rowH),
    ],
    6: [
      box(fullRight.x, outer, colW * 2 + gap, rowH),
      box(fullRight.x + 2 * (colW + gap), outer, colW, rowH),
      box(fullRight.x, outer + rowH + gap, colW, rowH),
      box(fullRight.x + 2 * (colW + gap), outer + rowH + gap, colW, rowH),
      box(fullRight.x, outer + 2 * (rowH + gap), colW, rowH),
      box(fullRight.x + colW + gap, outer + 2 * (rowH + gap), colW * 2 + gap, rowH),
    ],
  };
  const centerGridBoxes = [
    fullLeft,
    ...(ringByCount[ringCount] || ringByCount[6].slice(0, ringCount)),
  ];

  const result = [
    {
      key: "portrait-lead",
      name: "Portrait lead",
      description: "One main photograph, with smaller moments beside it.",
      boxes: [left, ...grid(right, count - 1, gap)],
      titleBox: headingTitle,
      kickerBox: headingKicker,
    },
    {
      key: "reverse-lead",
      name: "Lead on the right",
      description: "A quieter change of pace between neighbouring spreads.",
      boxes: [right, ...grid(left, count - 1, gap)],
      titleBox: headingTitle,
      kickerBox: headingKicker,
    },
    {
      key: "framed-haven",
      name: "Framed portrait & flourish",
      description: "A white-bordered portrait on a watercolor wash with top and bottom flourishes.",
      boxes: framedHavenBoxes,
      titleBox: headingTitle,
      kickerBox: headingKicker,
    },
    ...(count >= 3 ? [{
      key: "overlap-story",
      name: "Layered inset & motif",
      description: "An overlapping white-bordered inset photo with a calm pocket for a script word and flower.",
      boxes: overlapBoxes,
      titleBox: headingTitle,
      kickerBox: headingKicker,
    }] : []),
    ...(count >= 4 && count <= 7 ? [{
      key: "center-note-grid",
      name: "Mosaic with center note",
      description: "A full-page hero facing a photo mosaic built around a central note and scroll flourish.",
      boxes: centerGridBoxes,
      titleBox: box(centerNoteTile.x + 4, +(centerNoteTile.y + centerNoteTile.h / 2 - 9).toFixed(2), centerNoteTile.w - 8, 16),
      kickerBox: box(centerNoteTile.x + 4, +(centerNoteTile.y + centerNoteTile.h / 2 - 17).toFixed(2), centerNoteTile.w - 8, 6),
      titleTile: true,
    }] : []),
    {
      key: "wide-story",
      name: "Wide story",
      description: "A wide photograph across the spread, with a side collage.",
      boxes: wideBoxes,
      titleBox: headingTitle,
      kickerBox: headingKicker,
      crossFold: true,
    },
    {
      key: "portrait-row",
      name: count === 2 ? "Facing pair" : "Portrait row",
      description: count === 2
        ? "Two complementary photographs, each with room to breathe."
        : "Tall, equal columns rather than another large-photo-and-grid spread.",
      boxes: count === 2
        ? [
          box(left.x + 8, left.y + 6, left.w - 16, left.h - 12),
          box(right.x + 8, right.y + 6, right.w - 16, right.h - 12),
        ]
        : [...columns(left, pairCount, gap), ...columns(right, count - pairCount, gap)],
      titleBox: headingTitle,
      kickerBox: headingKicker,
      equal: true,
    },
    ...(count >= 3 ? [{
      key: "story-mosaic",
      name: "Story mosaic",
      description: "Mixed photo sizes, thin gaps and a small title tile inside the collage.",
      boxes: mosaic,
      titleBox: box(titleTile.x + 4, titleTile.y + 16, titleTile.w - 8, titleTile.h - 33),
      kickerBox: box(titleTile.x + 4, titleTile.y + titleTile.h - 11, titleTile.w - 8, 7),
      titleTile: true,
    }] : []),
  ];
  if (spec.direction !== "rtl") return result;
  const mirror = (rect) => ({ ...rect, x: 2 * pageWidth - rect.x - rect.w });
  return result.map((template) => ({
    ...template,
    boxes: template.boxes.map(mirror),
    titleBox: mirror(template.titleBox),
    kickerBox: mirror(template.kickerBox),
  }));
}

function assign(matrix, allowBlocked) {
  const count = matrix.length;
  const states = Array(1 << count).fill(null);
  states[0] = { cost: 0, picks: [] };
  for (let mask = 0; mask < states.length - 1; mask++) {
    const state = states[mask];
    if (!state) continue;
    const slot = state.picks.length;
    for (let photo = 0; photo < count; photo++) {
      if (mask & (1 << photo)) continue;
      const cell = matrix[slot][photo];
      if (!allowBlocked && cell.blocked) continue;
      const next = mask | (1 << photo);
      const cost = state.cost + cell.cost + (cell.blocked ? 15 : 0);
      if (!states[next] || cost < states[next].cost) {
        states[next] = { cost, picks: [...state.picks, photo] };
      }
    }
  }
  return states.at(-1);
}

export function makeEditorLayouts(photos, spec) {
  if (photos.length < 2 || photos.length > 10) return [];
  return templates(photos.length, spec).map((template) => {
    const maxArea = Math.max(...template.boxes.map(area));
    const matrix = template.boxes.map((target, slot) => photos.map((photo, index) => {
      const placement = imagePlacement(photoItem(photo), target);
      const retained = placement.crop.width * placement.crop.height / (photo.width * photo.height);
      const warnings = placementWarnings(photo, placement, spec);
      const wrongWide = template.crossFold && slot === 0 &&
        (photo.width / photo.height < 1.12 || placement.fill < 0.95);
      const cost = 2.5 * (1 - placement.fill) + 0.4 * (1 - retained) +
        (photo.main ? 0.8 * (1 - area(target) / maxArea) : 0) +
        (slot === 0 && !photo.main && !template.equal ? 0.12 : 0) +
        Math.abs(index - slot) * 0.006;
      return {
        photo,
        placement,
        target,
        cost,
        blocked: warnings.length > 0 || wrongWide,
      };
    }));
    const valid = assign(matrix, false);
    const assignment = valid || assign(matrix, true);
    const frames = assignment.picks.map((index, slot) => {
      const cell = matrix[slot][index];
      return {
        id: cell.photo.frameId,
        photo: cell.photo.id,
        role: cell.photo.role,
        box: { ...cell.target },
        fit: "safe",
        focusX: 50,
        focusY: 50,
        zoom: 1,
        hidden: false,
      };
    });
    const coverage = frames.reduce((sum, frame) => sum + area(frame.box), 0) /
      (2 * spec.pageWidth * spec.pageHeight);
    const available = !!valid && (!template.crossFold || coverage >= 0.6);
    const decor = buildSpreadDecor({
      sceneId: photos[0]?.sceneId || "preview",
      index: spec.spreadIndex ?? 1,
      recipe: template.key,
      frames,
      texts: [
        { id: "preview-kicker", role: "kicker", text: "", box: { ...template.kickerBox }, hidden: false },
        { id: "preview-title", role: "title", text: "", box: { ...template.titleBox }, hidden: false },
      ],
      spec,
      direction: spec.direction || "ltr",
      decor: spec.decor || "crafted",
    });
    return {
      key: template.key,
      name: template.name,
      description: template.description,
      frames: decor.frames,
      wash: decor.wash,
      graphics: decor.graphics,
      callouts: decor.texts.filter((t) => t.role === "callout"),
      titleBox: template.titleBox,
      kickerBox: template.kickerBox,
      titleTile: !!template.titleTile,
      crossFold: !!template.crossFold,
      coverage,
      available,
      reason: available ? "" : template.crossFold
        ? "No wide crop keeps the marked subjects clear of the fold."
        : "The marked subjects need more space with these photographs.",
    };
  });
}
