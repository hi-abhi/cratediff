import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from 'playwright';

const base = process.env.TEST_BASE_URL ?? 'http://127.0.0.1:8080';

test('debug route shows empty caches and saved local storage on a fresh load', { timeout: 30000 }, async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      localStorage.setItem('crate-diff.settings', JSON.stringify({
        mode: 'dark', fontSize: 18, codeWidth: 'wide',
      }));
      localStorage.setItem('font-mono', 'JetBrains Mono');
      localStorage.setItem('html', '<script>throw(1)</script>');
      localStorage.setItem('plain', 'a=b');
    });
    const registryRequests = [];
    await page.route('https://crates.io/**', route => {
      registryRequests.push(route.request().url());
      return route.abort();
    });
    await page.goto(`${base}/debug`);
    await page.getByRole('heading', { name: 'Debug', exact: true }).waitFor();
    const cacheDump = page.locator('pre[aria-label="Cache dump"]');
    const storageDump = page.locator('pre[aria-label="Local storage dump"]');
    const caches = JSON.parse(await cacheDump.textContent());
    assert.equal(caches.metadata.entry_count, 0);
    assert.equal(caches.sources.entry_count, 0);
    assert.equal(caches.total_bytes, 0);
    const storage = JSON.parse(await storageDump.textContent());
    assert.equal(storage.error, null);
    assert.equal(storage.entry_count, 4);
    assert.deepEqual(storage.entries, {
      'crate-diff.settings': {
        mode: 'dark', fontSize: 18, codeWidth: 'fullscreen', lightTheme: 'github-light-default', darkTheme: 'github-dark-default',
      },
      'font-mono': 'JetBrains Mono',
      html: '<script>throw(1)</script>',
      plain: 'a=b',
    });
    assert.equal(await page.locator('.debug-page script').count(), 0, 'stored text must be escaped');
    assert.equal(await page.getByRole('heading', { name: 'Cookies', exact: true }).count(), 0);
    assert.equal(await page.getByRole('link', { name: 'Debug', exact: true }).count(), 0,
      'Debug is only linked inside the closed About modal');
    assert.equal(await page.title(), 'Debug - Crate Diff');
    assert.deepEqual(registryRequests, [], '/debug must not be interpreted as a crate name');
    assert.equal(await page.getByRole('button', { name: 'Refresh dumps', exact: true }).count(), 0);
    assert.deepEqual(await page.locator('.debug-page h2').allTextContents(), ['Local storage', 'Crate caches']);
    await page.setViewportSize({ width: 320, height: 650 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    const blockedPage = await browser.newPage();
    blockedPage.on('pageerror', error => errors.push(error.message));
    await blockedPage.addInitScript(() => Object.defineProperty(window, 'localStorage', {
      get() { throw new Error('Storage access blocked'); },
    }));
    await blockedPage.goto(`${base}/debug`);
    const blockedDump = blockedPage.locator('pre[aria-label="Local storage dump"]');
    await blockedDump.waitFor();
    const blocked = JSON.parse(await blockedDump.textContent());
    assert.match(blocked.error, /Storage access blocked/);
    assert.equal(blocked.entry_count, 0);
    assert.deepEqual(JSON.parse(await cacheDump.textContent()), caches);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
