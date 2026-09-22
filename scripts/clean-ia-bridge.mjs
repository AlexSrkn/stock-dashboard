import path from "node:path";
import sharp from "sharp";

const src = path.resolve(
  process.env.USERPROFILE || "",
  ".cursor/projects/c-Users-oebas-Documents-stock-dashboard/assets/ia-logo-clean-single-bar.png"
);

const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const { width, height, channels } = info;
const px = new Uint8ClampedArray(data);
const idx = (x, y) => (y * width + x) * channels;
const isNearBlack = (i) => px[i] < 32 && px[i + 1] < 32 && px[i + 2] < 32;
const isW = (i) => px[i + 3] > 180 && px[i] > 205 && px[i + 1] > 205 && px[i + 2] > 205;
const isG = (i) =>
  px[i + 3] > 100 && px[i + 1] > 85 && px[i + 1] > px[i] + 18 && px[i + 1] > px[i + 2] + 5;

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
const contentW = maxX - minX + 1;
const contentH = maxY - minY + 1;
const aLeft = minX + Math.floor(contentW * 0.36);
const aRight = maxX - Math.floor(contentW * 0.03);

function runs(y) {
  const out = [];
  let run = 0;
  let s = -1;
  for (let x = aLeft; x <= aRight; x++) {
    if (isW(idx(x, y))) {
      if (!run) s = x;
      run++;
    } else if (run) {
      out.push({ s, e: s + run - 1, len: run });
      run = 0;
    }
  }
  if (run) out.push({ s, e: s + run - 1, len: run });
  return out;
}

const solidRows = [];
for (let y = minY + Math.floor(contentH * 0.3); y <= minY + Math.floor(contentH * 0.6); y++) {
  const r = runs(y);
  if (r.length === 1 && r[0].len > contentW * 0.28) solidRows.push({ y, ...r[0] });
}
const oldTop = solidRows[0].y;
const oldBot = solidRows[solidRows.length - 1].y;
const oldLeft = Math.min(...solidRows.map((r) => r.s));
const oldRight = Math.max(...solidRows.map((r) => r.e));
const legInset = Math.max(24, Math.round(contentW * 0.135));

// Remove only white from the old mid bridge interior — keep greens.
for (let y = oldTop - 1; y <= oldBot + 1; y++) {
  for (let x = oldLeft + legInset; x <= oldRight - legInset; x++) {
    const i = idx(x, y);
    if (isW(i)) {
      px[i] = px[i + 1] = px[i + 2] = px[i + 3] = 0;
    }
  }
}

const barY = Math.round(minY + contentH * 0.57);
const barH = Math.max(26, Math.round(contentH * 0.092));
const rBar = runs(barY);
let barLeft;
let barRight;
if (rBar.length >= 2) {
  barLeft = rBar[0].e + 1;
  barRight = rBar[rBar.length - 1].s - 1;
} else {
  barLeft = oldLeft + legInset;
  barRight = oldRight - legInset;
}
barLeft -= 1;
barRight += 1;
const barW = Math.max(8, barRight - barLeft + 1);
const barTop = barY - Math.floor(barH / 2);

// Clear destination pocket so the SVG bar is uniform.
for (let y = barTop; y < barTop + barH; y++) {
  for (let x = barLeft; x <= barRight; x++) {
    const i = idx(x, y);
    px[i] = px[i + 1] = px[i + 2] = px[i + 3] = 0;
  }
}

// Mild letter thicken; don't refill A counter.
for (let pass = 0; pass < 2; pass++) {
  const next = new Uint8ClampedArray(px);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = idx(x, y);
      if (px[i + 3] > 40 || isG(i)) continue;
      if (
        x > oldLeft + legInset &&
        x < oldRight - legInset &&
        y > minY + contentH * 0.18 &&
        y < barTop - 2
      ) {
        continue;
      }
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          if (isW(idx(x + dx, y + dy))) n++;
        }
      }
      if (n >= 3) {
        next[i] = next[i + 1] = next[i + 2] = 255;
        next[i + 3] = 255;
      }
    }
  }
  px.set(next);
}

// Re-clear bar pocket after dilation.
for (let y = barTop; y < barTop + barH; y++) {
  for (let x = barLeft; x <= barRight; x++) {
    const i = idx(x, y);
    px[i] = px[i + 1] = px[i + 2] = px[i + 3] = 0;
  }
}

minX = width;
minY = height;
maxX = 0;
maxY = 0;
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

const barLeftC = barLeft - left;
const barTopC = barTop - top;
const svg = Buffer.from(
  `<svg width="${cropW}" height="${cropH}" xmlns="http://www.w3.org/2000/svg">` +
    `<rect x="${barLeftC}" y="${barTopC}" width="${barW}" height="${barH}" rx="1.5" ry="1.5" fill="#ffffff"/>` +
    `</svg>`
);

const base = await sharp(cropped, {
  raw: { width: cropW, height: cropH, channels: 4 },
})
  .png()
  .toBuffer();

await sharp(base)
  .composite([{ input: svg, top: 0, left: 0 }])
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

await sharp("assets/ia-logo-mark-preview.png")
  .extract({
    left: Math.max(0, barLeftC),
    top: Math.max(0, barTopC - 40),
    width: Math.min(480, cropW - barLeftC + 60),
    height: 280,
  })
  .png()
  .toFile("assets/ia-logo-bridge-crop.png");

console.log({ barY, barH, barLeft, barRight, barW, cropW, cropH });
