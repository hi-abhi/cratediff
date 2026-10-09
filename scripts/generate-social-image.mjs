import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const [logo, font] = await Promise.all([
  readFile(new URL('../public/logo.svg', import.meta.url)),
  readFile(new URL('./fonts/InterVariable.woff2', import.meta.url)),
]);
const output = fileURLToPath(new URL('../public/social-preview.png', import.meta.url));
const browser = await chromium.launch();

try {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 1,
  });
  await page.setContent(`
    <!doctype html>
    <html>
      <head>
        <style>
          @font-face {
            font-family: "Inter";
            font-style: normal;
            font-weight: 100 900;
            src: url("data:font/woff2;base64,${font.toString('base64')}") format("woff2");
          }
          body {
            margin: 0;
            height: 100vh;
            display: grid;
            place-items: center;
            background: #f7f8fa;
            color: rgb(85, 65, 49);
            font-family: "Inter", sans-serif;
          }
          .brand { display: flex; flex-direction: column; align-items: center; gap: 0; }
          img { display: block; width: 360px; height: 360px; }
          h1 { margin: 0; font-size: 96px; font-weight: 700; line-height: 1.1; letter-spacing: -1.5px; }
        </style>
      </head>
      <body>
        <div class="brand">
          <img src="data:image/svg+xml;base64,${logo.toString('base64')}" alt="Crate Diff logo">
          <h1>Crate Diff</h1>
        </div>
      </body>
    </html>
  `);
  await page.locator('img').evaluate(image => image.decode());
  await page.evaluate(async () => {
    const fonts = await document.fonts.load('700 96px Inter');
    if (!fonts.length || fonts.some(font => font.status !== 'loaded')) {
      throw new Error('Inter must load before generating the social preview.');
    }
    await document.fonts.ready;
  });
  await page.screenshot({ path: output, type: 'png' });
  console.log(`Generated ${output} (1200 × 630).`);
} finally {
  await browser.close();
}
