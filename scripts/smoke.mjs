// Headless smoke test: load the renderer, collect console errors, verify the highway
// actually drew (non-blank canvas) and the readouts advanced. Exits non-zero on failure.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW_PATH || 'playwright');

const url = process.argv[2] || 'http://127.0.0.1:8080/renderer/';
const browser = await chromium.launch({
  executablePath: process.env.PW_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
});
const page = await browser.newPage();

const errors = [];      // real JS errors — must be zero
const netFails = [];    // resource load failures — reported, not fatal (fonts are external)
page.on('console', (m) => {
  // "Failed to load resource" is a network failure, tracked separately — not a JS error.
  if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text());
});
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('requestfailed', (r) => netFails.push(r.url() + ' — ' + (r.failure()?.errorText || '')));
page.on('response', (r) => { if (r.status() >= 400) netFails.push(r.status() + ' ' + r.url()); });

await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(800); // let the demo clock advance and draw a few frames

// Report network noise (external fonts are blocked in the sandbox; that's expected).
const appNetFails = netFails.filter((u) => !/fonts\.(googleapis|gstatic)\.com/.test(u));
if (netFails.length) console.log('  (network: ' + netFails.length + ' failures; ' +
  appNetFails.length + ' non-font)');
for (const f of appNetFails) console.log('  ⚠ ' + f);

// 1) no real JS errors — this is the hard gate
if (errors.length) {
  console.error('✗ JS errors:\n' + errors.join('\n'));
  await browser.close();
  process.exit(1);
}

// 2) canvas is non-blank (some pixels drawn)
const drew = await page.evaluate(() => {
  const c = document.getElementById('highway');
  const ctx = c.getContext('2d');
  const { data } = ctx.getImageData(0, 0, c.width, c.height);
  let nonzero = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] > 0) nonzero++;
  return nonzero;
});

// 3) the percent readout advanced past 0
const pct = await page.evaluate(() => document.getElementById('percent').textContent);
// 4) report rendered
const report = await page.evaluate(() => document.getElementById('report').textContent);

await browser.close();

const ok = drew > 1000 && pct && pct !== '0.0%';
console.log(`drew ${drew} pixels · percent=${pct} · report=${report.slice(0, 40)!==''}`);
if (!ok) { console.error('✗ smoke failed: drew=' + drew + ' pct=' + pct); process.exit(1); }
console.log('✓ renderer smoke passed');
