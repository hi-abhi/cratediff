import { SHIKI_THEMES } from './shiki-themes.js';

// Pierre remains the default; bundled Shiki themes follow in label order.
// The settings UI reads these groups, and the renderer uses their IDs directly.
export const DIFF_THEMES = {
  light: [{ id: 'pierre-light', label: 'Pierre Light' }, ...SHIKI_THEMES.light],
  dark: [{ id: 'pierre-dark', label: 'Pierre Dark' }, ...SHIKI_THEMES.dark],
};
export const FONT_SIZES = [10, 11, 12, 13, 14, 15, 16, 18, 20, 22, 24];
export const DEFAULT_SETTINGS = {
  mode: 'auto',
  fontSize: 12,
  codeWidth: 'fullscreen',
  lightTheme: 'pierre-light',
  darkTheme: 'pierre-dark',
};

export function normalizeSettings(value) {
  const raw = value && typeof value === 'object' ? value : {};
  return {
    mode: ['light', 'dark', 'auto'].includes(raw.mode) ? raw.mode : DEFAULT_SETTINGS.mode,
    fontSize: FONT_SIZES.includes(raw.fontSize) ? raw.fontSize : DEFAULT_SETTINGS.fontSize,
    codeWidth: ['standard', 'fullscreen'].includes(raw.codeWidth) ? raw.codeWidth : DEFAULT_SETTINGS.codeWidth,
    lightTheme: DIFF_THEMES.light.some(theme => theme.id === raw.lightTheme)
      ? raw.lightTheme : DEFAULT_SETTINGS.lightTheme,
    darkTheme: DIFF_THEMES.dark.some(theme => theme.id === raw.darkTheme)
      ? raw.darkTheme : DEFAULT_SETTINGS.darkTheme,
  };
}
