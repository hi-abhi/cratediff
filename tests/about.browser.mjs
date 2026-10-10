import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium, firefox } from 'playwright';

const base = process.env.TEST_BASE_URL ?? 'http://127.0.0.1:8080';

test('Settings and About share accessible tabs, dismissal, and a Debug link on narrow screens', { timeout: 30000 }, async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.setDefaultTimeout(5000);
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
    const trigger = page.getByRole('button', { name: 'Settings', exact: true });
    const dialog = page.getByRole('dialog', { name: 'Settings and About', exact: true });
    const settingsTab = dialog.getByRole('tab', { name: 'Settings', exact: true });
    const aboutTab = dialog.getByRole('tab', { name: 'About', exact: true });
    const openAbout = async () => {
      await trigger.click();
      await aboutTab.click();
    };
    assert.equal(await page.locator('header a[href="/about"]').count(), 0);
    assert.equal(await page.locator('.about-trigger, #about-dialog').count(), 0);
    assert.equal(await page.getByRole('link', { name: 'Debug', exact: true }).count(), 0);
    assert.equal(await trigger.locator('svg').count(), 1);
    await trigger.press('Enter');
    await dialog.waitFor();
    assert.equal(await settingsTab.getAttribute('aria-selected'), 'true');
    assert.equal(await aboutTab.getAttribute('tabindex'), '-1');
    await dialog.locator('#settings-font-size').selectOption('14');
    await settingsTab.focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(await aboutTab.getAttribute('aria-selected'), 'true');
    assert.ok(await aboutTab.evaluate(element => document.activeElement === element));
    assert.equal(await dialog.getByRole('tabpanel', { name: 'Settings', exact: true }).count(), 0);
    assert.equal(await dialog.getByRole('tabpanel', { name: 'About', exact: true }).count(), 1);
    assert.equal(await dialog.getByRole('button', { name: 'Reset to defaults', exact: true }).count(), 0);
    await page.keyboard.press('Home');
    assert.equal(await settingsTab.getAttribute('aria-selected'), 'true');
    assert.equal(await dialog.locator('#settings-font-size').inputValue(), '14',
      'settings persist when switching tabs');
    await page.keyboard.press('ArrowLeft');
    assert.equal(await aboutTab.getAttribute('aria-selected'), 'true', 'left arrow wraps to About');
    await page.keyboard.press('ArrowRight');
    assert.equal(await settingsTab.getAttribute('aria-selected'), 'true', 'right arrow wraps to Settings');
    await page.keyboard.press('End');
    assert.equal(await aboutTab.getAttribute('aria-selected'), 'true');
    assert.equal(page.url(), homeUrl);
    assert.equal(await page.title(), homeTitle);
    assert.deepEqual(await dialog.locator('.about-body h3').allTextContents(), ['How it works', 'Acknowledgements']);
    assert.equal(await dialog.getByRole('link', { name: 'Debug', exact: true }).getAttribute('href'), '/debug');
    assert.equal(await page.evaluate(() => document.activeElement?.closest('dialog')?.id), 'settings-dialog');
    for (let index = 0; index < 8; index++) {
      await page.keyboard.press('Tab');
      assert.ok(await page.evaluate(() =>
        document.activeElement?.closest('dialog')?.id === 'settings-dialog' ||
        // Native dialogs allow tabbing to browser controls; then the document
        // reports body as active. Background page controls must stay inert.
        document.activeElement === document.body), 'Tab must not focus the background page');
    }
    await page.locator('.brand').focus();
    assert.equal(await page.locator('.brand').evaluate(element => document.activeElement === element), false,
      'the background navigation stays inert while the dialog is open');
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(await trigger.evaluate(button => document.activeElement === button), true);
    await trigger.click();
    assert.equal(await settingsTab.getAttribute('aria-selected'), 'true', 'opening the dialog starts on Settings');
    await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    await openAbout();
    await page.mouse.click(10, 10);
    await dialog.waitFor({ state: 'hidden' });
    await openAbout();
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });

    await page.setViewportSize({ width: 320, height: 420 });
    await openAbout();
    await dialog.waitFor();
    const geometry = await dialog.evaluate(element => {
      const rect = element.getBoundingClientRect();
      const body = element.querySelector('.settings-panels');
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
      dialog.getByRole('button', { name: 'Close dialog', exact: true }),
      aboutTab,
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

for (const browserType of [chromium, firefox]) {
  test(`${browserType.name()}: native font selection cannot dismiss Settings as a backdrop click`, { timeout: 30000 }, async () => {
    const browser = await browserType.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      page.setDefaultTimeout(5000);
      await page.route('https://crates.io/api/v1/summary', route => route.fulfill({
        json: { most_downloaded: [], just_updated: [] },
        headers: { 'access-control-allow-origin': '*' },
      }));
      await page.goto(base);
      const trigger = page.getByRole('button', { name: 'Settings', exact: true });
      const dialog = page.getByRole('dialog', { name: 'Settings and About', exact: true });
      await trigger.click();
      const font = dialog.locator('#settings-mono-font');
      await font.click();
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Enter');
      assert.equal(await font.inputValue(), 'System monospace');
      assert.equal(await dialog.isVisible(), true, 'native selection keeps the dialog open');
      assert.equal(await page.evaluate(() => localStorage.getItem('font-mono')), 'System monospace');

      // Native picker clicks may bubble from selects/options with coordinates
      // that fall outside the modal. Replay that event shape independently of
      // the operating system's dropdown popup.
      for (const select of await dialog.locator('select').all()) {
        await select.dispatchEvent('click', { clientX: 0, clientY: 0 });
        assert.equal(await dialog.isVisible(), true, 'select clicks are not backdrop clicks');
        await select.locator('option').first().dispatchEvent('click', { clientX: 0, clientY: 0 });
        assert.equal(await dialog.isVisible(), true, 'option clicks are not backdrop clicks');
      }
      assert.equal(await font.inputValue(), 'System monospace');
      const rect = await dialog.boundingBox();
      await page.mouse.click(rect.x + rect.width / 2, rect.y + 1);
      assert.equal(await dialog.isVisible(), true, 'clicking dialog padding is not a backdrop click');
      await page.mouse.click(10, 10);
      await dialog.waitFor({ state: 'hidden' });
      await trigger.click();
      assert.equal(await font.inputValue(), 'System monospace');
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'hidden' });
    } finally {
      await browser.close();
    }
  });
}
