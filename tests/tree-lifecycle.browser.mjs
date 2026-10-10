import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { gzipSync } from 'node:zlib';
import { chromium } from 'playwright';
import { bundledThemesInfo } from 'shiki/themes';
import { normalizeTheme } from 'shiki/core';
import { DIFF_THEMES } from '../js/settings-values.js';

const base = process.env.TEST_BASE_URL ?? 'http://127.0.0.1:8080';
const name = 'tree-lifecycle';
const homeTitle = 'Crate Diff - View diffs between Rust crate versions';

async function checkCompactHeader(page) {
  const frame = await page.evaluate(() => {
    const box = selector => document.querySelector(selector)?.getBoundingClientRect().toJSON();
    const context = document.createElement('canvas').getContext('2d');
    const versionTextWidths = [...document.querySelectorAll('.version-controls select')].map(select => {
      const style = getComputedStyle(select);
      context.font = style.font;
      return context.measureText(select.selectedOptions[0].text).width +
        parseFloat(style.paddingLeft) + parseFloat(style.paddingRight) +
        parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth);
    });
    return {
      width: innerWidth, header: box('header'), brand: box('.brand'),
      settings: box('.settings-trigger'),
      search: box('#header-search'), crate: box('.header-crate'),
      old: box('#old-version'), next: box('#new-version'),
      versionTextWidths,
    };
  });
  if (frame.width > 950) return;
  assert.ok(frame.header.height <= 110, 'compact header uses at most two rows');
  assert.ok(Math.abs(frame.brand.top + frame.brand.height / 2 - (frame.settings.top + frame.settings.height / 2)) <= 1);
  if (frame.search) {
    assert.ok(frame.search.top >= frame.settings.bottom, 'search stays below the logo row');
  } else {
    assert.ok(frame.header.height <= 57, 'home header stays on one row without search');
  }
  for (const control of [frame.brand, frame.settings, frame.search, frame.crate, frame.old, frame.next].filter(Boolean)) {
    assert.ok(control.left >= 0 && control.right <= frame.width, 'header controls stay inside the viewport');
  }
  if (frame.crate) {
    assert.ok(frame.crate.left >= frame.brand.right && frame.crate.right <= frame.settings.left,
      'crate identity fits between the logo and utility icons');
    assert.ok(Math.abs(frame.crate.top + frame.crate.height / 2 - (frame.settings.top + frame.settings.height / 2)) <= 1);
    assert.equal(frame.old.top, frame.next.top, 'versions share a row');
    assert.equal(frame.search.bottom, frame.old.bottom, 'search and version inputs align');
    assert.ok(frame.old.right < frame.next.left && frame.next.right <= frame.search.left,
      'version selectors precede search without overlapping');
    assert.ok(frame.old.width <= 126 && frame.next.width <= 126, 'mobile selectors stay compact');
    assert.ok(frame.old.width >= frame.versionTextWidths[0] && frame.next.width >= frame.versionTextWidths[1],
      'selected version numbers remain fully readable');
  }
}

