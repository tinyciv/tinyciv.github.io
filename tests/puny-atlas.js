import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

/** Decode the checked-in RGBA PNG so tests compare actual atlas pixels. */
export function punyAtlas(file = new URL('../public/assets/puny-world/overworld.png', import.meta.url)) {
    const png = readFileSync(file);
    const width = png.readUInt32BE(16), height = png.readUInt32BE(20), chunks = [];
    for (let at = 8; at < png.length;) {
        const length = png.readUInt32BE(at), type = png.toString('ascii', at + 4, at + 8);
        if (type === 'IDAT') chunks.push(png.subarray(at + 8, at + 8 + length));
        at += length + 12;
    }
    const compressed = inflateSync(Buffer.concat(chunks)), stride = width * 4, data = new Uint8ClampedArray(width * height * 4);
    const paeth = (a, b, c) => {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
    };
    for (let y = 0; y < height; y++) {
        const filter = compressed[y * (stride + 1)];
        for (let x = 0; x < stride; x++) {
            const i = y * stride + x, a = x >= 4 ? data[i - 4] : 0, b = y ? data[i - stride] : 0, c = x >= 4 && y ? data[i - stride - 4] : 0;
            const value = compressed[y * (stride + 1) + 1 + x];
            data[i] = (value + (filter === 1 ? a : filter === 2 ? b : filter === 3 ? Math.floor((a + b) / 2) : filter === 4 ? paeth(a, b, c) : 0)) & 255;
        }
    }
    return { width, height, data };
}
