export const DEFAULT_MONO_LABEL = 'App default';
export const SYSTEM_MONO_LABEL = 'System monospace';
export const MONO_FONTS = [DEFAULT_MONO_LABEL, SYSTEM_MONO_LABEL];
const MONO_FALLBACK = 'ui-monospace, Menlo, Consolas, monospace';
const CANDIDATES = [
  'Monaco', 'Menlo', 'Consolas',
  'JetBrains Mono', 'Fira Code', 'Source Code Pro', 'Cascadia Code', 'SF Mono',
  'Roboto Mono', 'IBM Plex Mono', 'Hack', 'Inconsolata', 'Ubuntu Mono',
  'DejaVu Sans Mono', 'Anonymous Pro', 'Berkeley Mono', 'Berkeley Mono Variable',
];
const BASELINES = ['monospace', 'serif', 'sans-serif'];
const PROBE_TEXT = 'mmmmmmmmmmlli WwXx 0123456789';
let candidatePromise;
let localPromise;

export function normalizeFontLabel(value) {
  if (typeof value !== 'string') return DEFAULT_MONO_LABEL;
  const label = value.trim();
  return label && label.length <= 200 && !/[\u0000-\u001f\u007f]/.test(label)
    ? label : DEFAULT_MONO_LABEL;
}

export function quoteFamily(name) {
  if (/^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(name)) return name;
  return `"${name.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export function stackForLabel(label) {
  label = normalizeFontLabel(label);
  if (label === DEFAULT_MONO_LABEL) return '';
  if (label === SYSTEM_MONO_LABEL) return 'monospace';
  return `${quoteFamily(label)}, ${MONO_FALLBACK}`;
}

function context() {
  if (typeof document === 'undefined') return null;
  return document.createElement('canvas').getContext('2d');
}

function installedCandidates() {
  const ctx = context();
  if (!ctx) return [];
  const measure = family => {
    ctx.font = `72px ${family}`;
    return ctx.measureText(PROBE_TEXT).width;
  };
  const widths = BASELINES.map(measure);
  return CANDIDATES.filter(name => BASELINES.some(
    (base, index) => measure(`${quoteFamily(name)}, ${base}`) !== widths[index],
  ));
}

function monospaceFamilies(families) {
  const ctx = context();
  if (!ctx) return [];
  return families.filter(name => {
    ctx.font = `72px ${quoteFamily(name)}, monospace`;
    return ctx.measureText('i'.repeat(20)).width === ctx.measureText('W'.repeat(20)).width;
  });
}

// Cheap baseline options are always available. Probe curated fonts only once,
// after the settings dialog opens; this path never requests font permissions.
export function probeKnownFonts() {
  candidatePromise ??= (async () => {
    try {
      if (typeof document === 'undefined') return [];
      await document.fonts?.ready;
      return installedCandidates();
    } catch { return []; }
  })();
  return candidatePromise;
}

// Called directly from the explicit "Find installed fonts" button so the
// permission request retains the user's activation. Memoized for the session.
export function detectLocalFonts() {
  if (!localPromise) {
    let request;
    try {
      request = typeof window.queryLocalFonts === 'function'
        ? window.queryLocalFonts().catch(() => null) : Promise.resolve(null);
    } catch { request = Promise.resolve(null); }
    localPromise = (async () => {
      try {
        const fonts = await request;
        await document.fonts?.ready;
        if (fonts) {
          const families = [...new Set(fonts.map(font => normalizeFontLabel(font.family)))]
            .filter(family => family !== DEFAULT_MONO_LABEL);
          return monospaceFamilies(families).sort((a, b) => a.localeCompare(b));
        }
      } catch { /* use the cross-browser metric fallback */ }
      return probeKnownFonts();
    })();
  }
  return localPromise;
}
