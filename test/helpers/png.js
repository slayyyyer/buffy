import zlib from 'node:zlib';

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function paeth(left, above, upperLeft) {
  const estimate = left + above - upperLeft;
  const toLeft = Math.abs(estimate - left);
  const toAbove = Math.abs(estimate - above);
  const toUpperLeft = Math.abs(estimate - upperLeft);
  if (toLeft <= toAbove && toLeft <= toUpperLeft) return left;
  return toAbove <= toUpperLeft ? above : upperLeft;
}

function unfilter(type, line, previous, bytesPerPixel) {
  for (let i = 0; i < line.length; i += 1) {
    const left = i >= bytesPerPixel ? line[i - bytesPerPixel] : 0;
    const above = previous ? previous[i] : 0;
    const upperLeft = previous && i >= bytesPerPixel ? previous[i - bytesPerPixel] : 0;
    if (type === 1) line[i] = (line[i] + left) & 0xff;
    else if (type === 2) line[i] = (line[i] + above) & 0xff;
    else if (type === 3) line[i] = (line[i] + ((left + above) >> 1)) & 0xff;
    else if (type === 4) line[i] = (line[i] + paeth(left, above, upperLeft)) & 0xff;
    else if (type !== 0) throw new Error(`unsupported PNG filter type ${type}`);
  }
}

/** Decode an 8-bit RGB or RGBA, non-interlaced PNG into RGBA pixels. */
export function decode(buffer) {
  if (!buffer.subarray(0, 8).equals(SIGNATURE)) throw new Error('not a PNG');
  let offset = 8;
  let header = null;
  const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      header = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
        interlace: data[12],
      };
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    offset += 12 + length;
  }
  if (!header) throw new Error('PNG has no IHDR');
  const channels = header.colorType === 6 ? 4 : header.colorType === 2 ? 3 : 0;
  if (!channels || header.bitDepth !== 8 || header.interlace !== 0) {
    throw new Error(`unsupported PNG (depth ${header.bitDepth}, colour type ${header.colorType}, interlace ${header.interlace})`);
  }

  const { width, height } = header;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = new Uint8Array(width * height * 4);
  let previous = null;
  for (let y = 0; y < height; y += 1) {
    const start = y * (stride + 1);
    const type = raw[start];
    const line = Uint8Array.from(raw.subarray(start + 1, start + 1 + stride));
    unfilter(type, line, previous, channels);
    for (let x = 0; x < width; x += 1) {
      const from = x * channels;
      const to = (y * width + x) * 4;
      pixels[to] = line[from];
      pixels[to + 1] = line[from + 1];
      pixels[to + 2] = line[from + 2];
      pixels[to + 3] = channels === 4 ? line[from + 3] : 255;
    }
    previous = line;
  }
  return { width, height, pixels };
}

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

/** Encode RGBA pixels as a PNG, used for diff artifacts on failure. */
export function encode({ width, height, pixels }) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(pixels.buffer, pixels.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Bounding box of pixels that are not (nearly) transparent. */
export function opaqueBounds({ width, height, pixels }, threshold = 12) {
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (pixels[(y * width + x) * 4 + 3] <= threshold) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  return right < 0 ? null : { left, top, right, bottom };
}

/**
 * Compare two captures.
 *
 * Pixel equality is the wrong bar: another machine rasterises the same layout
 * with slightly different antialiasing. So the verdict comes from block
 * averages, where edge blending washes out but a change in size, position or
 * colour does not. Exact pixel counts are kept for the failure message and the
 * diff mask.
 */
export function compare(expected, actual, { block = 8, channelTolerance = 10, pixelTolerance = 24 } = {}) {
  if (expected.width !== actual.width || expected.height !== actual.height) {
    throw new Error(`size mismatch: ${expected.width}x${expected.height} vs ${actual.width}x${actual.height}`);
  }
  const { width, height } = expected;
  const total = width * height;
  let differing = 0;
  let worst = 0;
  const mask = new Uint8Array(total * 4);
  for (let i = 0; i < total; i += 1) {
    const offset = i * 4;
    let delta = 0;
    for (let channel = 0; channel < 4; channel += 1) {
      delta = Math.max(delta, Math.abs(expected.pixels[offset + channel] - actual.pixels[offset + channel]));
    }
    if (delta > worst) worst = delta;
    if (delta > pixelTolerance) {
      differing += 1;
      mask[offset] = 255;
      mask[offset + 1] = 40;
      mask[offset + 2] = 90;
      mask[offset + 3] = 255;
    }
  }

  let blockTotal = 0;
  let blockDiffering = 0;
  for (let top = 0; top < height; top += block) {
    const bottom = Math.min(top + block, height);
    for (let left = 0; left < width; left += block) {
      const right = Math.min(left + block, width);
      const count = (right - left) * (bottom - top);
      const expectedSums = [0, 0, 0, 0];
      const actualSums = [0, 0, 0, 0];
      for (let y = top; y < bottom; y += 1) {
        for (let x = left; x < right; x += 1) {
          const offset = (y * width + x) * 4;
          for (let channel = 0; channel < 4; channel += 1) {
            expectedSums[channel] += expected.pixels[offset + channel];
            actualSums[channel] += actual.pixels[offset + channel];
          }
        }
      }
      blockTotal += 1;
      for (let channel = 0; channel < 4; channel += 1) {
        if (Math.abs(expectedSums[channel] - actualSums[channel]) / count > channelTolerance) {
          blockDiffering += 1;
          break;
        }
      }
    }
  }

  return {
    total,
    differing,
    ratio: differing / total,
    worst,
    blockTotal,
    blockDiffering,
    blockRatio: blockDiffering / blockTotal,
    expectedBounds: opaqueBounds(expected),
    actualBounds: opaqueBounds(actual),
    mask: { width, height, pixels: mask },
  };
}
