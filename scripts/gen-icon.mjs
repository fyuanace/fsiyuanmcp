import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, deflateSync } from "node:zlib";

const TEAL = [47, 107, 115];
const WHITE = [245, 245, 245];
const PREVIEW_BG = [236, 236, 236];

function crc(buf) {
  return crc32(buf) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePngRgb(width, height, getPixel) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x++) {
      const [r, g, b] = getPixel(x, y);
      const i = row + 1 + x * 3;
      raw[i] = r;
      raw[i + 1] = g;
      raw[i + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

function distPoint(ax, ay, bx, by) {
  return Math.hypot(ax - bx, ay - by);
}

function distSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) {
    return distPoint(px, py, ax, ay);
  }
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return distPoint(px, py, ax + t * dx, ay + t * dy);
}

function distRoundedRectOutline(px, py, x0, y0, x1, y1, radius) {
  const cx = Math.max(x0 + radius, Math.min(px, x1 - radius));
  const cy = Math.max(y0 + radius, Math.min(py, y1 - radius));
  const insideX = px >= x0 + radius && px <= x1 - radius;
  const insideY = py >= y0 + radius && py <= y1 - radius;
  if (insideX && insideY) {
    return Math.min(px - x0, x1 - px, py - y0, y1 - py);
  }
  if (insideX) {
    return Math.min(Math.abs(py - y0), Math.abs(py - y1));
  }
  if (insideY) {
    return Math.min(Math.abs(px - x0), Math.abs(px - x1));
  }
  const qx = px < x0 + radius ? x0 + radius : x1 - radius;
  const qy = py < y0 + radius ? y0 + radius : y1 - radius;
  return Math.abs(distPoint(px, py, qx, qy) - radius);
}

function glyphCover(px, py, scale) {
  const s = scale;
  const stroke = 1.15 * s;
  const rect = distRoundedRectOutline(px, py, 5 * s, 5 * s, 27 * s, 27 * s, 5 * s);
  const left = Math.abs(distPoint(px, py, 5 * s, 16 * s) - 3.2 * s);
  const right = Math.abs(distPoint(px, py, 27 * s, 16 * s) - 3.2 * s);
  const bar = distSegment(px, py, 11 * s, 16 * s, 21 * s, 16 * s);
  return Math.min(rect, left, right, bar) <= stroke;
}

function drawIcon(size) {
  const scale = size / 32;
  return encodePngRgb(size, size, (x, y) => {
    const px = x + 0.5;
    const py = y + 0.5;
    return glyphCover(px, py, scale) ? WHITE : TEAL;
  });
}

function drawPreview(iconSize = 320) {
  const width = 1024;
  const height = 768;
  const ox = Math.floor((width - iconSize) / 2);
  const oy = Math.floor((height - iconSize) / 2);
  const scale = iconSize / 32;
  return encodePngRgb(width, height, (x, y) => {
    if (x < ox || y < oy || x >= ox + iconSize || y >= oy + iconSize) {
      return PREVIEW_BG;
    }
    const px = x - ox + 0.5;
    const py = y - oy + 0.5;
    return glyphCover(px, py, scale) ? WHITE : TEAL;
  });
}

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
fs.writeFileSync(path.join(root, "icon.png"), drawIcon(160));
fs.writeFileSync(path.join(root, "preview.png"), drawPreview(320));
console.log("wrote icon.png and preview.png");
