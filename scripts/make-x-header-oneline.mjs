import fs from "node:fs";
import sharp from "sharp";

const W = 1500;
const H = 500;
const fontB64 = fs.readFileSync("assets/fonts/DMSans-SemiBold.ttf").toString("base64");

const bgSvg = Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="g" cx="70%" cy="42%" r="70%">
      <stop offset="0%" stop-color="#0f4538"/>
      <stop offset="40%" stop-color="#0a241e"/>
      <stop offset="100%" stop-color="#030706"/>
    </radialGradient>
    <linearGradient id="haze" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#020403" stop-opacity="1"/>
      <stop offset="50%" stop-color="#020403" stop-opacity="0.45"/>
      <stop offset="100%" stop-color="#020403" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#g)"/>
  <rect width="100%" height="100%" fill="url(#haze)"/>
</svg>`);

const textSvg = Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <style><![CDATA[
      @font-face {
        font-family: 'DM Sans';
        src: url(data:font/ttf;base64,${fontB64}) format('truetype');
        font-weight: 600;
        font-style: normal;
      }
    ]]></style>
  </defs>
  <text
    x="750"
    y="262"
    text-anchor="middle"
    dominant-baseline="middle"
    font-family="DM Sans"
    font-weight="600"
    font-size="48"
    letter-spacing="-0.8"
    fill="#f2f6f4"
  >Follow the Money behind the Market</text>
</svg>`);

const bg = await sharp(bgSvg).png().toBuffer();
const text = await sharp(textSvg).png().toBuffer();

await sharp(bg)
  .composite([{ input: text, left: 0, top: 0 }])
  .png()
  .toFile("assets/x-header-follow-money-oneline.png");

const m = await sharp("assets/x-header-follow-money-oneline.png").metadata();
console.log({ w: m.width, h: m.height, file: "assets/x-header-follow-money-oneline.png" });