test('home keeps discovery lists intact and searches the registry only on Enter', { timeout: 30000 }, async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const krate = id => ({
      id, max_version: '1.0.0', description: `The ${id} crate.`,
      downloads: 10, repository: null, documentation: null,
    });
    await page.route('https://crates.io/api/v1/summary', route => route.fulfill({
      json: { most_downloaded: [krate('serde')], just_updated: [krate('tokio')] },
      headers: { 'access-control-allow-origin': '*' },
    }));
    const searches = [];
    await page.route(/^https:\/\/crates.io\/api\/v1\/crates\?/, route => {
      const query = new URL(route.request().url()).searchParams.get('q');
      searches.push(query);
      return route.fulfill({
        json: { crates: [krate(query)], meta: { total: 1 } },
        headers: { 'access-control-allow-origin': '*' },
      });
    });
    await page.goto(base);
    await page.locator('.summary .card').first().waitFor();
    for (const width of [950, 768, 640, 390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await checkCompactHeader(page);
    }
    assert.equal(await page.getByRole('link', { name: 'serde', exact: true }).getAttribute('href'), '/crate/serde');
    assert.equal(await page.getByRole('link', { name: 'tokio', exact: true }).getAttribute('href'), '/crate/tokio');
    assert.equal(await page.locator('header a[href="/search"]').count(), 0);
    const discoveryLists = await page.locator('.summary').innerText();
    const search = page.getByRole('searchbox', { name: 'Search crates.io', exact: true });
    assert.equal(await page.locator('header form[role="search"]').count(), 0);
    assert.equal(await page.locator('.home-page form[role="search"]').count(), 1);
    assert.equal(await page.locator('.home-page form[role="search"] button').count(), 0);
    assert.equal(await page.getByRole('searchbox').count(), 1, 'home uses only its central search');
    await search.fill('not-listed');
    // Allow longer than the registry page's debounce to catch accidental
    // search-on-type as well as local filtering.
    await page.waitForTimeout(650);
    assert.equal(await page.locator('.summary').innerText(), discoveryLists);
    assert.equal(new URL(page.url()).pathname, '/');
    assert.deepEqual(searches, []);
    await search.press('Enter');
    await page.waitForURL('**/search/not-listed');
    await page.getByRole('heading', { name: 'Results for “not-listed”', exact: true }).waitFor();
    assert.equal(await page.locator('header form[role="search"]').count(), 1,
      'header search returns when leaving home');
    assert.equal(await page.locator('.search-results .card h3').innerText(), 'not-listed');
    assert.equal(await page.getByRole('link', { name: 'not-listed', exact: true }).getAttribute('href'), '/crate/not-listed');
    assert.deepEqual(searches, ['not-listed']);
    await page.getByRole('link', { name: 'Crate Diff', exact: true }).click();
    await page.locator('.summary .card').first().waitFor();
    assert.equal(await page.locator('.summary').innerText(), discoveryLists);
    assert.equal(await search.inputValue(), '');
    assert.equal(await page.locator('header form[role="search"]').count(), 0,
      'header search disappears when returning home');
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

// Checksummed tar.gz fixtures exercise the real archive loader without relying
// on registry availability or particular published releases.
function archive(version, large = false) {
  const files = {
    'Cargo.toml': `[package]\nname = "${name}"\nversion = "${version}"\n`,
    'src/lib.rs': `pub const VERSION: &str = "${version}";\n`,
    'src/nested/deep/module.rs': `pub const NESTED_VERSION: &str = "${version}";\n`,
    'README.md': 'Unchanged documentation.\n',
    [`src/release-${version}.rs`]: '// Release-specific file.\n',
  };
  if (large) {
    files['src/lib.rs'] = Array.from({ length: 400 }, (_, index) =>
      `pub const VALUE_${index}: &str = "${version}";\n`).join('');
    for (let index = 0; index < 120; index++) {
      files[`extra-${String(index).padStart(3, '0')}.rs`] = `pub const ITEM: u32 = ${index};\n`;
    }
  }
  const chunks = [];
  for (const [path, contents] of Object.entries(files)) {
    const body = Buffer.from(contents);
    const header = Buffer.alloc(512);
    header.write(`${name}-${version}/${path}`, 0);
    header.write('0000644\0', 100);
    header.write('0000000\0', 108);
    header.write('0000000\0', 116);
    header.write(`${body.length.toString(8).padStart(11, '0')}\0`, 124);
    header.write('00000000000\0', 136);
    header.fill(' ', 148, 156);
    header.write('0', 156);
    header.write('ustar\0', 257);
    header.write('00', 263);
    const checksum = header.reduce((sum, byte) => sum + byte, 0);
    header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148);
    chunks.push(header, body, Buffer.alloc((512 - body.length % 512) % 512));
  }
  return gzipSync(Buffer.concat([...chunks, Buffer.alloc(1024)]));
}

test('short crate links resolve versions under the crate prefix and survive reload', { timeout: 30000 }, async () => {
  const archives = new Map(['1.0.0', '1.0.1', '1.0.2'].map(version => [version, archive(version)]));
  const versions = [...archives].map(([num, bytes]) => ({
    num, checksum: createHash('sha256').update(bytes).digest('hex'), yanked: false,
  }));
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const krate = {
      id: name, max_version: '1.0.2', description: 'A route fixture.',
      downloads: 0, repository: null, documentation: null,
    };
    await page.route('https://crates.io/api/v1/summary', route => route.fulfill({
      json: { most_downloaded: [krate], just_updated: [] },
      headers: { 'access-control-allow-origin': '*' },
    }));
    await page.route(`https://crates.io/api/v1/crates/${name}`, route => route.fulfill({
      json: { crate: krate, versions },
      headers: { 'access-control-allow-origin': '*' },
    }));
    await page.route(`https://static.crates.io/crates/${name}/*`, route => {
      const version = route.request().url().match(/-(\d+\.\d+\.\d+)\.crate$/)[1];
      return route.fulfill({
        body: archives.get(version), contentType: 'application/octet-stream',
        headers: { 'access-control-allow-origin': '*' },
      });
    });
    await page.goto(base);
    const crateLink = page.getByRole('link', { name, exact: true });
    await crateLink.waitFor();
    assert.equal(await crateLink.getAttribute('href'), `/crate/${name}`);
    await crateLink.click();
    await page.waitForURL(`**/crate/${name}/1.0.1/1.0.2`);
    await page.locator('.pierre-diff-host [data-code]').first().waitFor();
    assert.equal(await page.title(), `${name} - Crate Diff`);
    await page.reload();
    await page.locator('.pierre-diff-host [data-code]').first().waitFor();
    assert.equal(new URL(page.url()).pathname, `/crate/${name}/1.0.1/1.0.2`);
    assert.equal(await page.title(), `${name} - Crate Diff`);
  } finally {
    await browser.close();
  }
});

