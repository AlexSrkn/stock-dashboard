import sharp from "sharp";

const { data, info } = await sharp("assets/ia-logo-mark.png")
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });
const { width, height, channels } = info;
const px = new Uint8ClampedArray(data);
const idx = (x, y) => (y * width + x) * channels;
const isW = (i) => px[i + 3] > 180 && px[i] > 205 && px[i + 1] > 205 && px[i + 2] > 205;
const isG = (i) =>
  px[i + 3] > 100 && px[i + 1] > 85 && px[i + 1] > px[i] + 18 && px[i + 1] > px[i + 2] + 5;

// Overall content
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

// A region: right portion of mark
const aLeft = minX + Math.floor(contentW * 0.34);
const aRight = maxX - Math.floor(contentW * 0.02);

// A glyph bounds from WHITE pixels only (ignore green bars)
let aMinY = height;
let aMaxY = 0;
let aMinX = width;
let aMaxX = 0;
for (let y = 0; y < height; y++) {
  for (let x = aLeft; x <= aRight; x++) {
    const i = idx(x, y);
    if (!isW(i)) continue;
    if (y < aMinY) aMinY = y;
    if (y > aMaxY) aMaxY = y;
    if (x < aMinX) aMinX = x;
    if (x > aMaxX) aMaxX = x;
  }
}
const aH = aMaxY - aMinY + 1;
const aW = aMaxX - aMinX + 1;

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

// Find current bridge band (near-full-width white run inside A)
const solidRows = [];
for (let y = aMinY + Math.floor(aH * 0.2); y <= aMinY + Math.floor(aH * 0.75); y++) {
  const r = runs(y);
  if (r.length === 1 && r[0].len > aW * 0.35) {
    solidRows.push({ y, ...r[0] });
  } else if (r.length >= 3) {
    const m = r.slice(1, -1).sort((a, b) => b.len - a.len)[0];
    if (m && m.len > aW * 0.18) solidRows.push({ y, ...m });
  }
}
if (!solidRows.length) {
  throw new Error("Could not locate A bridge");
}

const oldTop = solidRows[0].y;
const oldBot = solidRows[solidRows.length - 1].y;
const oldLeft = Math.min(...solidRows.map((r) => r.s));
const oldRight = Math.max(...solidRows.map((r) => r.e));
const oldH = oldBot - oldTop + 1;
const oldCenter = (oldTop + oldBot) / 2;

// Target: optical center of the A glyph (~48% — slightly above geometric mid reads centered)
const targetCenter = aMinY + aH * 0.48;
const shift = Math.round(targetCenter - oldCenter);

const barH = Math.max(oldH, Math.round(aH * 0.09));
const barTop = Math.round(targetCenter - barH / 2);
const barBot = barTop + barH - 1;

// Leg inset so we only edit the counter / bridge span
const legInset = Math.max(18, Math.round(aW * 0.14));
const barLeft = oldLeft + Math.floor((oldRight - oldLeft) * 0.02);
const barRight = oldRight - Math.floor((oldRight - oldLeft) * 0.02);
const clearLeft = oldLeft + legInset;
const clearRight = oldRight - legInset;

// 1) Remove old bridge white only (keep greens)
for (let y = oldTop - 2; y <= oldBot + 2; y++) {
  for (let x = clearLeft; x <= clearRight; x++) {
    const i = idx(x, y);
    if (isW(i)) {
      px[i] = px[i + 1] = px[i + 2] = px[i + 3] = 0;
    }
  }
}

// 2) Clear destination pocket (so new bar is uniform)
for (let y = barTop; y <= barBot; y++) {
  for (let x = clearLeft; x <= clearRight; x++) {
    const i = idx(x, y);
    px[i] = px[i + 1] = px[i + 2] = px[i + 3] = 0;
  }
}

// Measure leg gap at new bar center for exact width
const midY = Math.round((barTop + barBot) / 2);
const rMid = runs(midY);
let spanLeft = clearLeft;
let spanRight = clearRight;
if (rMid.length >= 2) {
  spanLeft = rMid[0].e + 1;
  spanRight = rMid[rMid.length - 1].s - 1;
}
// slight overlap into legs for a flush join
spanLeft = Math.max(aMinX, spanLeft - 1);
spanRight = Math.min(aMaxX, spanRight + 1);

const barW = Math.max(8, spanRight - spanLeft + 1);

// Write base without bridge, then composite crisp SVG rect
const base = await sharp(Buffer.from(px), {
  raw: { width, height, channels: 4 },
})
  .png()
  .toBuffer();

const svg = Buffer.from(
  `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">` +
    `<rect x="${spanLeft}" y="${barTop}" width="${barW}" height="${barH}" rx="1" ry="1" fill="#ffffff"/>` +
    `</svg>`
);

await sharp(base)
  .composite([{ input: svg, top: 0, left: 0 }])
  .png()
  .toFile("assets/ia-logo-mark.png");

console.log({
  aBounds: { aMinY, aMaxY, aH },
  old: { oldTop, oldBot, oldCenter: +oldCenter.toFixed(1), rel: +((oldCenter - aMinY) / aH).toFixed(3) },
  neu: {
    barTop,
    barBot,
    center: +((barTop + barBot) / 2).toFixed(1),
    rel: +(((barTop + barBot) / 2 - aMinY) / aH).toFixed(3),
    shift,
    barH,
    barW,
  },
});
