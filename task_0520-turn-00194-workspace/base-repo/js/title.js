// title.js — ambient title-screen: sun shaft + drifting sawdust motes
export class TitleAmbience {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.motes = [];
    this.raf = null;
    this.running = false;
    this.time = 0;
    this._loop = this.loop.bind(this);
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    this.canvas.width = w * dpr;
    this.canvas.height = h * dpr;
    this.dpr = dpr; this.w = w; this.h = h;
  }

  start() {
    this.resize();
    if (!this.motes.length) {
      for (let i = 0; i < 42; i++) {
        this.motes.push({
          x: Math.random(), y: Math.random(),
          r: 0.8 + Math.random() * 2.6,
          vx: (Math.random() - 0.5) * 0.008,
          vy: -(0.004 + Math.random() * 0.012),
          ph: Math.random() * Math.PI * 2,
          sp: 0.4 + Math.random() * 0.8,
        });
      }
    }
    if (this.running) return;
    this.running = true;
    this.lastT = performance.now();
    this.raf = requestAnimationFrame(this._loop);
  }

  stop() {
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = null;
  }

  loop(now) {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this._loop);
    const dt = Math.min(0.05, (now - this.lastT) / 1000);
    this.lastT = now;
    this.time += dt;

    const { ctx, w, h } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // soft diagonal sun shaft
    const g = ctx.createLinearGradient(w * 0.15, 0, w * 0.75, h);
    g.addColorStop(0, 'rgba(255,214,150,.10)');
    g.addColorStop(0.5, 'rgba(255,214,150,.035)');
    g.addColorStop(1, 'rgba(255,214,150,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(w * 0.18, 0); ctx.lineTo(w * 0.55, 0);
    ctx.lineTo(w * 0.95, h); ctx.lineTo(w * 0.45, h);
    ctx.closePath(); ctx.fill();

    // sawdust motes
    for (const m of this.motes) {
      m.x += m.vx * dt * 60 + Math.sin(this.time * m.sp + m.ph) * 0.0006;
      m.y += m.vy * dt * 60;
      if (m.y < -0.05) { m.y = 1.05; m.x = Math.random(); }
      if (m.x < -0.05) m.x = 1.05;
      if (m.x > 1.05) m.x = -0.05;
      const tw = 0.5 + 0.5 * Math.sin(this.time * m.sp * 2 + m.ph);
      ctx.globalAlpha = 0.14 + tw * 0.3;
      ctx.fillStyle = '#FFD9A0';
      ctx.beginPath();
      ctx.arc(m.x * w, m.y * h, m.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}
