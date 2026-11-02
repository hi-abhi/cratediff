import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { deflateRawSync, gunzipSync } from 'node:zlib';

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = crc >>> 1 ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function zipFixture(files, stored = []) {
  const chunks = [], central = [], manifest = { files: [] };
  let offset = 0;
  for (const [path, contents] of Object.entries(files)) {
    const bytes = Buffer.from(contents), name = Buffer.from(path);
    const compression = stored.includes(path) ? 'store' : 'deflate';
    const payload = compression === 'store' ? bytes : deflateRawSync(bytes);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x800, 6); header.writeUInt16LE(compression === 'store' ? 0 : 8, 8);
    header.writeUInt32LE(crc32(bytes), 14); header.writeUInt32LE(payload.length, 18);
    header.writeUInt32LE(bytes.length, 22); header.writeUInt16LE(name.length, 26);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(20, 4);
    header.copy(directory, 6, 4, 28); directory.writeUInt32LE(offset, 42);
    central.push(directory, name);
    manifest.files.push({ path, data_offset: offset + 30 + name.length,
      compressed_size: payload.length, uncompressed_size: bytes.length, compression,
      sha256: createHash('sha256').update(bytes).digest('hex') });
    chunks.push(header, name, payload);
    offset += header.length + name.length + payload.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(manifest.files.length, 8);
  end.writeUInt16LE(manifest.files.length, 10); end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return { zip: Buffer.concat([...chunks, directory, end]), manifest };
}

const converted = new WeakMap();
function fromTar(bytes) {
  if (converted.has(bytes)) return converted.get(bytes);
  const tar = gunzipSync(bytes), files = {};
  for (let offset = 0; offset + 512 <= tar.length && tar[offset];) {
    const name = tar.subarray(offset, offset + 100).toString().split('\0')[0];
    const size = parseInt(tar.subarray(offset + 124, offset + 136).toString(), 8);
    files[name.slice(name.indexOf('/') + 1)] = tar.subarray(offset + 512, offset + 512 + size);
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  const fixture = zipFixture(files);
  converted.set(bytes, fixture);
  return fixture;
}

export const cors = { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'Content-Range' };

export async function serveSource(route, crate, archives, onManifest = () => {}, delay = 0) {
  const filename = decodeURIComponent(new URL(route.request().url()).pathname.split('/').at(-1));
  const manifest = filename.endsWith('.zip.json');
  assert.ok(manifest || filename.endsWith('.zip'), 'normal source loading must never request .crate');
  const version = filename.slice(crate.length + 1, manifest ? -'.zip.json'.length : -'.zip'.length);
  const fixture = fromTar(archives.get(version));
  if (delay) await new Promise(resolve => setTimeout(resolve, delay));
  if (manifest) {
    onManifest(version);
    return route.fulfill({ json: fixture.manifest, headers: cors });
  }
  const range = route.request().headers().range?.match(/^bytes=(\d+)-(\d+)$/);
  assert.ok(range, 'ZIP requests must carry a single explicit byte range');
  const start = Number(range[1]), end = Number(range[2]);
  assert.ok(end >= start && end < fixture.zip.length);
  return route.fulfill({ status: 206, body: fixture.zip.subarray(start, end + 1),
    contentType: 'application/octet-stream',
    headers: { ...cors, 'content-range': `bytes ${start}-${end}/${fixture.zip.length}` } });
}
