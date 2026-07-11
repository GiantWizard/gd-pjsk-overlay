import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW_PATH || 'playwright');
const out = process.env.OUT || '/tmp/shots';
const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width: 1000, height: 720 } });
await page.goto('http://127.0.0.1:8080/renderer/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
await page.screenshot({ path: out + '/companion.png' });
await page.click('#mode');            // → overlay
await page.waitForTimeout(1200);
await page.screenshot({ path: out + '/overlay.png' });
await browser.close();
console.log('shots written to ' + out);
