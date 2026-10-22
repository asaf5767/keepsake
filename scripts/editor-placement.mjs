import { imagePlacement, needsFullFrame } from "./composition.mjs";

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function photoItem(photo) {
  return {
    id: photo.id || photo.code,
    p: {
      code: photo.id || photo.code,
      width: photo.width,
      height: photo.height,
      vision: { what: photo.what || photo.vision?.what },
    },
    protect: photo.protect,
    subject: photo.subject,
    fit: photo.sourceFit || photo.fit,
    focus: photo.sourceFocus || photo.focus,
  };
}

export function resolveFramePlacement(photo, frame) {
  const target = frame.box;
  if (frame.fit === "safe" || !frame.fit) return imagePlacement(photoItem(photo), target);
  if (frame.fit === "contain") return imagePlacement({ ...photoItem(photo), fit: "contain" }, target);
  if (frame.fit !== "cover") throw new Error(`Unknown frame fit "${frame.fit}"`);

  const focusX = clamp((frame.focusX ?? 50) / 100, 0, 1);
  const focusY = clamp((frame.focusY ?? 50) / 100, 0, 1);
  const zoom = clamp(frame.zoom ?? 1, 1, 3);
  const scale = Math.max(target.w / photo.width, target.h / photo.height) * zoom;
  const cropWidth = Math.min(photo.width, target.w / scale);
  const cropHeight = Math.min(photo.height, target.h / scale);
  const left = (photo.width - cropWidth) * focusX;
  const top = (photo.height - cropHeight) * focusY;
  return {
    crop: { left, top, width: cropWidth, height: cropHeight },
    rect: { ...target },
    fill: 1,
    dpi: Math.min(cropWidth / target.w, cropHeight / target.h) * 25.4,
    reason: "manual crop",
  };
}

export function protectedBounds(photo, placement) {
  const item = photoItem(photo);
  const protect = photo.protect || (needsFullFrame(item) ? [0, 0, 1, 1] : null);
  if (!protect) return null;
  const [x, y, width, height] = protect;
  const crop = placement.crop, rect = placement.rect;
  return {
    x: rect.x + (x * photo.width - crop.left) * rect.w / crop.width,
    y: rect.y + (y * photo.height - crop.top) * rect.h / crop.height,
    w: width * photo.width * rect.w / crop.width,
    h: height * photo.height * rect.h / crop.height,
    clipped: crop.left > x * photo.width + 1 ||
      crop.top > y * photo.height + 1 ||
      crop.left + crop.width < (x + width) * photo.width - 1 ||
      crop.top + crop.height < (y + height) * photo.height - 1,
  };
}

export function placementWarnings(photo, placement, { pageWidth, binding }) {
  const subject = protectedBounds(photo, placement);
  const warnings = [];
  if (subject?.clipped) warnings.push("A marked subject is outside the crop.");
  if (subject && subject.x < pageWidth + binding && subject.x + subject.w > pageWidth - binding) {
    warnings.push("A marked subject is too close to the centre fold.");
  }
  return warnings;
}
