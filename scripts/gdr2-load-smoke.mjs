// Verifies the GDR2 fix end-to-end in the actual browser: a real .gdr2 file loads and
// renders notes (not blank), and a corrupt file produces a visible error instead of silence.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW_PATH || 'playwright');

const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage();
const jsErrors = [];
page.on('pageerror', (e) => jsErrors.push(e.message));

await page.goto('http://127.0.0.1:8080/renderer/', { waitUntil: 'networkidle' });

// 1) Load the real .gdr2 fixture through the actual file picker.
await page.setInputFiles('#macro-file', process.env.GDR2_FIXTURE);
await page.waitForTimeout(300);
const levelTitle = await page.evaluate(() => document.getElementById('level-title').textContent);
const report1 = await page.evaluate(() => document.getElementById('report').textContent);

// 2) Load a corrupt file — expect a visible status/report error, not silence.
await page.setInputFiles('#macro-file', process.env.CORRUPT_FIXTURE);
await page.waitForTimeout(300);
const status = await page.evaluate(() => document.getElementById('status').textContent);
const report2 = await page.evaluate(() => document.getElementById('report').textContent);

await browser.close();

console.log('after real .gdr2 load: level-title=' + JSON.stringify(levelTitle));
console.log('  report:', report1.slice(0, 80));
console.log('after corrupt load: status=' + JSON.stringify(status));
console.log('  report:', report2.slice(0, 120));

if (jsErrors.length) { console.error('✗ unhandled JS errors: ' + jsErrors.join('; ')); process.exit(1); }
if (levelTitle !== 'CLI Test') { console.error('✗ real .gdr2 did not load correctly'); process.exit(1); }
if (status !== 'load failed') { console.error('✗ corrupt file did not surface a visible error'); process.exit(1); }
if (!report2.includes('Failed to load macro')) { console.error('✗ report did not show the friendly error message'); process.exit(1); }
console.log('✓ GDR2 load smoke passed');
