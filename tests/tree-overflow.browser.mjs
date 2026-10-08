import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from 'playwright';

const base = process.env.TEST_BASE_URL ?? 'http://127.0.0.1:8080';
const longName = kind => `${kind}-with-a-very-long-filename-that-must-truncate-before-the-change-counts-and-status.rs`;
const files = [
  { path: `src/generated/nested/${longName('modified')}`, status: 'modified', added: 12345, removed: 67890 },
  { path: `src/${longName('added')}`, status: 'added', added: 321, removed: 0 },
  { path: `src/${longName('deleted')}`, status: 'deleted', added: 0, removed: 987 },
  { path: `src/${longName('modified-additions')}`, status: 'modified', added: 12, removed: 0 },
  { path: `src/${longName('modified-deletions')}`, status: 'modified', added: 0, removed: 24 },
  { path: 'src/binary.bin', status: 'modified', added: 0, removed: 0 },
  { path: `src/${longName('unchanged')}`, status: 'unchanged', added: 0, removed: 0 },
];

test('long tree filenames preserve nonzero counts and status through resizing and filtering', { timeout: 30000 }, async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('https://crates.io/api/v1/summary', route => route.fulfill({
      json: { most_downloaded: [], just_updated: [] },
      headers: { 'access-control-allow-origin': '*' },
    }));
    await page.goto(base);
    await page.waitForFunction(() => window.Pierre && document.querySelector('main'));
    // Mount the production bridge directly to exercise deeply nested filenames
    // and large counts without tying this regression to archive fixture sizes.
    await page.evaluate(files => {
      const host = document.createElement('div');
      host.id = 'tree-overflow-fixture';
      host.className = 'file-tree-host';
      host.style.cssText = 'width:300px;height:440px;flex:none';
      document.querySelector('main').append(host);
      const fixture = { host, selections: [] };
      fixture.tree = window.Pierre.mountTree(host, JSON.stringify(files), files[0].path,
        path => fixture.selections.push(path));
      window.treeOverflowFixture = fixture;
    }, files);

    async function checkRows(visibleFiles = files) {
      for (const file of visibleFiles) {
        const row = page.getByRole('treeitem', { name: file.path.split('/').at(-1), exact: true });
        await row.waitFor();
        const geometry = await row.evaluate(row => {
          const content = row.querySelector('[data-item-section="content"]');
          const decoration = row.querySelector('[data-item-section="decoration"]');
          const stats = decoration?.querySelector('span');
          const git = row.querySelector('[data-item-section="git"]');
          const bounds = element => element?.getBoundingClientRect().toJSON();
          const context = document.createElement('canvas').getContext('2d');
          const style = getComputedStyle(content);
          context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
          return {
            row: bounds(row), content: bounds(content), decoration: bounds(decoration), git: bounds(git),
            counts: decoration?.textContent ?? '', status: git?.textContent ?? '',
            statsWidth: stats?.clientWidth ?? 0, statsScrollWidth: stats?.scrollWidth ?? 0,
            countParts: [...(stats?.children ?? [])].map(bounds),
            title: stats?.title ?? '',
            labelWidth: context.measureText(row.getAttribute('aria-label')).width,
            contentOverflow: style.overflow,
          };
        });
        const counts = [
          ...(file.added > 0 ? [`+${file.added}`] : []),
          ...(file.removed > 0 ? [`−${file.removed}`] : []),
        ];
        assert.equal(geometry.counts, counts.join('\u00a0\u00a0'));
        assert.equal(geometry.status.trim(), { added: 'A', deleted: 'D', modified: 'M', unchanged: '' }[file.status]);
        assert.ok(geometry.content.width > 0, 'the filename retains space beside the stats');
        if (file.path.includes('very-long')) {
          assert.ok(geometry.content.width < geometry.labelWidth, 'long filenames need truncation');
          assert.equal(geometry.contentOverflow, 'hidden');
        }
        assert.ok(geometry.content.right <= geometry.decoration.left + 1, 'filenames never overlap the counts');
        assert.ok(geometry.decoration.right <= geometry.git.left + 1, 'counts never overlap the status');
        assert.ok(geometry.git.right <= geometry.row.right + 1, 'status stays within the row');
        assert.ok(geometry.statsScrollWidth <= geometry.statsWidth + 1, 'counts are fully visible');
        for (const part of geometry.countParts) {
          assert.ok(part.left >= geometry.decoration.left - 1 && part.right <= geometry.decoration.right + 1,
            'both colored counts fit inside the reserved lane');
        }
        if (counts.length > 0) {
          assert.ok(geometry.title.endsWith(`(${counts.join(' / ')})`), 'tooltips also omit zero counts');
        }
      }
    }

    for (const mode of ['light', 'dark']) {
      await page.evaluate(mode => window.CrateSettings.set('mode', mode), mode);
      for (const width of [300, 270, 288, 240, 390]) {
        await page.evaluate(width => { window.treeOverflowFixture.host.style.width = `${width}px`; }, width);
        await checkRows();
      }
    }
    await page.getByRole('treeitem', { name: longName('added'), exact: true }).click();
    assert.equal(await page.evaluate(() => window.treeOverflowFixture.selections.at(-1)), files[1].path,
      'truncated labels still select the full path');
    await page.evaluate(paths => window.Pierre.updateTree(window.treeOverflowFixture.tree, JSON.stringify(paths), paths[0]),
      files.slice(0, 2).map(file => file.path));
    await checkRows(files.slice(0, 2));
    await page.evaluate(paths => window.Pierre.updateTree(window.treeOverflowFixture.tree, JSON.stringify(paths), paths[0]),
      files.map(file => file.path));
    await checkRows();
    await page.evaluate(() => {
      window.Pierre.cleanUp(window.treeOverflowFixture.tree);
      window.treeOverflowFixture.host.remove();
    });
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
