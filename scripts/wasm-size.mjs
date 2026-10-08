import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

const directory = process.argv[2] ?? 'dist';
const files = (await readdir(directory)).filter(file => file.endsWith('.wasm')).sort();
if (files.length === 0) {
  throw new Error(`No WebAssembly artifacts in ${directory}. Run trunk build --release first.`);
}

const header = Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]);
const sizes = await Promise.all(files.map(async file => {
  const bytes = await readFile(join(directory, file));
  if (!bytes.subarray(0, header.length).equals(header)) {
    throw new Error(`${file} is not a valid WebAssembly artifact.`);
  }
  return {
    File: file,
    'Wasm bytes': bytes.length,
    'Gzip bytes': gzipSync(bytes, { level: 9 }).length,
    'Brotli bytes': brotliCompressSync(bytes, {
      params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
    }).length,
  };
}));

console.table(sizes);
console.log('Compressed sizes estimate transfer size when the host serves gzip or Brotli.');
