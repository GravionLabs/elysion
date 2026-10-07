// Makes the app icons from the one source, apps/frontend/public/icon.svg (`pnpm make:icons`):
// favicon.ico (16, 32, 48 px), icon-192.png, icon-512.png, icon-maskable-512.png and apple-touch-icon.png.
// The output only depends on the SVG, so running it again changes nothing.
import { readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';

const publicDir = new URL('../apps/frontend/public/', import.meta.url);
const svg = await readFile(new URL('icon.svg', publicDir), 'utf8');

const mark = svg.match(/<g id="mark">[\s\S]*?<\/g>/)?.[0];
const gradient = svg.match(/<defs>[\s\S]*?<\/defs>/)?.[0];
if (!mark || !gradient) {
  throw new Error(
    'icon.svg needs a <defs> gradient and a <g id="mark"> to make the full-bleed icons',
  );
}

/**
 * The icon without rounded corners and with the mark scaled down around the center: for platforms that
 * crop the icon themselves (a maskable icon keeps the mark inside the inner 80 %, a circle of 40 % of the
 * width; Apple rounds the corners of the touch icon and does not like transparency).
 */
const fullBleed = (scale) => {
  const offset = (32 * (1 - scale)).toFixed(2);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${gradient}<rect width="64" height="64" fill="url(#elysion-icon-gradient)"/><g transform="translate(${offset} ${offset}) scale(${scale})">${mark}</g></svg>`;
};

const png = (source, size) =>
  sharp(Buffer.from(source), { density: (72 * size) / 64 })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toBuffer();

/** An ICO file with one PNG image per size (PNG-in-ICO, supported everywhere that matters). */
function ico(images) {
  const header = Buffer.alloc(6 + images.length * 16);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, data }, i) => {
    const entry = 6 + i * 16;
    header.writeUInt8(size, entry); // width
    header.writeUInt8(size, entry + 1); // height
    header.writeUInt16LE(1, entry + 4); // color planes
    header.writeUInt16LE(32, entry + 6); // bits per pixel
    header.writeUInt32LE(data.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...images.map(({ data }) => data)]);
}

const write = (name, data) => writeFile(new URL(name, publicDir), data);

await write(
  'favicon.ico',
  ico(await Promise.all([16, 32, 48].map(async (size) => ({ size, data: await png(svg, size) })))),
);
await write('icon-192.png', await png(svg, 192));
await write('icon-512.png', await png(svg, 512));
await write('icon-maskable-512.png', await png(fullBleed(0.85), 512));
await write('apple-touch-icon.png', await png(fullBleed(0.9), 180));
console.log('Icons written to apps/frontend/public/');
