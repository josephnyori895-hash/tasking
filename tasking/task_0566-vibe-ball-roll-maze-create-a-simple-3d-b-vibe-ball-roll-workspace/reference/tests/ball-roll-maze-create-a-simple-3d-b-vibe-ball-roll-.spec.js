const { test, expect } = require('@playwright/test');
const APP_URL = process.env.APP_URL;
const PREAMBLE = "(() => {\n  // --- deterministic Math.random (mulberry32, fixed seed) ---\n  let _s = (1337) >>> 0;\n  Math.random = function () {\n    _s |= 0; _s = (_s + 0x6D2B79F5) | 0;\n    let t = Math.imul(_s ^ (_s >>> 15), 1 | _s);\n    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;\n    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;\n  };\n  // --- settle animations/transitions so a captured frame is stable & identical across builds ---\n  const css = '*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;'\n            + 'transition-duration:0s!important;transition-delay:0s!important;'\n            + 'caret-color:transparent!important;scroll-behavior:auto!important}';\n  const inject = () => {\n    const root = document.head || document.documentElement;\n    if (!root) return;\n    const st = document.createElement('style');\n    st.setAttribute('data-sand-determinism', '1');\n    st.textContent = css;\n    root.appendChild(st);\n  };\n  if (document.readyState === 'loading') {\n    document.addEventListener('DOMContentLoaded', inject);\n  } else {\n    inject();\n  }\n})();";
const READY_HOOKS = ["game"];
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
test('[P2P] core game state is present', async ({ page }) => {
  await boot(page);
  const ok = await page.evaluate(() => typeof window.game !== 'undefined');
  expect(ok).toBe(true);
});
test('[P2P] no layout overflow (UI fits the viewport)', async ({ page }) => {
  await boot(page);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(2);
});
test('[F2P] The gem tally in the top bar stays behind what the player has actually picked up.', async ({ page }) => {
  await boot(page);
  const v = await page.evaluate(async () => { const g=window.game; g.loadLevel(6); const n=1+(crypto.getRandomValues(new Uint32Array(1))[0]%g.gemsTotal); for(let i=0;i<n;i++) g._collect(i); return g.gemsGot===n && document.getElementById('hv-gems').textContent===n+'/'+g.gemsTotal; });
  expect(v).toEqual(true);
});
test('[F2P] After picking up every gem on the level, rolling onto the exit ring does nothing and the level can never be completed.', async ({ page }) => {
  await boot(page);
  const v = await page.evaluate(async () => { const g=window.game; g.loadLevel(0); g.state='playing'; for(let i=0;i<g.gemsTotal;i++) g._collect(i); g.bx=g.goal.wx; g.bz=g.goal.wz; g.bvx=0; g.bvz=0; g._physics(0.016); return g.state==='win'; });
  expect(v).toEqual(true);
});
test('[F2P] The ball is lost while sitting on perfectly solid floor beside a gap, while it can sit over part of a gap without fallin', async ({ page }) => {
  await boot(page);
  const v = await page.evaluate(async () => { const g=window.game; g.loadLevel(1); g.state='playing'; g.bvx=0; g.bvz=0; g.bx=(4+0.25)*2-g.bW*0.5; g.bz=(4+0.5)*2-g.bD*0.5; g._physics(0.016); const a=g.state; g.loadLevel(1); g.state='playing'; g.bvx=0; g.bvz=0; g.bx=(3+0.25)*2-g.bW*0.5; g.bz=(4+0.5)*2-g.bD*0.5; g._physics(0.016); return a+'|'+g.state; });
  expect(v).toEqual("playing|dead");
});
test('[F2P] As soon as a gem is picked up, the gem panel jumps upward out of the top bar and is cut off by the edge of the screen.', async ({ page }) => {
  await boot(page);
  const v = await page.evaluate(async () => { const g=window.game; g.loadLevel(0); g._collect(0); const card=document.getElementById('hv-gems').parentElement; const hud=document.getElementById('hud'); const b=card.getBoundingClientRect(), p=hud.getBoundingClientRect(); return b.top>=p.top-1 && b.bottom<=p.bottom+1 && b.top>=0; });
  expect(v).toEqual(true);
});
