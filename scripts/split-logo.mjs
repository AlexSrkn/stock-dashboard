import sharp from "sharp";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(__dirname, "../assets/tradepile-logo.png");
const chartOut = path.join(__dirname, "../assets/tradepile-chart.png");

const meta = await sharp(src).metadata();
const w = meta.width;
const h = meta.height;

// Horizontal lockup: wordmark ~left 58%, chart ~right 42%
const splitX = Math.round(w * 0.58);

const chartW = w - splitX;
await sharp(src).extract({ left: splitX, top: 0, width: chartW, height: h }).png().toFile(chartOut);

console.log(`Chart crop saved (${w - splitX}x${h} from ${w}x${h}) -> ${chartOut}`);
