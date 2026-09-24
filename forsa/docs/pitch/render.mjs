// Render deck-fr.html / deck-en.html to presentation.pdf / presentation-en.pdf (needs Playwright + Chromium).
import { createRequire } from "module";
import { fileURLToPath } from "url";
import path from "path";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const here = path.dirname(fileURLToPath(import.meta.url));
const browser = await chromium.launch();
for (const [lang, out] of [["fr", "presentation.pdf"], ["en", "presentation-en.pdf"]]) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  await page.goto(`file://${here}/deck-${lang}.html`, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.pdf({ path: path.join(here, out), width: "1600px", height: "900px", printBackground: true });
  if (process.env.PREVIEW) {
    const n = await page.locator("section.slide").count();
    for (let i = 0; i < n; i++) await page.locator("section.slide").nth(i).screenshot({ path: `${process.env.PREVIEW}/${lang}-${String(i + 1).padStart(2, "0")}.png` });
  }
  console.log(`wrote ${out}`);
}
await browser.close();
