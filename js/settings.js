import { DEFAULT_SETTINGS, DIFF_THEMES, FONT_SIZES, normalizeSettings } from './settings-values.js';
import {
  DEFAULT_MONO_LABEL, MONO_FONTS, detectLocalFonts, normalizeFontLabel,
  probeKnownFonts, stackForLabel,
} from './fonts.js';

const STORAGE_KEY = 'crate-diff.settings';
const FONT_KEY = 'font-mono';
const media = window.matchMedia('(prefers-color-scheme: dark)');
const listeners = new Set();
let settings = { ...DEFAULT_SETTINGS };
let monoFont = DEFAULT_MONO_LABEL;
let detectedFonts = [];
let detecting = false;

function readStorage() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    let storedSettings;
    try {
      storedSettings = JSON.parse(stored ?? 'null');
      settings = normalizeSettings(storedSettings);
    }
    catch { settings = { ...DEFAULT_SETTINGS }; }
    const storedFont = localStorage.getItem(FONT_KEY);
    monoFont = normalizeFontLabel(storedFont);
    if (storedFont && monoFont === DEFAULT_MONO_LABEL) {
      try { localStorage.removeItem(FONT_KEY); }
      catch { /* The invalid preference still resolves to App default. */ }
    }
    if (storedSettings?.codeWidth === 'wide') {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); }
      catch { /* The retired layout still resolves to Full screen this session. */ }
    }
  } catch { /* Keep the in-memory defaults when storage is unavailable. */ }
}

function resolvedMode() {
  return settings.mode === 'auto' ? (media.matches ? 'dark' : 'light') : settings.mode;
}

function applyFont() {
  const stack = stackForLabel(monoFont);
  // The startup script runs in <head>. Use the root until <body> exists,
  // then move the override to the body, leaving the CSS default intact.
  const target = document.body ?? document.documentElement;
  if (document.body) document.documentElement.style.removeProperty('--font-mono');
  if (stack) target.style.setProperty('--font-mono', stack);
  else target.style.removeProperty('--font-mono');
}

function applySettings() {
  const root = document.documentElement;
  const mode = resolvedMode();
  root.dataset.theme = mode;
  root.dataset.themeMode = settings.mode;
  root.dataset.codeWidth = settings.codeWidth;
  root.style.setProperty('--diff-font-size', `${settings.fontSize}px`);
  root.style.setProperty('--diff-line-height', `${Math.ceil(settings.fontSize * 1.65)}px`);
  applyFont();
  document.querySelectorAll('meta[name="theme-color"]').forEach(meta => {
    meta.content = mode === 'dark' ? '#181c22' : '#f7f8fa';
  });
}

function snapshot() {
  return {
    ...settings,
    resolvedMode: resolvedMode(),
    monoFont,
    fonts: [...new Set([...MONO_FONTS, ...detectedFonts, monoFont])],
    fontSizes: FONT_SIZES,
    lightThemes: DIFF_THEMES.light,
    darkThemes: DIFF_THEMES.dark,
    detecting,
  };
}

function notify() {
  applySettings();
  const current = snapshot();
  for (const listener of listeners) listener(current);
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function setSetting(key, value) {
  if (key === 'monoFont') {
    monoFont = normalizeFontLabel(value);
    try {
      if (monoFont === DEFAULT_MONO_LABEL) localStorage.removeItem(FONT_KEY);
      else localStorage.setItem(FONT_KEY, monoFont);
    } catch { /* The setting still applies for this session. */ }
  } else if (Object.hasOwn(DEFAULT_SETTINGS, key)) {
    const next = key === 'fontSize' ? Number(value) : value;
    settings = normalizeSettings({ ...settings, [key]: next });
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); }
    catch { /* The setting still applies for this session. */ }
  }
  notify();
}

function mergeFonts(fonts) {
  detectedFonts = [...new Set([...detectedFonts, ...fonts])];
  notify();
}

readStorage();
applySettings();
document.addEventListener('DOMContentLoaded', applySettings, { once: true });
media.addEventListener('change', notify);
window.addEventListener('storage', event => {
  if (event.key === STORAGE_KEY || event.key === FONT_KEY || event.key === null) {
    readStorage();
    notify();
  }
});

window.CrateSettings = {
  snapshot,
  subscribe,
  getSnapshot: () => JSON.stringify(snapshot()),
  subscribeJson: callback => subscribe(value => callback(JSON.stringify(value))),
  unsubscribe: stop => stop(),
  set: setSetting,
  open(dialog) {
    dialog.showModal();
    probeKnownFonts().then(mergeFonts);
  },
  close: dialog => dialog.close(),
  detectFonts() {
    if (detecting) return;
    detecting = true;
    // Invoke before notifying/rendering so the font-access call is made in
    // the button's original user gesture.
    const request = detectLocalFonts();
    notify();
    request.then(mergeFonts).finally(() => { detecting = false; notify(); });
  },
  reset() {
    settings = { ...DEFAULT_SETTINGS };
    monoFont = DEFAULT_MONO_LABEL;
    try { localStorage.removeItem(STORAGE_KEY); localStorage.removeItem(FONT_KEY); }
    catch { /* Defaults still apply in memory. */ }
    notify();
  },
};
