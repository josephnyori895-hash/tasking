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
test('[F2P] Once a screw has been moved to another plank and then picked up and put back again, the board stops behaving: a plank le', async ({ page }) => {
  await boot(page);
  const v = await page.evaluate(async () => { window.__sfxOff = true;
document.querySelectorAll('.screen').forEach(s => { s.hidden = true; });
document.getElementById('screen-game').hidden = false;
const G = await import('./js' + '/generator.js');
const M = await import('./js' + '/game.js');
const B = G.BOARD;
const planks = [], holes = [];
const addPlank = (len, wid) => {
  const i = planks.length, col = i % 3, row = (i / 3) | 0;
  planks.push({ id: i, x: B.w * (0.2 + 0.3 * col), y: B.h * (0.13 + 0.19 * row), len, wid, angle: 0, z: i, tone: i % 4, seed: 13 + i * 29 });
  return i;
};
const addHole = (pi, off, filled) => {
  const p = planks[pi];
  const h = { id: holes.length, plank: pi, lx: off, ly: 0, filled: filled, x: p.x + off, y: p.y };
  holes.push(h); return h.id;
};
const decoys = 1 + (crypto.getRandomValues(new Uint32Array(1))[0] % 3);
const pA = addPlank(120, 34), pB = addPlank(120, 34), pC = addPlank(120, 34);
const a0 = addHole(pA, -34, true), a1 = addHole(pA, 34, true);
const b0 = addHole(pB, -34, true), b1 = addHole(pB, 0, false), b2 = addHole(pB, 34, false);
addHole(pC, -34, true); const c1 = addHole(pC, 34, false);
for (let i = 0; i < decoys; i++) { const d = addPlank(110, 32); addHole(d, -30, true); addHole(d, 30, true); }
const g = new M.Game(document.getElementById('game-canvas'), { onWin(){}, onLose(){}, onTick(){}, onCombo(){}, onLevelStart(){}, onHistory(){}, onDeadlock(){} });
g.loadLevel({ level: 1, timeLimit: 999, planks, holes });
const lift = id => { const h = g.locMap.get(id); const sc = g.screws[h.screw]; g.beginLift(sc, h); const a = g.anims.pop(); g.anims.length = 0; g.finishLift(a); };
const place = loc => { g.placeHeld(loc); const a = g.anims.pop(); g.anims.length = 0; g.finishPlace(a); };
const cancel = () => { g.cancelHeld(); const a = g.anims.pop(); g.anims.length = 0; g.finishCancel(a); };
const dest = (crypto.getRandomValues(new Uint32Array(1))[0] % 2) ? b1 : b2;
lift(a0); place(g.locMap.get(dest));
lift(dest); cancel();
lift(a1); place(g.locMap.get(c1));
lift(b0); place(g.parking[0]);
const bad = g.planks.some(p => {
  const cnt = g.holes.filter(h => h.plank === p.id && h.screw !== null).length;
  return (p.state === 'alive' && cnt === 0) || (p.state !== 'alive' && cnt > 0);
});
return !bad; });
  expect(v).toEqual(true);
});
test('[F2P] After a move that knocks several planks off at once is taken back and then repeated, the very last plank on the board ca', async ({ page }) => {
  await boot(page);
  const v = await page.evaluate(async () => { window.__sfxOff = true;
document.querySelectorAll('.screen').forEach(s => { s.hidden = true; });
document.getElementById('screen-game').hidden = false;
const G = await import('./js' + '/generator.js');
const M = await import('./js' + '/game.js');
const B = G.BOARD;
const planks = [], holes = [];
const addPlank = (len, wid) => {
  const i = planks.length, col = i % 3, row = (i / 3) | 0;
  planks.push({ id: i, x: B.w * (0.2 + 0.3 * col), y: B.h * (0.13 + 0.19 * row), len, wid, angle: 0, z: i, tone: i % 4, seed: 13 + i * 29 });
  return i;
};
const addHole = (pi, off, filled) => {
  const p = planks[pi];
  const h = { id: holes.length, plank: pi, lx: off, ly: 0, filled: filled, x: p.x + off, y: p.y };
  holes.push(h); return h.id;
};
const n = 2 + (crypto.getRandomValues(new Uint32Array(1))[0] % 3);
for (let i = 0; i < n; i++) addPlank(110, 32);
const L = addPlank(130, 36);
const h0 = addHole(L, -34, true), h1 = addHole(L, 34, true);
const g = new M.Game(document.getElementById('game-canvas'), { onWin(){}, onLose(){}, onTick(){}, onCombo(){}, onLevelStart(){}, onHistory(){}, onDeadlock(){} });
g.loadLevel({ level: 2, timeLimit: 999, planks, holes });
const lift = id => { const h = g.locMap.get(id); const sc = g.screws[h.screw]; g.beginLift(sc, h); const a = g.anims.pop(); g.anims.length = 0; g.finishLift(a); };
const place = loc => { g.placeHeld(loc); const a = g.anims.pop(); g.anims.length = 0; g.finishPlace(a); };
lift(h0); place(g.parking[0]);
g.undo();
lift(h0); place(g.parking[0]);
lift(h1);
return g.removed.size === 1 && !g.held; });
  expect(v).toEqual(true);
});
test('[F2P] If a screw is stashed in the tray and the planks are all dropped, the game throws up the cleared-board celebration even ', async ({ page }) => {
  await boot(page);
  const v = await page.evaluate(async () => { window.__sfxOff = true;
document.querySelectorAll('.screen').forEach(s => { s.hidden = true; });
document.getElementById('screen-game').hidden = false;
const G = await import('./js' + '/generator.js');
const M = await import('./js' + '/game.js');
const B = G.BOARD;
const planks = [], holes = [];
const addPlank = (len, wid) => {
  const i = planks.length, col = i % 3, row = (i / 3) | 0;
  planks.push({ id: i, x: B.w * (0.2 + 0.3 * col), y: B.h * (0.13 + 0.19 * row), len, wid, angle: 0, z: i, tone: i % 4, seed: 13 + i * 29 });
  return i;
};
const addHole = (pi, off, filled) => {
  const p = planks[pi];
  const h = { id: holes.length, plank: pi, lx: off, ly: 0, filled: filled, x: p.x + off, y: p.y };
  holes.push(h); return h.id;
};
const n = 3 + (crypto.getRandomValues(new Uint32Array(1))[0] % 3);
const src = [];
for (let i = 0; i < n - 1; i++) { const p = addPlank(110, 32); src.push(addHole(p, 0, true)); }
const L = addPlank(150, 38);
addHole(L, -50, true);
const empties = [];
const offs = [-16, 16, 50];
for (let i = 0; i < n - 2; i++) empties.push(addHole(L, offs[i], false));
const g = new M.Game(document.getElementById('game-canvas'), { onWin(){}, onLose(){}, onTick(){}, onCombo(){}, onLevelStart(){}, onHistory(){}, onDeadlock(){} });
g.loadLevel({ level: 3, timeLimit: 999, planks, holes });
const lift = id => { const h = g.locMap.get(id); const sc = g.screws[h.screw]; g.beginLift(sc, h); const a = g.anims.pop(); g.anims.length = 0; g.finishLift(a); };
const place = loc => { g.placeHeld(loc); const a = g.anims.pop(); g.anims.length = 0; g.finishPlace(a); };
for (let i = 0; i < n - 2; i++) { lift(src[i]); place(g.locMap.get(empties[i])); }
const r = crypto.getRandomValues(new Uint32Array(1))[0] % 2;
lift(src[n - 2]); place(g.parking[r]);
let guard = 0;
while (guard++ < 12) {
  const h = g.holes.find(x => x.plank === L && x.screw !== null);
  if (!h) break;
  lift(h.id);
}
return g.state !== 'won' && g.parking.filter(s => s.screw !== null).length === 1; });
  expect(v).toEqual(true);
});
test('[F2P] The top bar is blown out: the clock panel hogs almost the whole width and shoves the undo / restart / pause buttons past', async ({ page }) => {
  await boot(page);
  const v = await page.evaluate(async () => { document.querySelectorAll('.screen').forEach(s => { s.hidden = true; });
document.getElementById('screen-game').hidden = false;
const hud = document.getElementById('hud');
const right = hud.querySelector('.hud-right');
const timer = document.getElementById('hud-timer-plaque');
const hb = hud.getBoundingClientRect();
const rb = right.getBoundingClientRect();
const tb = timer.getBoundingClientRect();
return (rb.right <= hb.right + 1) && (rb.right <= window.innerWidth + 1) && (tb.right <= rb.left + 1); });
  expect(v).toEqual(true);
});
