import sharp from "sharp";

/**
 * Move the existing A crossbar up to vertical center by translating
 * its white pixels — no flat SVG rect (avoids the "painted/distorted" look).
 */
const { data, info } = await sharp("assets/ia-logo-mark.png")
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });
const { width, height, channels } = info;
const px = new Uint8ClampedArray(data);
const idx = (x, y) => (y * width + x) * channels;
const isW = (i) => px[i + 3] > 180 && px[i] > 205 && px[i + 1] > 205 && px[i + 2] > 205;

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
let openBot = aBot;
for (let y = aBot; y > aTop; y--) {
  let wr = 0;
  let run = 0;
  for (let x = aLeft; x <= aRight; x++) {
    if (isW(idx(x, y))) {
      if (!run) wr++;
      run = 1;
    } else run = 0;
  }
  if (wr >= 2) {
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

// Find main (lowest/thickest) solid white bridge band
const solids = [];
for (let y = aTop + Math.floor(aH * 0.25); y <= aTop + Math.floor(aH * 0.9); y++) {
  const r = runs(y);
  if (r.length === 1 && r[0].len > contentW * 0.22) solids.push({ y, ...r[0] });
  else if (r.length >= 3) {
    const m = r.slice(1, -1).sort((a, b) => b.len - a.len)[0];
    if (m && m.len > 50) solids.push({ y, ...m });
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
  } else bands.push({ y0: s.y, y1: s.y, len: s.len, s: s.s, e: s.e });
}
const main = bands.sort((a, b) => b.len * (b.y1 - b.y0) - a.len * (a.y1 - a.y0))[0];
const oldCenter = (main.y0 + main.y1) / 2;
const oldRel = (oldCenter - aTop) / aH;
const targetCenter = aTop + aH * 0.5;
const shift = Math.round(targetCenter - oldCenter);

if (Math.abs(shift) < 4) {
  console.log("already centered", { oldRel, shift });
  process.exit(0);
}

const legInset = Math.max(14, Math.round((main.e - main.s + 1) * 0.1));
const x0 = main.s + legInset;
const x1 = main.e - legInset;

// Snapshot bridge white pixels (interior only)
const bridge = [];
for (let y = main.y0; y <= main.y1; y++) {
  for (let x = x0; x <= x1; x++) {
    const i = idx(x, y);
    if (!isW(i)) continue;
    bridge.push({ x, y, r: px[i], g: px[i + 1], b: px[i + 2], a: px[i + 3] });
  }
}

// Clear old bridge interior
for (const p of bridge) {
  const i = idx(p.x, p.y);
  px[i] = px[i + 1] = px[i + 2] = px[i + 3] = 0;
}

// Also clear any thin upper white remnant band (rel ~0.2) interior only
for (const b of bands) {
  if (b === main) continue;
  const rel = ((b.y0 + b.y1) / 2 - aTop) / aH;
  if (rel > 0.35) continue;
  for (let y = b.y0; y <= b.y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = idx(x, y);
      if (isW(i)) {
        px[i] = px[i + 1] = px[i + 2] = px[i + 3] = 0;
      }
    }
  }
}

// Paste bridge shifted up — only into empty/non-leg interior
for (const p of bridge) {
  const ny = p.y + shift;
  if (ny < 0 || ny >= height) continue;
  const i = idx(p.x, ny);
  // Don't overwrite green chart
  const green =
    px[i + 3] > 100 && px[i + 1] > 85 && px[i + 1] > px[i] + 18 && px[i + 1] > px[i + 2] + 5;
  if (green) continue;
  px[i] = p.r;
  px[i + 1] = p.g;
  px[i + 2] = p.b;
  px[i + 3] = p.a;
}

// Fill any small gaps in the new bridge band (horizontal continuity)
const newTop = main.y0 + shift;
const newBot = main.y1 + shift;
for (let y = newTop; y <= newBot; y++) {
  if (y < 0 || y >= height) continue;
  // find span between legs
  const r = runs(y);
  if (r.length < 2) continue;
  const left = r[0].e + 1;
  const right = r[r.length - 1].s - 1;
  for (let x = left; x <= right; x++) {
    const i = idx(x, y);
    if (px[i + 3] > 200 && isW(i)) continue;
    // if neighbors left/right are white bridge, fill
    const il = idx(Math.max(0, x - 1), y);
    const ir = idx(Math.min(width - 1, x + 1), y);
    if (isW(il) && isW(ir)) {
      px[i] = px[i + 1] = px[i + 2] = 255;
      px[i + 3] = 255;
    }
  }
}

await sharp(Buffer.from(px), { raw: { width, height, channels: 4 } })
  .png()
  .toFile("assets/ia-logo-mark.png");

console.log({
  oldRel: +oldRel.toFixed(3),
  newRel: +((oldCenter + shift - aTop) / aH).toFixed(3),
  shift,
  bridgePixels: bridge.length,
  aH,
});
