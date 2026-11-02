import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { chromium } from 'playwright';
import { zipFixture, cors } from './helpers/source-fixtures.mjs';

const base = process.env.TEST_BASE_URL ?? 'http://127.0.0.1:8080';
const name = 'source-ranges';

async function fixtures(page, versions, handler) {
  await page.route(`https://crates.io/api/v1/crates/${name}`, route => route.fulfill({
    json: { crate: { id: name, max_version: [...versions.keys()].at(-1), downloads: 0 },
      versions: [...versions.keys()].map(num => ({ num, checksum: 'unused-by-zip', yanked: false })) },
    headers: cors,
  }));
  await page.route(`https://static.crates.io/crates/${name}/*`, async route => {
    const file = decodeURIComponent(new URL(route.request().url()).pathname.split('/').at(-1));
    assert.ok(!file.endsWith('.crate'), 'ZIP loading must not download Cargo archives');
    const manifest = file.endsWith('.zip.json');
    const version = file.slice(name.length + 1, manifest ? -9 : -4);
    const fixture = versions.get(version);
    if (manifest) return route.fulfill({ json: fixture.manifest, headers: cors });
    const range = route.request().headers().range?.match(/^bytes=(\d+)-(\d+)$/);
    assert.ok(range, 'every ZIP request must specify its entry range');
    const start = Number(range[1]), end = Number(range[2]);
    const entry = fixture.manifest.files.find(file => file.data_offset === start && file.compressed_size === end - start + 1);
    assert.ok(entry, 'range must exactly match a manifest entry');
    return handler(route, fixture, entry, start, end, version);
  });
}

const sourceFiles = {
  'Cargo.toml': '[package]\nname = "source-ranges"\n',
  'src/lib.rs': 'pub fn library() {}\n',
  'README.md': 'Documentation loaded on demand.\n',
  'empty.txt': '',
  'binary.dat': Buffer.from([0, 1, 2]),
};

async function select(page, path) {
  await page.getByRole('treeitem', { name: path, exact: true }).click();
}

async function debug(page) {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('tab', { name: 'About', exact: true }).click();
  await page.getByRole('link', { name: 'Debug', exact: true }).click();
  const dump = page.locator('pre[aria-label="Cache dump"]');
  await dump.waitFor();
  return JSON.parse(await dump.textContent());
}

test('browse fetches selected files only, verifies deflate/store, and reports partial cache sizes', { timeout: 30000 }, async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.addInitScript(() => {
      window.zipCacheModes = [];
      const fetch = window.fetch;
      window.fetch = function (input, init) {
        if (input instanceof Request && input.url.endsWith('.zip')) {
          window.zipCacheModes.push(input.cache);
        }
        return fetch.call(this, input, init);
      };
    });
    const requests = [];
    const fixture = zipFixture(sourceFiles, ['README.md', 'empty.txt', 'binary.dat']);
    await fixtures(page, new Map([['1.0.0', fixture]]), (route, fixture, entry, start, end) => {
      requests.push(entry.path);
      return route.fulfill({ status: 206, body: fixture.zip.subarray(start, end + 1),
        headers: { ...cors, 'content-range': `bytes ${start}-${end}/${fixture.zip.length}` } });
    });
    await page.goto(`${base}/browse/${name}/1.0.0`);
    await page.locator('.pierre-diff-host [data-code]').waitFor();
    assert.deepEqual(requests, ['Cargo.toml']);
    assert.equal(await page.getByRole('treeitem', { name: 'README.md', exact: true }).count(), 1);
    await select(page, 'README.md');
    await page.locator('.pierre-diff-host [data-code]').filter({ hasText: 'Documentation loaded on demand.' }).waitFor();
    assert.deepEqual(requests, ['Cargo.toml', 'README.md']);
    await select(page, 'Cargo.toml');
    await page.locator('.pierre-diff-host [data-code]').filter({ hasText: '[package]' }).waitFor();
    assert.deepEqual(requests, ['Cargo.toml', 'README.md'], 'file revisits use the source cache');
    await select(page, 'empty.txt');
    await page.getByText('This file is empty.', { exact: true }).waitFor();
    assert.deepEqual(requests, ['Cargo.toml', 'README.md'], 'empty stored entries need no range');
    await select(page, 'binary.dat');
    await page.getByText('Binary or non-UTF-8 file. A text comparison is unavailable.', { exact: true }).waitFor();
    const snapshot = await debug(page);
    const cached = snapshot.sources.entries[0];
    assert.equal(cached.format, 'zip');
    assert.equal(cached.file_count, 5);
    assert.equal(cached.cached_file_count, 4);
    assert.ok(cached.manifest_bytes > 0);
    assert.equal(cached.content_bytes, Buffer.byteLength(sourceFiles['Cargo.toml']) + Buffer.byteLength(sourceFiles['README.md']) + 3);
    assert.equal(cached.bytes, cached.manifest_bytes + cached.content_bytes);
    assert.equal(snapshot.sources.total_bytes, cached.bytes);
    assert.ok(!cached.files.some(file => file.path === 'src/lib.rs'));
    assert.deepEqual(await page.evaluate(() => window.zipCacheModes), ['no-store', 'no-store', 'no-store']);
  } finally { await browser.close(); }
});

