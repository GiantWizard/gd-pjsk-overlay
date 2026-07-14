// Screenshot companion + overlay modes for visual review. OUT dir via env (default /tmp/shots).
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW_PATH || 'playwright');
const out = process.env.OUT || '/tmp/shots';
const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto('http://127.0.0.1:8080/renderer/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
await page.screenshot({ path: out + '/companion.png' });
await page.waitForTimeout(700);            // catch a different moment (likely mid-flash)
await page.screenshot({ path: out + '/companion-2.png' });
// seek to a dense section to review holds/squiggles + combo
await page.evaluate(() => { const s = document.getElementById('seek'); s.value = 7000; s.dispatchEvent(new Event('input')); });
await page.waitForTimeout(600);
await page.screenshot({ path: out + '/companion-dense.png' });
await page.click('#mode');                 // → overlay
await page.waitForTimeout(900);
await page.screenshot({ path: out + '/overlay.png' });
await browser.close();
console.log('shots written to ' + out);
