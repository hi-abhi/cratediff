import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { gzipSync } from 'node:zlib';
import { chromium, firefox } from 'playwright';

const base = process.env.TEST_BASE_URL ?? 'http://127.0.0.1:8080';
const name = 'review-fixture';

function archive(version, files) {
  const chunks = [];
  for (const [path, content] of Object.entries(files)) {
    const bytes = Buffer.from(content), header = Buffer.alloc(512);
    header.write(`${name}-${version}/${path}`);
    header.write('0000644\0', 100);
    header.write('0000000\0', 108);
    header.write('0000000\0', 116);
    header.write(`${bytes.length.toString(8).padStart(11, '0')}\0`, 124);
    header.write('00000000000\0', 136);
    header.fill(' ', 148, 156);
    header.write('0', 156);
    header.write('ustar\0', 257);
    header.write('00', 263);
    header.write(`${header.reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, '0')}\0 `, 148);
    chunks.push(header, bytes, Buffer.alloc((512 - bytes.length % 512) % 512));
  }
  return gzipSync(Buffer.concat([...chunks, Buffer.alloc(1024)]));
}

async function fixture(context, large = false, ordering = false, extraFiles = () => ({})) {
  const files = version => {
    const result = {
      'Cargo.toml': `[package]\nname = "${name}"\nversion = "${version}"\n`,
      'src/alpha.rs': `pub const VERSION: &str = "${version}";\n`,
      'src/nested/beta.rs': `pub const VERSION: &str = "${version}";\n`,
      'src-extra/other.rs': `pub const VERSION: &str = "${version}";\n`,
      'tests/check.rs': `pub const VERSION: &str = "${version}";\n`,
      'docs/readme.md': 'Unchanged documentation.\n',
      'src/unchanged.rs': '// Unchanged source.\n',
      'image.bin': Buffer.from([0, version.endsWith('0') ? 1 : 2]),
      [version.endsWith('0') ? 'deleted.rs' : 'added.rs']: '// Release-specific file.\n',
      [version.endsWith('0') ? 'empty-deleted.rs' : 'empty-added.rs']: '',
    };
    if (large) for (let index = 0; index < 100; index++) {
      result[`src/many/file-${String(index).padStart(3, '0')}.rs`] =
        Array.from({ length: 80 }, (_, line) => `pub const VALUE_${line}: &str = "${line === 40 ? version : 'unchanged'}";\n`).join('');
    }
    if (ordering) for (const path of [
      'src/file-10.rs', 'src/file-2.rs', 'src/A.rs', 'src/a.rs',
      'src/nested/file-10.rs', 'src/nested/file-2.rs',
    ]) {
      result[path] = `pub const VERSION: &str = "${version}";\n`;
    }
    return Object.assign(result, extraFiles(version));
  };
  const archives = new Map(['1.0.0', '1.0.1', '1.0.2'].map(version => [version, archive(version, files(version))]));
  const versions = [...archives].map(([num, bytes]) => ({
    num, checksum: createHash('sha256').update(bytes).digest('hex'), yanked: false,
  }));
  const downloads = [];
  await context.route(`https://crates.io/api/v1/crates/${name}`, route => route.fulfill({
    json: { crate: { id: name, max_version: '1.0.2', downloads: 0 }, versions },
    headers: { 'access-control-allow-origin': '*' },
  }));
  await context.route(`https://static.crates.io/crates/${name}/*`, route => {
    const version = route.request().url().match(/-(\d+\.\d+\.\d+)\.crate$/)[1];
    downloads.push(version);
    return route.fulfill({ body: archives.get(version), contentType: 'application/octet-stream',
      headers: { 'access-control-allow-origin': '*' } });
  });
  return downloads;
}

async function checkLayout(page, split) {
  await page.locator(`.pierre-review-host [data-diff-type="${split ? 'split' : 'single'}"]`).first().waitFor();
  assert.equal(await page.getByRole('button', { name: 'Split view', exact: true }).getAttribute('aria-pressed'), String(split));
}