test('tree stays in its sidebar through downloads, cached versions and navigation', { timeout: 60000 }, async () => {
  const archives = new Map(['1.0.0', '1.0.1', '1.0.2'].map(version => [version, archive(version)]));
  const versions = [...archives].map(([num, bytes]) => ({
    num, checksum: createHash('sha256').update(bytes).digest('hex'), yanked: false,
  }));
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      storageState: {
        cookies: [],
        origins: [{
          origin: new URL(base).origin,
          localStorage: [{ name: 'crate-diff.settings', value: JSON.stringify({ codeWidth: 'standard' }) }],
        }],
      },
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route(`https://crates.io/api/v1/crates/${name}`, route => route.fulfill({
      json: { crate: { id: name, max_version: '1.0.2', downloads: 0 }, versions },
      headers: { 'access-control-allow-origin': '*' },
    }));
    let downloads = 0;
    await page.route(`https://static.crates.io/crates/${name}/*`, async route => {
      downloads++;
      const version = route.request().url().match(/-(\d+\.\d+\.\d+)\.crate$/)[1];
      await new Promise(resolve => setTimeout(resolve, 100));
      await route.fulfill({
        body: archives.get(version),
        contentType: 'application/octet-stream',
        headers: { 'access-control-allow-origin': '*' },
      });
    });

    async function checkTree(checkVersions = true) {
      const compared = new URL(page.url()).pathname.split('/').slice(3, 5);
      if (checkVersions) await page.waitForFunction(({ compared, versions }) => {
        const root = document.querySelector('.file-tree-host file-tree-container[data-file-tree-virtualized]')?.shadowRoot;
        if (!root) return false;
        return versions.every(version =>
          Boolean(root.querySelector(`[data-item-path="src/release-${version}.rs"]`)) === compared.includes(version));
      }, { compared, versions: [...archives.keys()] });
      await page.locator('.pierre-diff-host [data-code]').first().waitFor();
      await page.locator('.file-tree-host [role="treeitem"]').first().waitFor();
      const geometry = await page.locator('.file-tree-host').evaluate(host => {
        const containers = host.querySelectorAll('file-tree-container');
        const tree = containers[0];
        return {
          count: containers.length,
          total: document.querySelectorAll('file-tree-container').length,
          top: tree.getBoundingClientRect().top,
          hostTop: host.getBoundingClientRect().top,
          height: tree.getBoundingClientRect().height,
          hostHeight: host.getBoundingClientRect().height,
        };
      });
      assert.equal(geometry.count, 1, 'an empty old container must not precede the current tree');
      assert.equal(geometry.total, 1, 'only one tree should remain mounted');
      assert.ok(Math.abs(geometry.top - geometry.hostTop) < 1, 'tree must start at the top of its host');
      assert.ok(Math.abs(geometry.height - geometry.hostHeight) < 1, 'tree must fit its host');
      assert.equal(await page.title(), `${name} - Crate Diff`);
      const identical = compared[0] === compared[1];
      assert.deepEqual(await page.locator('.file-sidebar .comparison-summary span').allTextContents(),
        identical ? ['0 changed files', '+0', '−0', 'lines'] : ['5 changed files', '+4', '−4', 'lines']);
    }

    await page.goto(`${base}/crate/${name}/1.0.0/1.0.1/src/lib.rs`);
    await checkTree();
    assert.equal(await page.locator('.file-sidebar .comparison-summary').count(), 1);
    assert.equal(await page.locator('footer').count(), 0);
    assert.equal(await page.locator('header a[href="https://crates.io"]').count(), 0);
    assert.equal(await page.locator('.tree-legend').count(), 0);
    assert.equal(downloads, 2);
    assert.equal(await page.getByRole('treeitem', { name: 'lib.rs', exact: true })
      .evaluate(element => element.getBoundingClientRect().height), 24);
    const diffLayout = page.getByRole('button', { name: 'Split view', exact: true });
    assert.equal(await diffLayout.count(), 1, 'a single button toggles between layouts');
    assert.equal(await diffLayout.innerText(), '', 'the layout toggle only shows an icon');
    assert.equal(await diffLayout.locator('svg[aria-hidden="true"]').count(), 1);
    assert.equal(await diffLayout.getAttribute('aria-pressed'), 'false');
    assert.equal(await diffLayout.getAttribute('title'), 'Switch to split view');
    const stackedIcon = await diffLayout.locator('path').first().getAttribute('d');
    await page.locator('.pierre-diff-host [data-diff-type="single"]').waitFor();
    const layoutUrl = page.url();
    const layoutRenderer = await page.locator('diffs-container').elementHandle();
    const allLines = page.getByRole('button', { name: 'Show all lines', exact: true });
    assert.equal(await allLines.innerText(), '', 'the full-context toggle only shows an icon');
    assert.equal(await allLines.locator('svg[aria-hidden="true"]').count(), 1);
    assert.equal(await allLines.getAttribute('title'), 'Show all lines');
    assert.equal(await allLines.getAttribute('aria-pressed'), 'false');
    await allLines.click();
    assert.equal(await allLines.getAttribute('aria-pressed'), 'true');
    await diffLayout.click();
    await page.locator('.pierre-diff-host [data-diff-type="split"]').waitFor();
    assert.equal(await diffLayout.getAttribute('aria-pressed'), 'true');
    assert.equal(await diffLayout.getAttribute('title'), 'Switch to stacked view');
    assert.notEqual(await diffLayout.locator('path').first().getAttribute('d'), stackedIcon);
    assert.equal(await page.locator('.pierre-diff-host [data-code]').count(), 2,
      'Split renders both code columns');
    assert.equal(await allLines.getAttribute('aria-pressed'), 'true', 'layout changes retain expanded context');
    await diffLayout.press('Enter');
    await page.locator('.pierre-diff-host [data-diff-type="single"]').waitFor();
    assert.equal(await diffLayout.getAttribute('aria-pressed'), 'false');
    assert.equal(await diffLayout.getAttribute('title'), 'Switch to split view');
    assert.equal(await diffLayout.locator('path').first().getAttribute('d'), stackedIcon);
    assert.equal(await page.locator('.pierre-diff-host [data-code]').count(), 1,
      'Stacked renders a single code column');
    assert.equal(await page.evaluate(renderer => renderer === document.querySelector('diffs-container'), layoutRenderer), true);
    await layoutRenderer.dispose();
    await allLines.press('Enter');
    assert.equal(await allLines.getAttribute('aria-pressed'), 'false');
    assert.equal(page.url(), layoutUrl);
    assert.equal(downloads, 2, 'layout changes reuse the downloaded sources');
    const searchToggle = page.getByRole('button', { name: 'Search files', exact: true });
    const fileSearch = page.getByRole('searchbox', { name: 'Search files', exact: true });
    assert.equal(await fileSearch.count(), 0, 'search starts hidden');
    await searchToggle.click();
    await page.waitForFunction(() => document.activeElement?.id === 'file-filter');
    await fileSearch.fill('not-a-file');
    await page.getByText('No files match these filters.', { exact: true }).waitFor();
    await searchToggle.click();
    assert.equal(await fileSearch.count(), 0);
    await checkTree();
    await searchToggle.click();
    await fileSearch.fill('module.rs');
    await page.getByRole('treeitem', { name: 'module.rs', exact: true }).waitFor();
    const hideSidebar = page.getByRole('button', { name: 'Hide file sidebar', exact: true });
    const showSidebar = page.getByRole('button', { name: 'Show file sidebar', exact: true });
    const treeBeforeHide = await page.locator('file-tree-container').elementHandle();
    const diffBeforeHide = await page.locator('diffs-container').elementHandle();
    const panelWidth = await page.locator('.file-panel').evaluate(element => element.getBoundingClientRect().width);
    const selectedUrl = page.url();
    await hideSidebar.press('Enter');
    await showSidebar.waitFor();
    assert.equal(await page.locator('.file-sidebar').isHidden(), true);
    assert.equal(await showSidebar.getAttribute('aria-expanded'), 'false');
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Show file sidebar');
    assert.ok(await page.locator('.file-panel').evaluate(element => element.getBoundingClientRect().width) > panelWidth + 250);
    assert.equal(page.url(), selectedUrl);
    await showSidebar.press('Enter');
    await hideSidebar.waitFor();
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Hide file sidebar');
    assert.equal(await hideSidebar.getAttribute('aria-expanded'), 'true');
    assert.equal(await fileSearch.inputValue(), 'module.rs', 'hiding preserves the filter');
    await page.getByRole('treeitem', { name: 'module.rs', exact: true }).waitFor();
    assert.equal(await page.evaluate(({ tree, diff }) =>
      tree === document.querySelector('file-tree-container') &&
      diff === document.querySelector('diffs-container'), { tree: treeBeforeHide, diff: diffBeforeHide }),
    true, 'visibility changes preserve both renderer instances');
    await treeBeforeHide.dispose();
    await diffBeforeHide.dispose();
    await fileSearch.press('Escape');
    assert.equal(await fileSearch.count(), 0);
    assert.equal(await searchToggle.evaluate(element => document.activeElement === element), true);
    await checkTree();
    assert.equal(await page.getByRole('treeitem', { name: 'nested', exact: true }).count(), 1);
    const collapse = page.getByRole('button', { name: 'Collapse folders', exact: true });
    const srcFolder = page.getByRole('treeitem', { name: 'src', exact: true });
    const nestedFolder = page.getByRole('treeitem', { name: 'nested', exact: true });
    const deepFolder = page.getByRole('treeitem', { name: 'deep', exact: true });
    const moduleFile = page.getByRole('treeitem', { name: 'module.rs', exact: true });
    await collapse.click();
    await moduleFile.waitFor({ state: 'hidden' });
    assert.equal(await srcFolder.getAttribute('aria-expanded'), 'false');
    await hideSidebar.click();
    await showSidebar.click();
    assert.equal(await srcFolder.getAttribute('aria-expanded'), 'false', 'hiding preserves closed folders');
    assert.ok(page.url().endsWith('/src/lib.rs'), 'collapse must not change the selected diff');
    await checkTree(false);
    await collapse.click();
    assert.equal(await srcFolder.getAttribute('aria-expanded'), 'false', 'repeated collapse is safe');
    await srcFolder.click();
    await nestedFolder.waitFor();
    assert.equal(await nestedFolder.getAttribute('aria-expanded'), 'false', 'descendants also collapse');
    await nestedFolder.click();
    await deepFolder.waitFor();
    assert.equal(await deepFolder.getAttribute('aria-expanded'), 'false');
    await deepFolder.click();
    await page.getByRole('treeitem', { name: 'module.rs', exact: true }).click();
    await page.waitForURL(`**/crate/${name}/1.0.0/1.0.1/src/nested/deep/module.rs`);
    await checkTree();
    await collapse.press('Enter');
    await moduleFile.waitFor({ state: 'hidden' });
    assert.ok(page.url().endsWith('/src/nested/deep/module.rs'));
    await srcFolder.click();
    await page.getByRole('treeitem', { name: 'lib.rs', exact: true }).click();
    await page.waitForURL(`**/crate/${name}/1.0.0/1.0.1/src/lib.rs`);
    // The deep subtree stays closed until opened again or navigated to.
    await nestedFolder.click();
    await deepFolder.click();
    await checkTree();
    assert.equal(downloads, 2, 'collapse must not download archives');
    await hideSidebar.click();
    await page.locator('#new-version').selectOption('1.0.2');
    await page.waitForURL(`**/crate/${name}/1.0.0/1.0.2/src/lib.rs`);
    await page.locator('.pierre-diff-host [data-code]').filter({ hasText: '1.0.2' }).first().waitFor();
    assert.equal(await page.locator('.file-sidebar').isHidden(), true, 'version changes preserve sidebar visibility');
    await showSidebar.click();
    await checkTree();
    assert.equal(downloads, 3, 'version change must exercise an uncached archive');
    assert.equal(await page.getByRole('treeitem', { name: 'release-1.0.2.rs', exact: true }).count(), 1);
    for (const [control, version] of [
      ['#new-version', '1.0.1'],
      ['#old-version', '1.0.2'],
      ['#new-version', '1.0.2'],
      ['#old-version', '1.0.0'],
    ]) {
      await page.locator(control).selectOption(version);
      await checkTree();
    }
    assert.equal(downloads, 3, 'cached comparisons must also replace the tree cleanly');
    await page.getByRole('button', { name: 'Search files', exact: true }).click();
    await page.getByRole('searchbox', { name: 'Search files' }).fill('lib.rs');
    await checkTree(false);
    await collapse.click();
    await checkTree(false);
    assert.equal(await page.getByRole('searchbox', { name: 'Search files' }).inputValue(), 'lib.rs');
    await srcFolder.click();
    assert.equal(await page.locator('.file-tree-host [data-item-type="file"]').count(), 1);
    await page.getByRole('searchbox', { name: 'Search files' }).fill('');
    await searchToggle.click();
    assert.equal(await fileSearch.count(), 0);
    assert.equal(await page.getByRole('treeitem', { name: 'README.md', exact: true }).count(), 1);
    await page.getByRole('button', { name: 'Changed files only', exact: true }).click();
    await checkTree();
    assert.equal(await page.getByRole('button', { name: 'Changed files only', exact: true }).getAttribute('aria-pressed'), 'true');
    assert.equal(await page.getByRole('treeitem', { name: 'README.md', exact: true }).count(), 0);
    const widthOf = selector => page.locator(selector).evaluate(element => element.getBoundingClientRect().width);
    await page.setViewportSize({ width: 2560, height: 1000 });
    assert.equal(await widthOf('main.container'), 1240);
    assert.equal(await widthOf('.nav-content'), 1240, 'Standard header matches the capped workspace width');
    const standardPanelWidth = await widthOf('.file-panel');
    const sidebarWidth = await widthOf('.file-sidebar');
    assert.equal(sidebarWidth, 300);
    const join = await page.locator('.diff-workspace').evaluate(element => ({
      left: element.querySelector('.file-panel').getBoundingClientRect().left,
      right: element.querySelector('.file-sidebar').getBoundingClientRect().right,
    }));
    assert.equal(join.left, join.right, 'the sidebar and diff share a divider without an empty gutter');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const widthButtons = page.getByRole('group', { name: 'Workspace layout', exact: true });
    const appearanceButtons = page.getByRole('group', { name: 'Appearance', exact: true });
    assert.deepEqual(await widthButtons.getByRole('button').allTextContents(), ['Standard', 'Full screen']);
    assert.equal(await widthButtons.getByRole('button', { name: 'Standard', exact: true }).getAttribute('aria-pressed'), 'true');
    await appearanceButtons.getByRole('button', { name: 'Dark', exact: true }).click();
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
    await appearanceButtons.getByRole('button', { name: 'Light', exact: true }).click();
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'light');
    await appearanceButtons.getByRole('button', { name: 'Auto', exact: true }).click();
    await widthButtons.getByRole('button', { name: 'Full screen', exact: true }).click();
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    assert.equal(await widthOf('main.container'), 2560);
    assert.equal(await widthOf('.nav-content'), 2560);
    assert.equal(await widthOf('.file-sidebar'), sidebarWidth);
    assert.ok(await widthOf('.file-panel') > standardPanelWidth + 1000);
    assert.equal(downloads, 3, 'width changes must not load archives');
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('crate-diff.settings')).codeWidth), 'fullscreen');
    const comparisonUrl = page.url();
    const treeBeforeAbout = await page.locator('file-tree-container').elementHandle();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('tab', { name: 'About', exact: true }).click();
    const aboutDialog = page.getByRole('dialog', { name: 'Settings and About', exact: true });
    await aboutDialog.waitFor();
    assert.equal(page.url(), comparisonUrl, 'About opens without navigating away from the diff');
    assert.equal(await page.title(), `${name} - Crate Diff`);
    assert.equal(await page.evaluate(tree => tree === document.querySelector('file-tree-container'), treeBeforeAbout),
      true, 'opening About keeps the renderer mounted');
    await treeBeforeAbout.dispose();
    await aboutDialog.getByRole('link', { name: 'Debug', exact: true }).click();
    await page.getByRole('heading', { name: 'Debug', exact: true }).waitFor();
    assert.equal(await page.locator('file-tree-container').count(), 0);
    assert.equal(await page.title(), 'Debug - Crate Diff');
    assert.equal(await widthOf('main.container'), 1240, 'other pages retain their standard width');
    await page.goBack();
    await checkTree();
    await page.setViewportSize({ width: 390, height: 844 });
    await checkTree();
    assert.equal(await widthOf('main.container'), 390);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.reload();
    await checkTree();
    assert.equal(await fileSearch.count(), 0, 'search stays hidden on fresh load');
    await moduleFile.waitFor();
    await page.setViewportSize({ width: 2560, height: 1000 });
    assert.equal(await widthOf('main.container'), 2560, 'Full screen layout survives reload');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    assert.equal(await widthButtons.getByRole('button', { name: 'Full screen', exact: true }).getAttribute('aria-pressed'), 'true');
    await page.getByRole('button', { name: 'Reset to defaults', exact: true }).click();
    assert.equal(await widthButtons.getByRole('button', { name: 'Full screen', exact: true }).getAttribute('aria-pressed'), 'true');
    assert.equal(await widthOf('main.container'), 2560);
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    const downloadsBeforeDebug = downloads;
    assert.equal(await page.getByRole('link', { name: 'Debug', exact: true }).count(), 0);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('tab', { name: 'About', exact: true }).click();
    await aboutDialog.getByRole('link', { name: 'Debug', exact: true }).click();
    await page.getByRole('heading', { name: 'Debug', exact: true }).waitFor();
    const cacheDump = page.locator('pre[aria-label="Cache dump"]');
    const caches = JSON.parse(await cacheDump.textContent());
    assert.equal(caches.metadata.entry_count, 1);
    assert.equal(caches.metadata.entries[0].crate_name, name);
    assert.deepEqual(caches.metadata.entries[0].versions, ['1.0.2', '1.0.1', '1.0.0']);
    // Reload above starts a new cache containing only the current comparison.
    assert.equal(caches.sources.entry_count, 2);
    assert.deepEqual(caches.sources.entries.map(entry => entry.version), ['1.0.2', '1.0.0']);
    assert.ok(caches.sources.entries.every(entry =>
      entry.crate_name === name && entry.file_count === 5 && entry.bytes > 0));
    assert.equal(caches.metadata.total_bytes, caches.metadata.entries.reduce((sum, entry) => sum + entry.bytes, 0));
    assert.equal(caches.sources.total_bytes, caches.sources.entries.reduce((sum, entry) => sum + entry.bytes, 0));
    assert.equal(caches.total_bytes, caches.metadata.total_bytes + caches.sources.total_bytes);
    assert.equal(await page.title(), 'Debug - Crate Diff');
    assert.notEqual(await page.evaluate(() => getComputedStyle(document.documentElement).overflow), 'hidden');
    assert.equal(downloads, downloadsBeforeDebug, 'diagnostics must not download or evict archives');
    await page.goBack();
    await checkTree();
    assert.equal(downloads, downloadsBeforeDebug, 'cached comparisons remain usable after diagnostics');
    let crateLookups = 0;
    await page.route('https://crates.io/api/v1/crates/another-title', route => {
      crateLookups++;
      return route.fulfill({
        status: 404, json: { errors: [] }, headers: { 'access-control-allow-origin': '*' },
      });
    });
    await page.route(/^https:\/\/crates.io\/api\/v1\/crates\?/, route => route.fulfill({
      json: {
        crates: [{
          id: 'another-title', max_version: '1.0.0', description: 'An exact crate match.',
          downloads: 0, repository: null, documentation: null,
        }],
        meta: { total: 1 },
      },
      headers: { 'access-control-allow-origin': '*' },
    }));
    const headerSearch = page.getByRole('searchbox', { name: 'Search for crates', exact: true });
    assert.equal(await headerSearch.getAttribute('placeholder'), 'Search for crates');
    await headerSearch.fill('another-title');
    assert.ok(new URL(page.url()).pathname.startsWith(`/crate/${name}/`));
    await headerSearch.press('Enter');
    await page.waitForURL('**/search/another-title');
    await page.getByRole('heading', { name: 'Results for “another-title”', exact: true }).waitFor();
    assert.equal(await page.title(), homeTitle);
    assert.equal(crateLookups, 0, 'even an exact match opens results before fetching a comparison');
    await page.getByRole('link', { name: 'another-title', exact: true }).click();
    await page.waitForURL('**/crate/another-title');
    await page.waitForFunction(() => document.title === 'another-title - Crate Diff');
    await page.route('https://crates.io/api/v1/summary', route => route.fulfill({
      json: { most_downloaded: [], just_updated: [] },
      headers: { 'access-control-allow-origin': '*' },
    }));
    await page.getByRole('link', { name: 'Crate Diff', exact: true }).click();
    await page.getByRole('heading', { name: 'View diffs for Rust crates.', exact: true }).waitFor();
    assert.equal(await page.title(), homeTitle);
    await page.reload();
    await page.getByRole('heading', { name: 'View diffs for Rust crates.', exact: true }).waitFor();
    assert.equal(await page.title(), homeTitle, 'the home title also applies on a fresh load');
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

