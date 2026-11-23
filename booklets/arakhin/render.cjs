// node render.cjs <in.html> <out.pdf>
// Prints the booklet to PDF with Playwright's Chromium (Letter size, page numbers in the footer).
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const [, , inFile, outFile, pngPrefix] = process.argv;
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('file://' + path.resolve(inFile), { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  const missing = await page.evaluate(() => [...document.fonts].filter(f => f.status !== 'loaded').map(f => f.family + ' ' + f.weight + ' ' + f.status));
  if (missing.length) console.log('fonts not loaded (may be unused):', missing.join(', '));
  await page.pdf({
    path: outFile, format: 'Letter', printBackground: true, preferCSSPageSize: true,
    displayHeaderFooter: true,
    headerTemplate: '<div></div>',
    footerTemplate: '<div style="width:100%;font-size:8pt;color:#8a8178;font-family:Georgia,serif;text-align:center;">— <span class="pageNumber"></span> —</div>',
  });
  await browser.close();
  console.log('wrote', outFile);
})();
