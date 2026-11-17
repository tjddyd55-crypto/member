// Temporary bitmap lettering; replace generated assets with the official JCI KOREA logo.
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
const directory = new URL('../assets/', import.meta.url);
mkdirSync(directory, { recursive: true });
const letters = [
  '11111/00011/00011/00011/11011/11011/01110',
  '01111/11000/11000/11000/11000/11000/01111',
  '11111/01110/01110/01110/01110/01110/11111',
].map((s) => s.split('/'));
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const name = Buffer.from(type),
    size = Buffer.alloc(4),
    crc = Buffer.alloc(4);
  size.writeUInt32BE(data.length);
  crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([size, name, data, crc]);
}
function generate(name, size, transparent, rgb = false) {
  const channels = rgb ? 3 : 4;
  const scale = Math.floor((size * 0.58) / 17),
    width = 17 * scale,
    height = 7 * scale;
  const left = Math.floor((size - width) / 2),
    top = Math.floor((size - height) / 2);
  const raw = Buffer.alloc(size * (1 + size * channels));
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const gx = Math.floor((x - left) / scale),
        gy = Math.floor((y - top) / scale);
      const letter = Math.floor(gx / 6),
        col = gx % 6;
      const ink =
        gx >= 0 && gy >= 0 && gy < 7 && letter < 3 && col < 5 && letters[letter][gy][col] === '1';
      const at = y * (1 + size * channels) + 1 + x * channels;
      const pixel = ink ? [255, 255, 255, 255] : transparent ? [0, 0, 0, 0] : [27, 58, 107, 255];
      raw.set(pixel.slice(0, channels), at);
    }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = rgb ? 2 : 6;
  writeFileSync(
    new URL(name, directory),
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk('IHDR', header),
      chunk('IDAT', deflateSync(raw)),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  );
}
generate('icon.png', 1024, false, true);
generate('adaptive-icon.png', 1024, true);
generate('splash-icon.png', 1024, false);
generate('notification-icon.png', 96, true);
