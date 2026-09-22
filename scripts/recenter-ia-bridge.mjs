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

let minX = width;
let minY = height;
let maxX = 0;
let maxY = 0;
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    if (px[idx(x, y) + 3] > 20) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
}
const contentW = maxX - minX + 1;
const aLeft = minX + Math.floor(contentW * 0.34);
const aRight = maxX - Math.floor(contentW * 0.02);

let aTop = height;
let aBot = 0;
for (let y = 0; y < height; y++) {
  for (let x = aLeft; x <= aRight; x++) {
    if (!isW(idx(x, y))) continue;
    if (y < aTop) aTop = y;
    if (y > aBot) aBot = y;
  }
}

// True A base = lowest row with two separate white legs
let openBot = aBot;
for (let y = aBot; y > aTop; y--) {
  let wRuns = 0;
  let run = 0;
  for (let x = aLeft; x <= aRight; x++) {
    if (isW(idx(x, y))) {
      if (!run) wRuns++;
      run = 1;
    } else run = 0;
  }
  if (wRuns >= 2) {
    openBot = y;
    break;
  }
}
const aH = openBot - aTop + 1;

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

// Collect all bridge-like white bands inside A
const solids = [];
for (let y = aTop + Math.floor(aH * 0.12); y <= aTop + Math.floor(aH * 0.9); y++) {
  const r = runs(y);
  if (r.length === 1 && r[0].len > contentW * 0.2) solids.push({ y, ...r[0] });
  else if (r.length >= 3) {
    const m = r.slice(1, -1).sort((a, b) => b.len - a.len)[0];
    if (m && m.len > 36) solids.push({ y, ...m });
  }
}
const bands = [];
for (const s of solids) {
  const L = bands[bands.length - 1];
  if (L && s.y - L.y1 <= 2) {
    L.y1 = s.y;
    L.len = Math.max(L.len, s.len);
    L.s = Math.min(L.s, s.s);
    L.e = Math.max(L.e, s.e);
  } else {
    bands.push({ y0: s.y, y1: s.y, len: s.len, s: s.s, e: s.e });
  }
}

const main = bands.sort((a, b) => b.len * (b.y1 - b.y0 + 1) - a.len * (a.y1 - a.y0 + 1))[0];
const barH = Math.max(main.y1 - main.y0 + 1, Math.round(aH * 0.1));

// Center of A glyph
const targetCenter = Math.round(aTop + aH * 0.5);
const barTop = Math.round(targetCenter - barH / 2);
const barBot = barTop + barH - 1;

const legInset = Math.max(16, Math.round((main.e - main.s + 1) * 0.12));
const clearLeft = main.s + legInset;
const clearRight = main.e - legInset;

// Remove ALL existing white bridge bands inside A counter
for (const b of bands) {
  for (let y = b.y0 - 1; y <= b.y1 + 1; y++) {
    for (let x = clearLeft; x <= clearRight; x++) {
      const i = idx(x, y);
      if (isW(i)) {
        px[i] = px[i + 1] = px[i + 2] = px[i + 3] = 0;
      }
    }
  }
}

// Clear destination pocket (uniform bar)
for (let y = barTop; y <= barBot; y++) {
  for (let x = clearLeft; x <= clearRight; x++) {
    const i = idx(x, y);
    px[i] = px[i + 1] = px[i + 2] = px[i + 3] = 0;
  }
}

// Width between legs at center
const rMid = runs(targetCenter);
let spanLeft = clearLeft;
let spanRight = clearRight;
if (rMid.length >= 2) {
  spanLeft = rMid[0].e + 1;
  spanRight = rMid[rMid.length - 1].s - 1;
}
spanLeft = Math.max(aLeft, spanLeft - 1);
spanRight = Math.min(aRight, spanRight + 1);
const barW = Math.max(8, spanRight - spanLeft + 1);

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
  aTop,
  openBot,
  aH,
  oldRel: +(((main.y0 + main.y1) / 2 - aTop) / aH).toFixed(3),
  newRel: +((targetCenter - aTop) / aH).toFixed(3),
  barTop,
  barBot,
  barH,
  barW,
  bands: bands.map((b) => ({
    y0: b.y0,
    y1: b.y1,
    rel: +(((b.y0 + b.y1) / 2 - aTop) / aH).toFixed(3),
  })),
});
