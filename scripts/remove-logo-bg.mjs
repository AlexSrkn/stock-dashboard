import sharp from "sharp";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const input = path.join(__dirname, "../assets/tradepile-logo.png");
const output = path.join(__dirname, "../assets/tradepile-logo-transparent.png");

function dist(r1, g1, b1, r2, g2, b2) {
  return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2);
}

const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const { width, height, channels } = info;

const corners = [
  [0, 0],
  [width - 1, 0],
  [0, height - 1],
  [width - 1, height - 1],
];
let br = 0;
let bg = 0;
let bb = 0;
for (const [x, y] of corners) {
  const i = (y * width + x) * channels;
  br += data[i];
  bg += data[i + 1];
  bb += data[i + 2];
}
const bgR = Math.round(br / corners.length);
const bgG = Math.round(bg / corners.length);
const bgB = Math.round(bb / corners.length);

const threshold = 95;
const soft = 36;

for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const i = (y * width + x) * channels;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const d = dist(r, g, b, bgR, bgG, bgB);
    const darkBg = lum < 48 && d < threshold + 40;
    if (d <= threshold || darkBg) {
      data[i + 3] = 0;
    } else if (d <= threshold + soft) {
      const t = (d - threshold) / soft;
      data[i + 3] = Math.round(data[i + 3] * t);
    }
  }
}

await sharp(data, { raw: { width, height, channels } }).png().toFile(output);
console.log(`Background removed (sampled ${bgR},${bgG},${bgB}) -> ${output}`);
