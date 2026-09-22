import path from "node:path";
import sharp from "sharp";

const src = path.resolve(
  process.env.USERPROFILE || "",
  ".cursor/projects/c-Users-oebas-Documents-stock-dashboard/assets/ia-logo-natural-bridge.png"
);

const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const { width, height, channels } = info;
const px = new Uint8ClampedArray(data);
const idx = (x, y) => (y * width + x) * channels;
const isNearBlack = (i) => px[i] < 32 && px[i + 1] < 32 && px[i + 2] < 32;
const isW = (i) => px[i + 3] > 180 && px[i] > 205 && px[i + 1] > 205 && px[i + 2] > 205;
const isG = (i) =>
  px[i + 3] > 100 && px[i + 1] > 85 && px[i + 1] > px[i] + 18 && px[i + 1] > px[i + 2] + 5;

// Transparent background only — do not repaint the A bridge.
for (let i = 0; i < px.length; i += channels) {
  if (isNearBlack(i)) {
    px[i] = px[i + 1] = px[i + 2] = px[i + 3] = 0;
    continue;
  }
  const max = Math.max(px[i], px[i + 1], px[i + 2]);
  if (max < 55 && !isG(i)) {
    px[i + 3] = Math.round(px[i + 3] * Math.max(0, (max - 18) / 37));
    if (px[i + 3] < 8) px[i + 3] = 0;
  }
}

// Very mild thicken (1 pass) so we don't create bridge clutter.
const next = new Uint8ClampedArray(px);
for (let y = 1; y < height - 1; y++) {
  for (let x = 1; x < width - 1; x++) {
    const i = idx(x, y);
    if (px[i + 3] > 40 || isG(i)) continue;
    let n = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        if (isW(idx(x + dx, y + dy))) n++;
      }
    }
    if (n >= 4) {
      next[i] = next[i + 1] = next[i + 2] = 255;
      next[i + 3] = 255;
    }
  }
}
px.set(next);

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
const pad = Math.round(Math.max(maxX - minX, maxY - minY) * 0.03);
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
  .toFile("assets/ia-logo-mark.png");

const bg = await sharp({
  create: {
    width: cropW + 60,
    height: cropH + 60,
    channels: 3,
    background: { r: 18, g: 24, b: 34 },
  },
})
  .png()
  .toBuffer();

await sharp(bg)
  .composite([{ input: "assets/ia-logo-mark.png", left: 30, top: 30 }])
  .png()
  .toFile("assets/ia-logo-mark-preview.png");

console.log({ cropW, cropH, hasAlpha: true });