test('all changes reviews directories, file jumps, binary and empty files without new downloads', { timeout: 60000 }, async () => {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 700 } });
    const downloads = await fixture(context);
    const page = await context.newPage();
    page.setDefaultTimeout(8000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const url = `${base}/crate/${name}/1.0.0/1.0.1`;
    await page.goto(`${url}/src/alpha.rs`);
    await page.locator('.pierre-diff-host [data-code]').first().waitFor();
    const toolbar = await page.getByRole('toolbar', { name: 'Diff viewer controls', exact: true }).elementHandle();
    const fullDiff = page.getByRole('button', { name: 'Show all changes', exact: true });
    assert.equal(await fullDiff.getAttribute('aria-pressed'), 'false');
    const inactiveFill = await fullDiff.evaluate(button => getComputedStyle(button).backgroundColor);
    assert.equal(await fullDiff.locator('.full-diff-check').count(), 0);
    assert.equal(await fullDiff.getAttribute('title'), 'View all changed files');
    await page.getByRole('button', { name: 'Split view', exact: true }).click();
    await fullDiff.click();
    assert.equal(await fullDiff.getAttribute('aria-pressed'), 'true');
    assert.notEqual(await fullDiff.evaluate(button => getComputedStyle(button).backgroundColor), inactiveFill);
    assert.equal(await fullDiff.locator('.full-diff-check').count(), 1);
    assert.equal(await fullDiff.getAttribute('title'), 'Switch to single-file view');
    assert.equal(await page.evaluate(toolbar => toolbar === document.querySelector('.diff-toolbar'), toolbar), true,
      'switching viewers retains the shared toolbar');
    await toolbar.dispose();
    await page.getByRole('region', { name: 'Changes review', exact: true }).waitFor();
    await checkLayout(page, true);
    assert.equal(new URL(page.url()).searchParams.get('view'), 'changes');
    assert.equal((await page.locator('.review-totals').innerText()).replace(/\s+/g, ' '), '10 files +6 −6');
    assert.equal(await page.getByRole('button', { name: 'Collapse src/unchanged.rs', exact: true }).count(), 0);
    await page.getByRole('treeitem', { name: 'alpha.rs', exact: true }).click();
    await page.getByRole('button', { name: 'Collapse src/alpha.rs', exact: true }).waitFor();
    assert.equal(new URL(page.url()).searchParams.get('view'), 'changes');
    await page.waitForFunction(() => document.querySelector('.pierre-review-host').scrollTop > 0);
    const collapse = page.getByRole('button', { name: 'Collapse src/alpha.rs', exact: true });
    assert.equal(await collapse.locator('.review-file-chevron path').getAttribute('d'), 'M5.5 9l6.5 6 6.5-6');
    assert.equal(await collapse.locator('.review-file-chevron path').count(), 1);
    assert.equal(await collapse.locator('.review-file-status[data-change-icon="change"] path').count(), 1);
    assert.deepEqual(await collapse.evaluate(button => [...button.children].slice(0, 3).map(child => child.getAttribute('class'))),
      ['review-file-chevron', 'review-file-status modified', 'review-file-name']);
    await collapse.locator('.review-file-name').click();
    await page.getByRole('button', { name: 'Expand src/alpha.rs', exact: true }).waitFor();
    const expand = page.getByRole('button', { name: 'Expand src/alpha.rs', exact: true });
    assert.equal(await expand.locator('.review-file-chevron path').getAttribute('d'), 'M9 5.5l6 6.5-6 6.5');
    assert.equal(await expand.locator('.review-file-status[data-change-icon="change"]').count(), 1);
    await expand.locator('.review-file-stats').click();
    await collapse.waitFor();
    await collapse.focus();
    await page.keyboard.press('Enter');
    await expand.waitFor();
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Expand src/alpha.rs');
    await page.keyboard.press('Space');
    await collapse.waitFor();
    // The blank area of the row is also part of the collapse button.
    await collapse.click({ position: { x: 350, y: 20 } });
    await expand.waitFor();
    await expand.click();
    await collapse.waitFor();
    await page.getByRole('treeitem', { name: 'src', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.review-totals')?.textContent.startsWith('2 files'));
    await checkLayout(page, true);
    assert.equal((await page.locator('.review-totals').innerText()).replace(/\s+/g, ' '), '2 files +2 −2');
    assert.equal(await page.getByRole('button', { name: 'Collapse src-extra/other.rs', exact: true }).count(), 0);
    await page.getByRole('treeitem', { name: 'src', exact: true }).press('ArrowRight');
    await page.getByRole('treeitem', { name: 'nested', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.review-totals')?.textContent.startsWith('1 file'));
    assert.equal(new URL(page.url()).searchParams.get('scope'), 'src/nested/');
    await page.reload();
    await checkLayout(page, true);
    assert.equal(await page.getByRole('combobox', { name: 'Review directory', exact: true }).count(), 0);
    await page.locator('#new-version').selectOption('1.0.2');
    await checkLayout(page, true);
    await page.waitForFunction(() =>
      [...document.querySelectorAll('.pierre-review-host diffs-container')].some(container =>
        [...(container.shadowRoot?.querySelectorAll('[data-code]') ?? [])]
          .some(code => code.textContent.includes('1.0.2'))));
    assert.equal(new URL(page.url()).searchParams.get('scope'), 'src/nested/');
    await page.getByRole('treeitem', { name: 'docs', exact: true }).click();
    await page.getByText('There are no changed files in this directory.', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Show all changes', exact: true }).click();
    await page.getByRole('button', { name: 'Show all changes', exact: true }).click();
    await checkLayout(page, true);
    await page.getByRole('treeitem', { name: 'deleted.rs', exact: true }).click();
    await page.getByRole('button', { name: 'Collapse deleted.rs', exact: true })
      .locator('.review-file-status[data-change-icon="deleted"]').waitFor();
    await page.getByRole('treeitem', { name: 'image.bin', exact: true }).click();
    await page.getByText('Binary or non-UTF-8 file.', { exact: false }).waitFor();
    await page.getByRole('treeitem', { name: 'empty-added.rs', exact: true }).click();
    await page.locator('.pierre-review-host diffs-container').filter({
      has: page.getByRole('button', { name: 'Collapse empty-added.rs', exact: true }),
    }).getByText('This file is empty.', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Collapse empty-added.rs', exact: true })
      .locator('.review-file-status[data-change-icon="new"]').waitFor();
    await page.getByRole('treeitem', { name: 'src', exact: true }).click();
    await page.getByRole('button', { name: 'Show all changes', exact: true }).click();
    assert.equal(await fullDiff.locator('.full-diff-check').count(), 0);
    await page.mouse.move(0, 0);
    assert.equal(await fullDiff.evaluate(button => getComputedStyle(button).backgroundColor), inactiveFill);
    await page.locator('.pierre-diff-host [data-code]').first().waitFor();
    assert.equal(new URL(page.url()).search, '');
    assert.equal(await page.getByRole('button', { name: 'Split view', exact: true }).getAttribute('aria-pressed'), 'true');
    assert.deepEqual(downloads, ['1.0.0', '1.0.1', '1.0.0', '1.0.1', '1.0.2'],
      'only reload and an uncached release fetch source archives');
    await page.goto(`${base}/crate/${name}?view=changes&scope=missing%2F`);
    await page.getByText('There are no changed files in this directory.', { exact: true }).waitFor();
    assert.equal(new URL(page.url()).searchParams.get('scope'), 'missing/');
    assert.equal(await page.getByRole('button', { name: 'Show all changes', exact: true }).getAttribute('aria-pressed'), 'true');
    await page.goto(`${base}/crate/${name}/1.0.1/1.0.1?view=changes`);
    await page.getByText('These crate versions contain the same files.', { exact: true }).waitFor();
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test('whole-crate and directory reviews match changed files in sidebar order', { timeout: 30000 }, async () => {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1800 } });
    await fixture(context, false, true);
    const page = await context.newPage();
    page.setDefaultTimeout(8000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${base}/crate/${name}/1.0.0/1.0.1?view=changes`);
    await checkLayout(page, false);
    await page.getByRole('button', { name: 'Collapse image.bin', exact: true }).waitFor();
    const sidebarPaths = await page.locator('.file-tree-host [role="treeitem"]').evaluateAll(rows =>
      rows.map(row => row.dataset.itemPath).filter(path => path && !path.endsWith('/')));
    const changedPaths = sidebarPaths.filter(path =>
      !['docs/readme.md', 'src/unchanged.rs'].includes(path));
    assert.equal(changedPaths.length, 16, 'the comparison includes every changed file');
    const reviewPaths = () => page.locator('.pierre-review-host .review-file-collapse').evaluateAll(buttons =>
      buttons.map(button => button.getAttribute('aria-label').replace(/^(Collapse|Expand) /, '')));
    assert.deepEqual(await reviewPaths(), changedPaths);
    assert.ok(changedPaths.indexOf('src/file-2.rs') < changedPaths.indexOf('src/file-10.rs'));
    assert.ok(changedPaths.indexOf('src/nested/file-2.rs') < changedPaths.indexOf('src/A.rs'),
      'nested directories appear before sibling files');
    assert.ok(changedPaths.indexOf('src/A.rs') < changedPaths.indexOf('src/a.rs'));
    assert.ok(changedPaths.indexOf('tests/check.rs') < changedPaths.indexOf('Cargo.toml'),
      'root directories appear before root files');
    await page.getByRole('button', { name: 'Changed files only', exact: true }).click();
    assert.deepEqual(await reviewPaths(), changedPaths, 'tree filtering leaves the review order stable');
    await page.getByRole('treeitem', { name: 'src', exact: true }).click();
    await page.getByRole('button', { name: 'Collapse src/file-10.rs', exact: true }).waitFor();
    assert.deepEqual(await reviewPaths(), changedPaths.filter(path => path.startsWith('src/')));
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

for (const [label, engine] of [['Chromium', chromium], ['Firefox', firefox]]) {
  test(`${label}: large reviews virtualize and keep one scroll pane through layout, theme and font changes`, { timeout: 60000 }, async () => {
    const browser = await engine.launch();
    try {
      const context = await browser.newContext({ viewport: { width: 1920, height: 900 } });
      await fixture(context, true);
      const page = await context.newPage();
      page.setDefaultTimeout(8000);
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(`${base}/crate/${name}/1.0.0/1.0.1?view=changes&scope=src%2Fmany%2F`);
      await checkLayout(page, false);
      assert.equal((await page.locator('.review-totals').innerText()).replace(/\s+/g, ' '), '100 files +100 −100');
      assert.equal(await page.locator('.pierre-review-host [data-additions-count]').count(), 0,
        'the custom header counts replace Pierre counts so numbers are not duplicated');
      assert.ok(await page.locator('.pierre-review-host diffs-container').count() < 30,
        'a long review only mounts files near the viewport');
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      await page.evaluate(() => {
        window.CrateSettings.set('mode', 'dark');
        window.CrateSettings.set('fontSize', '18');
        window.CrateSettings.set('darkTheme', 'pierre-dark');
      });
      await page.getByRole('button', { name: 'Done', exact: true }).click();
      await page.getByRole('button', { name: 'Split view', exact: true }).click();
      await checkLayout(page, true);
      await page.getByRole('button', { name: 'Show all lines', exact: true }).click();
      await page.getByRole('button', { name: 'Hide file sidebar', exact: true }).click();
      await page.locator('.pierre-review-host').evaluate(host => host.scrollTop = host.scrollHeight);
      await page.getByRole('button', { name: 'Collapse src/many/file-099.rs', exact: true }).waitFor();
      await page.getByRole('button', { name: 'Show all lines', exact: true }).click();
      for (const width of [1800, 950, 640, 390, 320]) {
        await page.setViewportSize({ width, height: 844 });
        await page.waitForTimeout(100);
        const frame = await page.evaluate(() => {
          const host = document.querySelector('.pierre-review-host');
          return {
            width: innerWidth, height: innerHeight, pageWidth: document.documentElement.scrollWidth,
            pageHeight: document.documentElement.scrollHeight, host: host.getBoundingClientRect().toJSON(),
          };
        });
        assert.equal(frame.pageWidth, frame.width, 'review controls and filenames do not widen the page');
        assert.ok(frame.pageHeight <= frame.height + 1, 'only the review pane scrolls vertically');
        assert.ok(frame.host.height > 100 && frame.host.right <= frame.width + 1);
      }
      await page.goto(`${base}/crate/${name}/1.0.0/1.0.1/src/many/file-099.rs?view=changes&scope=src%2Fmany%2F`);
      await page.getByRole('button', { name: 'Hide file sidebar', exact: true }).click();
      await page.getByRole('button', { name: 'Collapse src/many/file-099.rs', exact: true }).waitFor();
      await page.waitForFunction(() => document.querySelector('.pierre-review-host').scrollTop > 0);
      await checkLayout(page, true);
      assert.deepEqual(errors, []);
    } finally { await browser.close(); }
  });

  test(`${label}: long whitespace and unbroken tokens wrap in single-file and virtualized reviews`, { timeout: 60000 }, async () => {
    const browser = await engine.launch();
    try {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const longSource = marker =>
        `pub fn long_line() { let value = 1;${' '.repeat(1000)}println!("${marker}"); }\n` +
        `const LONG_${'X'.repeat(400)}_END: u8 = 0;\n`;
      await fixture(context, true, false, version => ({
        'src/wrapped.rs': longSource(`visible_tail_${version.replaceAll('.', '_')}`),
        'src/unchanged-wrapped.rs': longSource('source_tail'),
      }));
      const page = await context.newPage();
      page.setDefaultTimeout(8000);
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(`${base}/crate/${name}/1.0.0/1.0.1/src/wrapped.rs`);
      await page.getByRole('button', { name: 'Hide file sidebar', exact: true }).click();

      async function assertWrapped(host, marker) {
        const line = page.locator(`${host} [data-line]`).filter({ hasText: marker }).last();
        await line.waitFor({ state: 'attached' });
        const geometry = await line.evaluate((line, marker) => {
          const code = line.closest('[data-content]');
          const pre = line.closest('pre');
          const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
          let node;
          while ((node = walker.nextNode())) {
            const index = node.textContent.indexOf(marker);
            if (index < 0) continue;
            const range = document.createRange();
            range.setStart(node, index);
            range.setEnd(node, index + marker.length);
            return {
              overflow: pre.dataset.overflow,
              width: pre.clientWidth, scrollWidth: pre.scrollWidth,
              content: code.getBoundingClientRect().toJSON(),
              tail: [...range.getClientRects()].map(rect => rect.toJSON()),
              height: line.getBoundingClientRect().height,
              lineHeight: parseFloat(getComputedStyle(line).lineHeight),
            };
          }
          return null;
        }, marker);
        assert.ok(geometry, 'the text at the far end of the source line is rendered');
        assert.equal(geometry.overflow, 'wrap');
        assert.ok(geometry.scrollWidth <= geometry.width + 1, 'code does not require horizontal scrolling');
        assert.ok(geometry.height > geometry.lineHeight, 'the logical source line occupies multiple visual rows');
        assert.ok(geometry.tail.every(rect =>
          rect.left >= geometry.content.left - 1 && rect.right <= geometry.content.right + 1),
        'text after long whitespace stays within its code column');
      }

      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 900 });
        for (const split of [false, true]) {
          const layout = page.getByRole('button', { name: 'Split view', exact: true });
          if ((await layout.getAttribute('aria-pressed')) !== String(split)) await layout.click();
          await assertWrapped('.pierre-diff-host', 'visible_tail_1_0_1');
          await assertWrapped('.pierre-diff-host', '_END');
          await page.getByRole('button', { name: 'Show all changes', exact: true }).click();
          await checkLayout(page, split);
          await assertWrapped('.pierre-review-host', 'visible_tail_1_0_1');
          await assertWrapped('.pierre-review-host', '_END');
          await page.getByRole('button', { name: 'Show all changes', exact: true }).click();
        }
      }
      await page.getByRole('button', { name: 'Show file sidebar', exact: true }).click();
      await page.getByRole('button', { name: 'Search files', exact: true }).click();
      await page.getByRole('searchbox', { name: 'Search files', exact: true }).fill('unchanged-wrapped.rs');
      await page.getByRole('treeitem', { name: 'unchanged-wrapped.rs', exact: true }).click();
      await page.getByRole('button', { name: 'Hide file sidebar', exact: true }).click();
      await assertWrapped('.pierre-diff-host', 'source_tail');
      await assertWrapped('.pierre-diff-host', '_END');
      assert.deepEqual(errors, []);
    } finally { await browser.close(); }
  });
}
