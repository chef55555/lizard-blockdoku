// Post-deploy check against the live GitHub Pages site: loads, plays, works offline.
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'https://chef55555.github.io/lizard-blockdoku/';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const page = await context.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(e.message));

let failures = 0;
const check = (name, ok, extra) => {
  if (ok) console.log('  ok: ' + name);
  else { failures++; console.error('  FAIL: ' + name + (extra ? ' (' + extra + ')' : '')); }
};

await page.goto(BASE);
await page.waitForSelector('.cell');
check('live page renders 81 cells', (await page.locator('.cell').count()) === 81);
await page.tap('#splash');
await page.waitForSelector('#splash', { state: 'hidden' });
check('3 tray pieces dealt', (await page.locator('.slot .piece').count()) === 3);

const swScope = await page.evaluate(async () => {
  const reg = await navigator.serviceWorker.ready;
  return reg.scope;
});
check('service worker scoped to the subpath', swScope === BASE, swScope);
await page.waitForTimeout(1500); // let precache complete

await context.setOffline(true);
await page.reload();
const offlineCells = await page.locator('.cell').count().catch(() => 0);
check('offline reload works on the live subpath', offlineCells === 81, 'cells=' + offlineCells);
await context.setOffline(false);

const manifestOk = await page.evaluate(async () => {
  const r = await fetch('manifest.webmanifest');
  const m = await r.json();
  return m.start_url === './' && m.scope === './' && m.icons.length === 3;
});
check('manifest uses relative paths', manifestOk);
check('no console errors on live site', errors.length === 0, JSON.stringify(errors.slice(0, 3)));

await browser.close();
if (failures) { console.error(failures + ' live check(s) failed'); process.exit(1); }
console.log('Live site verified: ' + BASE);
