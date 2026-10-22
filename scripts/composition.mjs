const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

export function validateProtection(rect) {
  if (rect === undefined) return;
  if (!Array.isArray(rect) || rect.length !== 4 || rect.some((x) => !Number.isFinite(x))) {
    throw new Error("protect must be [x, y, width, height] using fractions from 0 to 1");
  }
  const [x, y, w, h] = rect;
  if (x < 0 || y < 0 || w <= 0 || h <= 0 || x + w > 1.000001 || y + h > 1.000001) {
    throw new Error("protect must describe a positive rectangle entirely inside the photograph");
  }
}

export function focusPoint(value) {
  if (value === undefined) return [0.5, 0.5];
  const m = /^(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%$/.exec(value);
  if (!m || Number(m[1]) > 100 || Number(m[2]) > 100) {
    throw new Error('focus must be two percentages, for example "50% 35%"');
  }
  return [Number(m[1]) / 100, Number(m[2]) / 100];
}

export function needsFullFrame(item) {
  return item.fit === "contain" || (!item.protect &&
    (item.subject === "people" || ["people", "child", "selfie"].includes(item.p.vision?.what)));
}

// The scorer and renderer share this exact crop, including the full-frame fallback.
export function imagePlacement(item, box) {
  const { width, height } = item.p;
  if (![width, height, box.w, box.h].every((n) => Number.isFinite(n) && n > 0)) {
    throw new Error(`Invalid photo or placement dimensions for ${item.id || item.p.code}`);
  }
  validateProtection(item.protect);
  const [fx, fy] = focusPoint(item.focus);
  const full = (reason) => {
    const s = Math.min(box.w / width, box.h / height);
    const w = s * width, h = s * height;
    return {
      crop: { left: 0, top: 0, width, height },
      rect: { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h },
      fill: w * h / (box.w * box.h),
      dpi: 25.4 / s,
      reason,
    };
  };
  if (needsFullFrame(item)) return full("whole photograph");

  const scale = Math.max(box.w / width, box.h / height);
  const cw = Math.min(width, Math.max(1, Math.round(box.w / scale)));
  const ch = Math.min(height, Math.max(1, Math.round(box.h / scale)));
  let left = Math.round((width - cw) * fx);
  let top = Math.round((height - ch) * fy);
  if (item.protect) {
    const [x, y, w, h] = item.protect;
    const pad = 0.015;
    const x0 = Math.floor(Math.max(0, x - pad) * width);
    const y0 = Math.floor(Math.max(0, y - pad) * height);
    const x1 = Math.ceil(Math.min(1, x + w + pad) * width);
    const y1 = Math.ceil(Math.min(1, y + h + pad) * height);
    if (x1 - x0 > cw || y1 - y0 > ch) return full("subject does not fit the crop");
    left = clamp(left, Math.max(0, x1 - cw), Math.min(x0, width - cw));
    top = clamp(top, Math.max(0, y1 - ch), Math.min(y0, height - ch));
  }
  return {
    crop: { left, top, width: cw, height: ch },
    rect: { ...box },
    fill: 1,
    dpi: Math.min(cw / box.w, ch / box.h) * 25.4,
    reason: item.protect ? "protected subject" : "centered crop",
  };
}

export function placementCost(item, box) {
  const placement = imagePlacement(item, box);
  const retained = placement.crop.width * placement.crop.height / (item.p.width * item.p.height);
  const resolution = placement.dpi < 150 ? 5 : placement.dpi < 200 ? 0.8 : 0;
  return 2.5 * (1 - placement.fill) + 0.45 * (1 - retained) + resolution;
}
