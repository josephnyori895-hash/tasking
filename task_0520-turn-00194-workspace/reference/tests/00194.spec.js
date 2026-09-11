const { test, expect } = require('@playwright/test');
const APP_URL = process.env.APP_URL;
const PREAMBLE = "(() => {\n  // --- deterministic Math.random (mulberry32, fixed seed) ---\n  let _s = (1337) >>> 0;\n  Math.random = function () {\n    _s |= 0; _s = (_s + 0x6D2B79F5) | 0;\n    let t = Math.imul(_s ^ (_s >>> 15), 1 | _s);\n    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;\n    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;\n  };\n  // --- settle animations/transitions so a captured frame is stable & identical across builds ---\n  const css = '*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;'\n            + 'transition-duration:0s!important;transition-delay:0s!important;'\n            + 'caret-color:transparent!important;scroll-behavior:auto!important}';\n  const inject = () => {\n    const root = document.head || document.documentElement;\n    if (!root) return;\n    const st = document.createElement('style');\n    st.setAttribute('data-sand-determinism', '1');\n    st.textContent = css;\n    root.appendChild(st);\n  };\n  if (document.readyState === 'loading') {\n    document.addEventListener('DOMContentLoaded', inject);\n  } else {\n    inject();\n  }\n})();";
const READY_HOOKS = [];
async function boot(page) {
  await page.addInitScript(PREAMBLE);
  await page.goto(APP_URL, { waitUntil: 'networkidle', timeout: 30000 });
  try { await page.waitForFunction((hs) => document.readyState === 'complete' && hs.every(h => typeof window[h] !== 'undefined'), READY_HOOKS, { timeout: 15000 }); } catch (e) {}
  await page.waitForTimeout(800);
}
test('[P2P] game boots and renders content', async ({ page }) => {
  await boot(page);
  const has = await page.evaluate(() => !!document.body && document.body.children.length > 0);
  expect(has).toBe(true);
});
test('[P2P] canvas or root element renders', async ({ page }) => {
  await boot(page);
  const ok = await page.evaluate(() => !!(document.querySelector('canvas') || document.querySelector('#app') || document.body.firstElementChild));
  expect(ok).toBe(true);
});
test('[P2P] no layout overflow (UI fits the viewport)', async ({ page }) => {
  await boot(page);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(2);
});
test('[F2P] You make a move, open the pause menu, resume — and the undo control in the top bar has gone grey and dead, as if the mov', async ({ page }) => {
  await boot(page);
  const v = await page.evaluate(async () => { return (async () => {
  const q = s => document.querySelector(s);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  q('#btn-enter').click();
  await sleep(600);
  if (!q('#screen-map').hidden) q('#btn-play').click();
  for (let i = 0; i < 60 && q('#screen-game').hidden; i++) await sleep(100);
  await sleep(2400);
  const cv = q('#game-canvas');
  cv.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await sleep(700);
  const beforeEnabled = !q('#btn-undo').disabled;
  q('#btn-pause').click();
  await sleep(500);
  q('#btn-resume').click();
  await sleep(400);
  const afterEnabled = !q('#btn-undo').disabled;
  return beforeEnabled && afterEnabled;
})(); });
  expect(v).toEqual(true);
});
test('[F2P] Resuming from the pause menu makes the huge level-intro title card slam back on top of the playfield, blanketing the pla', async ({ page }) => {
  await boot(page);
  const v = await page.evaluate(async () => { return (async () => {
  const q = s => document.querySelector(s);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  q('#btn-enter').click();
  await sleep(600);
  if (!q('#screen-map').hidden) q('#btn-play').click();
  for (let i = 0; i < 60 && q('#screen-game').hidden; i++) await sleep(100);
  await sleep(2600);
  q('#btn-pause').click();
  await sleep(400);
  q('#btn-resume').click();
  await sleep(250);
  const bw = q('#board-wrap').getBoundingClientRect();
  const b = q('#level-banner').getBoundingClientRect();
  const covers = (b.width > bw.width * 0.5) && (b.height > bw.height * 0.5);
  return !covers;
})(); });
  expect(v).toEqual(true);
});
