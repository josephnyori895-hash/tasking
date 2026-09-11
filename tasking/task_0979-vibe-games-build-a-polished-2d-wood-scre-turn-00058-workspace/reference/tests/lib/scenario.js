// Reusable scenario helpers for @playwright/test specs. Usage:
//   const S = require('./lib/scenario');
//   await S.seed(page, process.env.APP_URL, { storage: { key: value }, route: '/dashboard' });
//   await S.drive(page, process.env.APP_URL, [{viewport:{width:390,height:844}}, {click:'#btn'}]);
//   const r = await S.assertVisibleUnclipped(page, '#btn-close', { container: '.panel' });
module.exports = {
  // Seed localStorage BEFORE the app reads it, then load the target route.
  async seed(page, appUrl, { storage = {}, route = '/' } = {}) {
    await page.goto(appUrl, { waitUntil: 'domcontentloaded' });
    if (Object.keys(storage).length) {
      await page.evaluate((s) => {
        for (const [k, v] of Object.entries(s)) {
          localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
        }
      }, storage);
    }
    await page.goto(appUrl.replace(/\/$/, '') + route, { waitUntil: 'networkidle' });
  },
  // Drive an ordered step list to reach the state under test. Steps (one key each):
  //   {viewport:{width,height}} {goto:'/route'} {click:sel} {fill:[sel,text]}
  //   {select:[sel,value]} {press:'Key'} {waitFor:sel} {wait:ms}
  async drive(page, appUrl, steps = []) {
    for (const s of steps) {
      if (s.viewport) await page.setViewportSize(s.viewport);
      else if (s.goto) await page.goto(appUrl.replace(/\/$/, '') + s.goto, { waitUntil: 'networkidle' });
      else if (s.click) await page.locator(s.click).first().click();
      else if (s.fill) await page.locator(s.fill[0]).first().fill(s.fill[1]);
      else if (s.select) await page.locator(s.select[0]).first().selectOption(s.select[1]);
      else if (s.press) await page.keyboard.press(s.press);
      else if (s.waitFor) await page.locator(s.waitFor).first().waitFor();
      else if (typeof s.wait === 'number') await page.waitForTimeout(s.wait);
    }
  },
  // Layout-integrity check: element fully on-screen and (optionally) inside its container box.
  async assertVisibleUnclipped(page, sel, { container = null } = {}) {
    const box = await page.locator(sel).first().boundingBox();
    const vp = page.viewportSize();
    const res = { visible: !!box, inViewport: false, inContainer: true, box };
    if (box && vp) {
      res.inViewport = box.y >= -1 && box.x >= -1 &&
        box.y + box.height <= vp.height + 1 && box.x + box.width <= vp.width + 1;
    }
    if (box && container) {
      const cb = await page.locator(container).first().boundingBox();
      if (cb) res.inContainer = box.y + box.height <= cb.y + cb.height + 1 &&
        box.x + box.width <= cb.x + cb.width + 1;
    }
    return res;
  },
  // Do two bounding boxes overlap? (for "must not overlap" assertions)
  overlaps(a, b) {
    if (!a || !b) return false;
    return !(a.x + a.width <= b.x || b.x + b.width <= a.x ||
             a.y + a.height <= b.y || b.y + b.height <= a.y);
  },
};
