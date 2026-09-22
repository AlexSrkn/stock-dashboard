import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(
  process.env.USERPROFILE || "",
  ".cursor/projects/c-Users-oebas-Documents-stock-dashboard/assets/ia-logo-on-black.png"
);
const out = path.resolve(__dirname, "../assets/ia-logo-mark.png");

const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const { width, height, channels } = info;
const px = new Uint8ClampedArray(data);

const idx = (x, y) => (y * width + x) * channels;

const isNearBlack = (i) => {
  const r = px[i];
  const g = px[i + 1];
  const b = px[i + 2];
  return r < 28 && g < 28 && b < 28;
};

const isWhiteish = (i) => {
  const r = px[i];
  const g = px[i + 1];
  const b = px[i + 2];
  const a = px[i + 3];
  return a > 180 && r > 200 && g > 200 && b > 200 && Math.abs(r - g) < 30 && Math.abs(g - b) < 30;
};

const isGreenish = (i) => {
  const r = px[i];
  const g = px[i + 1];
  const b = px[i + 2];
  const a = px[i + 3];
  return a > 120 && g > 90 && g > r + 25 && g > b + 10;
};

// 1) Knock out near-black background to transparent.
for (let i = 0; i < px.length; i += channels) {
  if (isNearBlack(i)) {
    px[i] = 0;
    px[i + 1] = 0;
    px[i + 2] = 0;
    px[i + 3] = 0;
  }
}

// Soft-edge near-black residual (glow / anti-alias).
for (let i = 0; i < px.length; i += channels) {
  const r = px[i];
  const g = px[i + 1];
  const b = px[i + 2];
  const max = Math.max(r, g, b);
  if (max < 55 && !isGreenish(i)) {
    const keep = Math.max(0, (max - 18) / 37);
    px[i + 3] = Math.round(px[i + 3] * keep);
    if (px[i + 3] < 8) px[i + 3] = 0;
  }
}

// Content bounds (non-transparent).
let minX = width;
let minY = height;
let maxX = 0;
let maxY = 0;
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const i = idx(x, y);
    if (px[i + 3] > 20) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
}

const contentW = Math.max(1, maxX - minX + 1);
const contentH = Math.max(1, maxY - minY + 1);

// 2) Thicken white letter strokes via neighbor dilation (2 passes).
const dilateWhite = (passes = 2) => {
  for (let p = 0; p < passes; p++) {
    const next = new Uint8ClampedArray(px);
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const i = idx(x, y);
        if (px[i + 3] > 200 && isWhiteish(i)) continue;
        if (isGreenish(i)) continue;
        let hit = false;
        for (let dy = -1; dy <= 1 && !hit; dy++) {
          for (let dx = -1; dx <= 1 && !hit; dx++) {
            if (!dx && !dy) continue;
            const j = idx(x + dx, y + dy);
            if (isWhiteish(j)) hit = true;
          }
        }
        if (hit && !isGreenish(i)) {
          next[i] = 255;
          next[i + 1] = 255;
          next[i + 2] = 255;
          next[i + 3] = 255;
        }
      }
    }
    px.set(next);
  }
};
dilateWhite(2);

// 3) Thicken / lower the A crossbar.
// A occupies roughly the right ~58% of the letter content.
const aLeft = minX + Math.floor(contentW * 0.38);
const aRight = maxX - Math.floor(contentW * 0.04);
const aTop = minY + Math.floor(contentH * 0.08);
const aBottom = maxY - Math.floor(contentH * 0.18);

// Find existing crossbar band: rows with a long white horizontal run in A.
const rowRuns = [];
for (let y = aTop; y <= aBottom; y++) {
  let run = 0;
  let best = 0;
  let runStart = -1;
  let bestStart = -1;
  for (let x = aLeft; x <= aRight; x++) {
    const i = idx(x, y);
    if (isWhiteish(i)) {
      if (run === 0) runStart = x;
      run++;
      if (run > best) {
        best = run;
        bestStart = runStart;
      }
    } else {
      run = 0;
    }
  }
  rowRuns.push({ y, best, bestStart });
}

const candidates = rowRuns
  .filter((r) => r.best >= contentW * 0.12 && r.best <= contentW * 0.55)
  .sort((a, b) => b.best - a.best);

let barY = Math.round(minY + contentH * 0.62);
let barLeft = aLeft + Math.floor(contentW * 0.08);
let barRight = aRight - Math.floor(contentW * 0.05);
if (candidates.length) {
  // Prefer a mid/lower existing bar, then push it lower.
  const midish = candidates
    .filter((c) => c.y > minY + contentH * 0.35 && c.y < minY + contentH * 0.75)
    .sort((a, b) => b.best - a.best);
  const pick = midish[0] || candidates[0];
  barY = Math.min(Math.round(pick.y + contentH * 0.06), Math.round(minY + contentH * 0.72));
  barLeft = Math.max(aLeft, pick.bestStart - 2);
  barRight = Math.min(aRight, pick.bestStart + pick.best + 2);
}

const barThickness = Math.max(10, Math.round(contentH * 0.085));
const half = Math.floor(barThickness / 2);

// Clear thinner old bar nearby (white-only), then paint thick bar.
for (let y = barY - half - 8; y <= barY + half + 4; y++) {
  if (y < 0 || y >= height) continue;
  for (let x = barLeft - 2; x <= barRight + 2; x++) {
    if (x < 0 || x >= width) continue;
    const i = idx(x, y);
    if (isWhiteish(i) && !isGreenish(i)) {
      // Only clear if this looks like the old thin bridge band.
      if (y < barY - half || y > barY + half) {
        px[i + 3] = 0;
      }
    }
  }
}

for (let y = barY - half; y <= barY + half; y++) {
  if (y < 0 || y >= height) continue;
  for (let x = barLeft; x <= barRight; x++) {
    if (x < 0 || x >= width) continue;
    const i = idx(x, y);
    // Don't obliterate strong green chart pixels inside the counter.
    if (isGreenish(i) && px[i + 3] > 180) continue;
    px[i] = 255;
    px[i + 1] = 255;
    px[i + 2] = 255;
    px[i + 3] = 255;
  }
}

// 4) Crop tight with small padding, then write PNG.
const pad = Math.round(Math.max(contentW, contentH) * 0.04);
const left = Math.max(0, minX - pad);
const top = Math.max(0, minY - pad);
const right = Math.min(width - 1, maxX + pad);
const bottom = Math.min(height - 1, maxY + pad);
const cropW = right - left + 1;
const cropH = bottom - top + 1;
const cropped = Buffer.alloc(cropW * cropH * 4);
for (let y = 0; y < cropH; y++) {
  for (let x = 0; x < cropW; x++) {
    const si = idx(left + x, top + y);
    const di = (y * cropW + x) * 4;
    cropped[di] = px[si];
    cropped[di + 1] = px[si + 1];
    cropped[di + 2] = px[si + 2];
    cropped[di + 3] = px[si + 3];
  }
}

await sharp(cropped, { raw: { width: cropW, height: cropH, channels: 4 } })
  .png()
  .toFile(out);

console.log(
  JSON.stringify(
    {
      out,
      crop: { cropW, cropH },
      bar: { barY, barLeft, barRight, barThickness },
      bounds: { minX, minY, maxX, maxY },
    },
    null,
    2
  )
);