test('comparisons skip unchanged source until selected and preserve exact change counts', { timeout: 30000 }, async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const requests = [];
    const versions = new Map([
      ['1.0.0', zipFixture({ ...sourceFiles, 'src/lib.rs': 'a\nb\n', 'removed.rs': 'removed\n' })],
      ['1.0.1', zipFixture({ ...sourceFiles, 'src/lib.rs': 'a\nc\nd\n', 'added.rs': 'added\n' })],
    ]);
    await fixtures(page, versions, (route, fixture, entry, start, end, version) => {
      requests.push([version, entry.path]);
      return route.fulfill({ status: 206, body: fixture.zip.subarray(start, end + 1), headers: cors });
    });
    await page.goto(`${base}/crate/${name}/1.0.0/1.0.1/src/lib.rs`);
    await page.locator('.pierre-diff-host [data-code]').first().waitFor();
    assert.deepEqual(await page.locator('.comparison-summary span').allTextContents(), ['3 changed files', '+3', '−2', 'lines']);
    assert.equal(requests.length, 4, 'only modified, added and deleted files are downloaded');
    assert.ok(requests.every(([, path]) => ['src/lib.rs', 'added.rs', 'removed.rs'].includes(path)));
    await select(page, 'README.md');
    await page.locator('.pierre-diff-host [data-code]').filter({ hasText: 'Documentation loaded on demand.' }).waitFor();
    assert.deepEqual(requests.at(-1), ['1.0.1', 'README.md']);
    assert.equal(requests.length, 5, 'identical hashes reuse one verified file for both sides');
    await select(page, 'lib.rs');
    await page.locator('.pierre-diff-host [data-code]').first().waitFor();
    assert.equal(requests.length, 5);
  } finally { await browser.close(); }
});

test('corrupt range data is rejected, retry works, and a whole-ZIP 200 response is sliced correctly', { timeout: 30000 }, async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    let requests = 0;
    const fixture = zipFixture(sourceFiles, ['Cargo.toml']);
    await fixtures(page, new Map([['1.0.0', fixture]]), (route, fixture, entry, start, end) => {
      requests++;
      const body = requests === 1 ? Buffer.alloc(entry.compressed_size, 88) : fixture.zip;
      return route.fulfill({ status: requests === 1 ? 206 : 200, body, headers: cors });
    });
    await page.goto(`${base}/browse/${name}/1.0.0`);
    await page.getByText(/Integrity check failed for Cargo.toml/).waitFor();
    assert.equal(await page.locator('.pierre-diff-host [data-code]').count(), 0);
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await page.locator('.pierre-diff-host [data-code]').filter({ hasText: '[package]' }).waitFor();
    assert.equal(requests, 2, 'failed integrity checks must not populate the file cache');
  } finally { await browser.close(); }
});


test('only missing manifests trigger checksum-verified legacy archive fallback', { timeout: 30000 }, async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const body = Buffer.from(sourceFiles['Cargo.toml']), header = Buffer.alloc(512);
    header.write(`${name}-1.0.0/Cargo.toml`);
    header.write('0000644\0', 100); header.write(`${body.length.toString(8).padStart(11, '0')}\0`, 124);
    header.fill(' ', 148, 156); header.write('0', 156); header.write('ustar\0', 257);
    const sum = header.reduce((sum, byte) => sum + byte, 0);
    header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148);
    const archive = gzipSync(Buffer.concat([header, body, Buffer.alloc((512 - body.length % 512) % 512), Buffer.alloc(1024)]));
    let checksum = createHash('sha256').update(archive).digest('hex');
    let status = 404, downloads = 0;
    await page.route(`https://crates.io/api/v1/crates/${name}`, route => route.fulfill({
      json: { crate: { id: name, max_version: '1.0.0', downloads: 0 },
        versions: [{ num: '1.0.0', checksum, yanked: false }] }, headers: cors,
    }));
    await page.route(`https://static.crates.io/crates/${name}/*`, route => {
      if (route.request().url().endsWith('.zip.json')) return route.fulfill({ status, body: 'missing', headers: cors });
      assert.ok(route.request().url().endsWith('.crate'));
      downloads++;
      return route.fulfill({ body: archive, headers: cors });
    });
    for (status of [404, 403]) {
      await page.goto(`${base}/browse/${name}/1.0.0`);
      await page.locator('.pierre-diff-host [data-code]').filter({ hasText: '[package]' }).waitFor();
    }
    assert.equal(downloads, 2);
    status = 503;
    await page.reload();
    await page.getByText('Loading the source manifest returned HTTP 503.', { exact: true }).waitFor();
    assert.equal(downloads, 2, 'other manifest errors must not fall back');
    status = 200;
    await page.reload();
    await page.getByText('Could not parse the source manifest.', { exact: true }).waitFor();
    assert.equal(downloads, 2, 'malformed manifests must not fall back');
    status = 404; checksum = 'wrong-checksum';
    await page.reload();
    await page.getByText(/Checksum mismatch/).waitFor();
    assert.equal(await page.locator('.pierre-diff-host [data-code]').count(), 0);
  } finally { await browser.close(); }
});