test('default full screen fills the viewport below the header and pins the summary inside the sidebar', { timeout: 60000 }, async () => {
  const [oldVersion, newVersion, nextVersion] = ['1.0.227', '1.0.228', '1.0.229'];
  const archives = new Map([oldVersion, newVersion, nextVersion].map(version => [version, archive(version, true)]));
  const versions = [...archives].map(([num, bytes]) => ({
    num, checksum: createHash('sha256').update(bytes).digest('hex'), yanked: false,
  }));
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route(`https://crates.io/api/v1/crates/${name}`, route => route.fulfill({
      json: { crate: { id: name, max_version: nextVersion, downloads: 0 }, versions },
      headers: { 'access-control-allow-origin': '*' },
    }));
    await page.route(`https://static.crates.io/crates/${name}/*`, route => {
      const version = route.request().url().match(/-(\d+\.\d+\.\d+)\.crate$/)[1];
      return route.fulfill({
        body: archives.get(version), contentType: 'application/octet-stream',
        headers: { 'access-control-allow-origin': '*' },
      });
    });
    await page.goto(`${base}/crate/${name}/${oldVersion}/${newVersion}/src/lib.rs`);
    await page.locator('.pierre-diff-host [data-code]').first().waitFor();
    const decoration = await page.getByRole('treeitem', { name: 'lib.rs', exact: true })
      .locator('[data-item-section="decoration"]').textContent();
    assert.ok(decoration.includes('\u00a0\u00a0−'), 'counts must retain a visible nonbreaking gap');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const layout = page.getByRole('group', { name: 'Workspace layout', exact: true });
    assert.equal(await layout.getByRole('button', { name: 'Full screen', exact: true }).getAttribute('aria-pressed'), 'true');
    await page.getByRole('button', { name: 'Done', exact: true }).click();

    async function checkFrame(sidebarOpen = true, expectedLayout = 'fullscreen') {
      await checkCompactHeader(page);
      const frame = await page.evaluate(() => {
        const box = selector => document.querySelector(selector).getBoundingClientRect().toJSON();
        return {
          header: box('header'), summary: box('.comparison-summary'), sidebar: box('.file-sidebar'),
          workspace: box('.diff-workspace'), navigation: box('.nav-content'),
          tree: box('.file-tree-host'), rail: box('.sidebar-rail'), panel: box('.file-panel'), diff: box('.pierre-diff-host'),
          diffLayout: box('.diff-layout-toggle'),
          height: innerHeight, scrollHeight: document.documentElement.scrollHeight,
          width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
          scrollY, layout: document.documentElement.dataset.codeWidth,
        };
      });
      assert.equal(frame.layout, expectedLayout);
      assert.equal(frame.scrollY, 0);
      assert.ok(frame.scrollHeight <= frame.height, 'document must not scroll');
      assert.ok(frame.scrollWidth <= frame.width, 'document must not overflow horizontally');
      assert.equal(frame.header.top, 0);
      assert.ok(Math.abs(frame.workspace.top - frame.header.bottom) <= 1);
      assert.ok(Math.abs(frame.workspace.bottom - frame.height) <= 1);
      assert.ok(Math.abs(frame.diff.bottom - frame.height) <= 1, 'diff reaches the viewport bottom');
      if (expectedLayout === 'standard') {
        const standardWidth = Math.min(1240, frame.width);
        assert.equal(frame.workspace.width, standardWidth);
        assert.equal(frame.workspace.left, (frame.width - standardWidth) / 2,
          'Standard fills smaller screens and centers on wider screens');
        assert.equal(frame.workspace.right, (frame.width + standardWidth) / 2);
        assert.equal(frame.navigation.left, frame.workspace.left, 'header and workspace align on the left');
        assert.equal(frame.navigation.right, frame.workspace.right, 'header and workspace align on the right');
      } else {
        assert.equal(frame.navigation.width, frame.width);
      }
      assert.ok(frame.diff.height > 0);
      assert.ok(frame.diffLayout.left >= frame.panel.left && frame.diffLayout.right <= frame.panel.right,
        'layout buttons fit inside the diff panel on narrow screens');
      if (sidebarOpen) {
        assert.ok(frame.tree.height > 0);
        assert.equal(frame.rail.width, 0);
        assert.ok(frame.summary.height > 0);
        assert.ok(Math.abs(frame.summary.bottom - frame.sidebar.bottom) <= 1, 'summary stays at the sidebar bottom');
        assert.ok(frame.tree.bottom <= frame.summary.top + 1, 'summary sits outside the tree scroll area');
        assert.ok(frame.summary.left >= frame.sidebar.left && frame.summary.right <= frame.sidebar.right);
      } else {
        assert.equal(frame.tree.height, 0);
        assert.equal(frame.summary.height, 0);
        assert.ok(frame.rail.height > 0);
        if (frame.width > 640) {
          assert.equal(frame.rail.width, 36);
          assert.equal(frame.diff.width, frame.workspace.width - 36 - (expectedLayout === 'standard' ? 2 : 0));
        } else {
          assert.equal(frame.diff.width, frame.workspace.width - (expectedLayout === 'standard' ? 2 : 0));
          assert.ok(Math.abs(frame.panel.height - (frame.workspace.height - 35)) <= 1,
            'collapsed mobile tree leaves only the expand strip above the diff panel');
        }
      }
      assert.equal(await page.locator('.file-sidebar .comparison-summary').count(), 1);
      assert.equal(await page.locator('footer').count(), 0);
    }
    await checkFrame();
    const treeScroll = page.locator('file-tree-container [data-file-tree-virtualized-scroll]');
    const diffScroll = page.locator('.pierre-diff-host');
    assert.ok(await treeScroll.evaluate(element => element.scrollHeight > element.clientHeight));
    assert.ok(await diffScroll.evaluate(element => element.scrollHeight > element.clientHeight));
    const treeTarget = await treeScroll.evaluate(element =>
      Math.min(element.scrollTop + 400, element.scrollHeight - element.clientHeight));
    await treeScroll.hover();
    await page.mouse.wheel(0, 400);
    // Selection may have already scrolled the tree. Wait for this wheel's
    // destination before recording the position for the isolation check.
    await page.waitForFunction(target =>
      document.querySelector('file-tree-container').shadowRoot
        .querySelector('[data-file-tree-virtualized-scroll]').scrollTop >= target - 1, treeTarget);
    assert.equal(await diffScroll.evaluate(element => element.scrollTop), 0, 'tree scrolling must not move the diff');
    const treeTop = await treeScroll.evaluate(element => element.scrollTop);
    const diffTarget = await diffScroll.evaluate(element =>
      Math.min(element.scrollTop + 500, element.scrollHeight - element.clientHeight));
    await diffScroll.hover();
    await page.mouse.wheel(0, 500);
    await page.waitForFunction(target =>
      document.querySelector('.pierre-diff-host').scrollTop >= target - 1, diffTarget);
    assert.equal(await treeScroll.evaluate(element => element.scrollTop), treeTop, 'diff scrolling must not move the tree');
    await checkFrame();
    for (const [width, height] of [[2560, 1000], [951, 800], [950, 800], [768, 800], [640, 800], [390, 844], [320, 650]]) {
      await page.setViewportSize({ width, height });
      await checkFrame();
      await page.getByRole('button', { name: 'Hide file sidebar', exact: true }).click();
      await checkFrame(false);
      await page.getByRole('button', { name: 'Show file sidebar', exact: true }).click();
      await treeScroll.waitFor();
      assert.ok(await treeScroll.evaluate(element => element.clientHeight > 0), 'the restored tree receives a usable viewport');
      await checkFrame();
      if (width === 320) {
        await page.getByRole('button', { name: 'Split view', exact: true }).press('Enter');
        await page.locator('.pierre-diff-host [data-diff-type="split"]').waitFor();
        await checkFrame();
        await page.getByRole('button', { name: 'Split view', exact: true }).press('Enter');
        await page.locator('.pierre-diff-host [data-diff-type="single"]').waitFor();
      }
    }
    await page.reload();
    await page.locator('.pierre-diff-host [data-code]').first().waitFor();
    await checkFrame();
    await page.locator('#new-version').selectOption(nextVersion);
    await page.waitForURL(`**/crate/${name}/${oldVersion}/${nextVersion}/src/lib.rs`);
    await page.locator('.pierre-diff-host [data-code]').first().waitFor();
    await checkFrame();
    const comparisonUrl = page.url();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('tab', { name: 'About', exact: true }).click();
    const aboutDialog = page.getByRole('dialog', { name: 'Settings and About', exact: true });
    await aboutDialog.waitFor();
    assert.equal(page.url(), comparisonUrl);
    assert.equal(await page.locator('file-tree-container').count(), 1);
    await aboutDialog.getByRole('button', { name: 'Done', exact: true }).click();
    await checkFrame();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('tab', { name: 'About', exact: true }).click();
    await aboutDialog.getByRole('link', { name: 'Debug', exact: true }).click();
    await page.getByRole('heading', { name: 'Debug', exact: true }).waitFor();
    assert.equal(await page.locator('.comparison-summary').count(), 0, 'route cleanup removes summary');
    assert.notEqual(await page.evaluate(() => getComputedStyle(document.documentElement).overflow), 'hidden');
    await page.goBack();
    await page.locator('.pierre-diff-host [data-code]').first().waitFor();
    await checkFrame();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await layout.getByRole('button', { name: 'Standard', exact: true }).click();
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    for (const [width, height] of [[2560, 1000], [1440, 900], [1304, 900], [1241, 900], [1240, 900], [1239, 900], [951, 800], [950, 800], [768, 800], [641, 800], [640, 800], [390, 844], [320, 650]]) {
      await page.setViewportSize({ width, height });
      await checkFrame(true, 'standard');
      await page.getByRole('button', { name: 'Hide file sidebar', exact: true }).click();
      await checkFrame(false, 'standard');
      await page.getByRole('button', { name: 'Show file sidebar', exact: true }).click();
      await checkFrame(true, 'standard');
      if (width === 320) {
        await page.getByRole('button', { name: 'Split view', exact: true }).press('Enter');
        await page.locator('.pierre-diff-host [data-diff-type="split"]').waitFor();
        await checkFrame(true, 'standard');
        await page.getByRole('button', { name: 'Split view', exact: true }).press('Enter');
        await page.locator('.pierre-diff-host [data-diff-type="single"]').waitFor();
      }
    }
    await page.reload();
    await page.locator('.pierre-diff-host [data-code]').first().waitFor();
    await checkFrame(true, 'standard');
    assert.ok(await treeScroll.evaluate(element => element.scrollHeight > element.clientHeight));
    assert.ok(await diffScroll.evaluate(element => element.scrollHeight > element.clientHeight));
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('tab', { name: 'About', exact: true }).click();
    await aboutDialog.getByRole('link', { name: 'Debug', exact: true }).click();
    await page.getByRole('heading', { name: 'Debug', exact: true }).waitFor();
    assert.equal(await page.locator('.nav-content').evaluate(element => element.getBoundingClientRect().width), 320);
    assert.notEqual(await page.evaluate(() => getComputedStyle(document.documentElement).overflow), 'hidden');
    await page.goBack();
    await page.locator('.pierre-diff-host [data-code]').first().waitFor();
    await checkFrame(true, 'standard');
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

test('all diff schemes render, follow the resolved mode, and preserve both preferences', { timeout: 60000 }, async () => {
  const archives = new Map(['1.0.0', '1.0.1'].map(version => [version, archive(version)]));
  const versions = [...archives].map(([num, bytes]) => ({
    num, checksum: createHash('sha256').update(bytes).digest('hex'), yanked: false,
  }));
  const backgrounds = new Map(await Promise.all(bundledThemesInfo.map(async info => {
    const theme = normalizeTheme((await info.import()).default);
    return [info.id, theme.bg];
  })));
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 }, colorScheme: 'light',
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.route(`https://crates.io/api/v1/crates/${name}`, route => route.fulfill({
      json: { crate: { id: name, max_version: '1.0.1', downloads: 0 }, versions },
      headers: { 'access-control-allow-origin': '*' },
    }));
    let downloads = 0;
    await page.route(`https://static.crates.io/crates/${name}/*`, route => {
      downloads++;
      const version = route.request().url().match(/-(\d+\.\d+\.\d+)\.crate$/)[1];
      return route.fulfill({
        body: archives.get(version), contentType: 'application/octet-stream',
        headers: { 'access-control-allow-origin': '*' },
      });
    });
    await page.goto(`${base}/crate/${name}/1.0.0/1.0.1/src/lib.rs`);
    await page.locator('.pierre-diff-host [data-code]').first().waitFor();
    const comparisonUrl = page.url();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const appearance = page.getByRole('group', { name: 'Appearance', exact: true });
    const selector = page.locator('#settings-diff-theme');
    const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('crate-diff.settings')));
    async function checkOptions(mode) {
      await page.getByRole('combobox', { name: `${mode === 'dark' ? 'Dark' : 'Light'} diff scheme`, exact: true }).waitFor();
      assert.deepEqual(await selector.locator('option').evaluateAll(options =>
        options.map(option => ({ id: option.value, label: option.textContent }))), DIFF_THEMES[mode]);
      assert.equal(await page.locator('.settings-dialog select[id*="theme"]').count(), 1);
    }
    async function checkRenderedBackground(mode, id) {
      try {
        await page.waitForFunction(({ mode, background }) => {
          const container = document.querySelector('.pierre-diff-host diffs-container');
          if (!container) return false;
          const value = getComputedStyle(container).getPropertyValue(`--diffs-${mode}-bg`).trim();
          if (!value) return false;
          const style = document.createElement('span').style;
          style.color = background;
          const expected = style.color;
          style.color = '';
          style.color = value;
          return style.color === expected;
        }, { mode, background: backgrounds.get(id) }, { timeout: 5000 });
      } catch (error) {
        const rendered = await page.locator('.pierre-diff-host diffs-container').evaluate(container => ({
          css: container.shadowRoot.querySelector('[data-theme-css]')?.textContent,
          code: container.shadowRoot.querySelector('[data-code]')?.textContent,
        }));
        throw new Error(`${id}: expected ${backgrounds.get(id)}; rendered ${JSON.stringify(rendered)}; errors ${JSON.stringify(errors)}`,
          { cause: error });
      }
    }
    await checkOptions('light');
    for (const mode of ['light', 'dark']) {
      await appearance.getByRole('button', { name: mode === 'dark' ? 'Dark' : 'Light', exact: true }).click();
      await checkOptions(mode);
      for (const theme of DIFF_THEMES[mode].slice(1)) {
        await selector.selectOption(theme.id);
        assert.equal(await selector.inputValue(), theme.id);
        await checkRenderedBackground(mode, theme.id);
      }
      await selector.selectOption(mode === 'dark' ? 'dracula' : 'github-light');
    }
    assert.equal((await saved()).lightTheme, 'github-light');
    assert.equal((await saved()).darkTheme, 'dracula');
    await appearance.getByRole('button', { name: 'Light', exact: true }).click();
    await checkOptions('light');
    assert.equal(await selector.inputValue(), 'github-light');
    await selector.selectOption('catppuccin-latte');
    assert.equal((await saved()).darkTheme, 'dracula');
    await appearance.getByRole('button', { name: 'Dark', exact: true }).click();
    await checkOptions('dark');
    assert.equal(await selector.inputValue(), 'dracula');
    assert.equal((await saved()).lightTheme, 'catppuccin-latte');
    await checkRenderedBackground('dark', 'dracula');

    await appearance.getByRole('button', { name: 'Auto', exact: true }).click();
    await checkOptions('light');
    assert.equal(await selector.inputValue(), 'catppuccin-latte');
    await checkRenderedBackground('light', 'catppuccin-latte');
    await page.emulateMedia({ colorScheme: 'dark' });
    await checkOptions('dark');
    assert.equal(await selector.inputValue(), 'dracula');
    await checkRenderedBackground('dark', 'dracula');
    await page.emulateMedia({ colorScheme: 'light' });
    await checkOptions('light');
    assert.equal(await selector.inputValue(), 'catppuccin-latte');
    assert.equal((await saved()).mode, 'auto');
    assert.equal(downloads, 2, 'theme and mode changes must not reload archives');
    assert.equal(page.url(), comparisonUrl);
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await page.reload();
    await page.locator('.pierre-diff-host [data-code]').first().waitFor();
    await checkRenderedBackground('light', 'catppuccin-latte');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await checkOptions('light');
    assert.equal(await selector.inputValue(), 'catppuccin-latte');
    await appearance.getByRole('button', { name: 'Dark', exact: true }).click();
    await checkOptions('dark');
    assert.equal(await selector.inputValue(), 'dracula');

    // A storage event updates the current selector and retains the hidden choice.
    const otherTab = await context.newPage();
    await otherTab.goto(`${base}/debug`);
    await otherTab.evaluate(() => localStorage.setItem('crate-diff.settings', JSON.stringify({
      mode: 'dark', lightTheme: 'one-light', darkTheme: 'nord',
    })));
    await page.waitForFunction(() => document.querySelector('#settings-diff-theme')?.value === 'nord');
    await checkRenderedBackground('dark', 'nord');
    await appearance.getByRole('button', { name: 'Light', exact: true }).click();
    await checkOptions('light');
    assert.equal(await selector.inputValue(), 'one-light');
    assert.equal((await saved()).darkTheme, 'nord');
    await checkRenderedBackground('light', 'one-light');
    await page.getByRole('button', { name: 'Reset to defaults', exact: true }).click();
    await checkOptions('light');
    assert.equal(await selector.inputValue(), 'pierre-light');
    const reset = await page.evaluate(() => window.CrateSettings.snapshot());
    assert.equal(reset.lightTheme, 'pierre-light');
    assert.equal(reset.darkTheme, 'pierre-dark');
    assert.equal(await saved(), null);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
