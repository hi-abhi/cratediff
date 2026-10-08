import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_MONO_LABEL, normalizeFontLabel, quoteFamily, stackForLabel } from '../js/fonts.js';
import { DEFAULT_SETTINGS, DIFF_THEMES, normalizeSettings } from '../js/settings-values.js';
import { bundledThemesInfo } from 'shiki/themes';

test('font labels map to overrides without changing the app default', () => {
  assert.equal(stackForLabel(DEFAULT_MONO_LABEL), '');
  assert.equal(stackForLabel(''), '');
  assert.equal(stackForLabel('System monospace'), 'monospace');
  assert.equal(stackForLabel('JetBrains Mono'), '"JetBrains Mono", ui-monospace, Menlo, Consolas, monospace');
});

test('arbitrary local font names are escaped as a single CSS family', () => {
  assert.equal(quoteFamily('Hack'), 'Hack');
  assert.equal(quoteFamily('123 Font'), '"123 Font"');
  assert.equal(quoteFamily('A"B\\C'), '"A\\"B\\\\C"');
  assert.equal(normalizeFontLabel('bad\nfont'), DEFAULT_MONO_LABEL);
  assert.equal(normalizeFontLabel('a'.repeat(201)), DEFAULT_MONO_LABEL);
});

test('stored preferences recover from unsupported values and preserve valid modes', () => {
  for (const raw of [null, 'bad', [], { mode: 'sepia', fontSize: 500, codeWidth: 'huge', compactFolders: 'true', lightTheme: 'missing', darkTheme: 'pierre-light' }]) {
    assert.deepEqual(normalizeSettings(raw), DEFAULT_SETTINGS);
  }
  assert.deepEqual(normalizeSettings({ mode: 'dark', fontSize: 18, codeWidth: 'standard', compactFolders: true, lightTheme: 'pierre-light', darkTheme: 'pierre-dark' }), {
    ...DEFAULT_SETTINGS, mode: 'dark', fontSize: 18, codeWidth: 'standard',
  });
  assert.deepEqual(normalizeSettings({ codeWidth: 'fullscreen' }), { ...DEFAULT_SETTINGS, codeWidth: 'fullscreen' });
  assert.deepEqual(normalizeSettings({ codeWidth: 'standard' }), { ...DEFAULT_SETTINGS, codeWidth: 'standard' });
  assert.deepEqual(normalizeSettings({ mode: 'dark', fontSize: 18, codeWidth: 'wide', lightTheme: 'github-light', darkTheme: 'dracula' }), {
    ...DEFAULT_SETTINGS, mode: 'dark', fontSize: 18, lightTheme: 'github-light', darkTheme: 'dracula',
  }, 'retired Wide layouts become Full screen without losing other preferences');
});

test('the scheme catalog includes every bundled Shiki theme in its declared appearance', () => {
  for (const mode of ['light', 'dark']) {
    const expected = bundledThemesInfo
      .filter(theme => theme.type === mode)
      .map(theme => ({ id: theme.id, label: theme.displayName }))
      .sort((left, right) => left.label.localeCompare(right.label, 'en'));
    assert.deepEqual(DIFF_THEMES[mode].slice(1), expected);
    assert.equal(new Set(DIFF_THEMES[mode].map(theme => theme.id)).size, DIFF_THEMES[mode].length);
  }
});

test('light and dark preferences remain independent and reject themes for the wrong appearance', () => {
  const saved = normalizeSettings({ mode: 'light', lightTheme: 'github-light', darkTheme: 'dracula' });
  assert.equal(saved.lightTheme, 'github-light');
  assert.equal(saved.darkTheme, 'dracula');
  assert.deepEqual(normalizeSettings({ ...saved, mode: 'dark' }), { ...saved, mode: 'dark' });
  assert.deepEqual(normalizeSettings({ ...saved, mode: 'auto' }), { ...saved, mode: 'auto' });
  assert.deepEqual(normalizeSettings({ lightTheme: 'dracula', darkTheme: 'github-light' }), DEFAULT_SETTINGS);
});

test('all bundled Shiki schemes load with their advertised appearance', async () => {
  await Promise.all(bundledThemesInfo.map(async info => {
    const theme = (await info.import()).default;
    assert.equal(theme.name, info.id);
    assert.equal(theme.type, info.type);
  }));
});
