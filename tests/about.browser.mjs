import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from 'playwright';

const base = process.env.TEST_BASE_URL ?? 'http://127.0.0.1:8080';

test('About opens in place, supports dismissal, and links to Debug on narrow screens', { timeout: 30000 }, async () => {
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
    await page.getByRole('heading', { name: 'View diffs for Rust crates.', exact: true }).waitFor();
    const homeUrl = page.url();
    const homeTitle = await page.title();
    const about = page.getByRole('button', { name: 'About', exact: true });
    const dialog = page.getByRole('dialog', { name: 'About Crate Diff', exact: true });
    assert.equal(await page.locator('header a[href="/about"]').count(), 0);
    assert.equal(await page.getByRole('link', { name: 'Debug', exact: true }).count(), 0);
    assert.equal(await about.locator('svg').count(), 1);
    await about.press('Enter');
    await dialog.waitFor();
    assert.equal(page.url(), homeUrl);
    assert.equal(await page.title(), homeTitle);
    assert.deepEqual(await dialog.locator('.about-body h3').allTextContents(), ['How it works', 'Acknowledgements']);
    assert.equal(await dialog.getByRole('link', { name: 'Debug', exact: true }).getAttribute('href'), '/debug');
    assert.equal(await page.evaluate(() => document.activeElement?.closest('dialog')?.id), 'about-dialog');
    for (let index = 0; index < 8; index++) {
      await page.keyboard.press('Tab');
      assert.ok(await page.evaluate(() =>
        document.activeElement?.closest('dialog')?.id === 'about-dialog' ||
        // Native dialogs allow tabbing to browser controls; then the document
        // reports body as active. Background page controls must stay inert.
        document.activeElement === document.body), 'Tab must not focus the background page');
    }
    await page.locator('#header-search').focus();
    assert.equal(await page.evaluate(() => document.activeElement?.id === 'header-search'), false,
      'the background search stays inert while About is open');
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(await about.evaluate(button => document.activeElement === button), true);
    await about.click();
    await dialog.getByRole('button', { name: 'Close about', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    await about.click();
    await page.mouse.click(10, 10);
    await dialog.waitFor({ state: 'hidden' });
    await about.click();
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });

    await page.setViewportSize({ width: 320, height: 650 });
    await about.click();
    await dialog.waitFor();
    const geometry = await dialog.evaluate(element => {
      const rect = element.getBoundingClientRect();
      const body = element.querySelector('.about-body');
      return {
        left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
        width: innerWidth, height: innerHeight,
        bodyHeight: body.clientHeight, contentHeight: body.scrollHeight,
      };
    });
    assert.ok(geometry.left >= 0 && geometry.right <= geometry.width);
    assert.ok(geometry.top >= 0 && geometry.bottom <= geometry.height);
    assert.ok(geometry.contentHeight > geometry.bodyHeight, 'long modal content scrolls within the viewport');
    for (const control of [
      dialog.getByRole('button', { name: 'Close about', exact: true }),
      dialog.getByRole('link', { name: 'Debug', exact: true }),
    ]) {
      assert.ok(await control.evaluate(element => {
        const rect = element.getBoundingClientRect();
        return rect.top >= 0 && rect.bottom <= innerHeight;
      }), 'modal controls stay visible while the body scrolls');
    }
    await dialog.getByRole('link', { name: 'Debug', exact: true }).click();
    await page.waitForURL('**/debug');
    await page.getByRole('heading', { name: 'Debug', exact: true }).waitFor();
    assert.equal(await dialog.count(), 0, 'the modal closes before navigation');
    assert.equal(await page.title(), 'Debug - Crate Diff');
    await page.goBack();
    await page.getByRole('heading', { name: 'View diffs for Rust crates.', exact: true }).waitFor();
    assert.equal(await dialog.count(), 0);
    assert.equal(await page.title(), homeTitle);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
