// Verify the renderer's LIVE path (Phase 3): connect to the mock tap over WebSocket and
// confirm ticks drive the interpolated playhead / percent readout.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW_PATH || 'playwright');

const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage();
const jsErrors = [];
page.on('pageerror', (e) => jsErrors.push(e.message));

await page.goto('http://127.0.0.1:8080/renderer/', { waitUntil: 'networkidle' });
await page.click('#connect');            // attach the reconnecting WS client to the mock tap
await page.waitForTimeout(1200);

const status = await page.evaluate(() => document.getElementById('status').textContent);
const title = await page.evaluate(() => document.getElementById('level-title').textContent);
// sample the percent twice to confirm the interpolated clock is advancing off WS ticks
const p1 = await page.evaluate(() => document.getElementById('percent').textContent);
await page.waitForTimeout(400);
const p2 = await page.evaluate(() => document.getElementById('percent').textContent);

await browser.close();

const advancing = p1 !== p2;
const gotLevelStart = /mock/.test(title);
console.log(`status=${status} · title="${title}" · percent ${p1}→${p2}`);
if (jsErrors.length) { console.error('✗ JS errors: ' + jsErrors.join('; ')); process.exit(1); }
if (status !== 'connected') { console.error('✗ WS did not connect (status=' + status + ')'); process.exit(1); }
if (!gotLevelStart) { console.error('✗ levelStart not applied to title'); process.exit(1); }
if (!advancing) { console.error('✗ playhead not advancing off WS ticks'); process.exit(1); }
console.log('✓ live WS path passed');
