import { build } from 'esbuild';
import { mkdir, rm } from 'node:fs/promises';
import './generate-themes.mjs';

const outdir = 'public/assets';
await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });
// Small synchronous startup bundle applies saved preferences before the UI
// paints; the larger Pierre bundle continues to load as an ES module.
await build({
  entryPoints: ['js/settings.js'],
  outfile: `${outdir}/settings.js`,
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  minify: true,
});
await build({
  entryPoints: { pierre: 'js/pierre.js' },
  outdir,
  bundle: true,
  splitting: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  chunkNames: 'chunks/[name]-[hash]',
  define: { 'process.env.NODE_ENV': '"production"' },
});
