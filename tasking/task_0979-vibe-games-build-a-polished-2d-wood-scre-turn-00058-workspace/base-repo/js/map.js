// map.js — draggable wooden peg trail level select
import { makeWoodTexture } from './renderer.js';
import { mulberry32, clamp, TAU } from './util.js';
import { sfx } from './audio.js';

const PEG_GAP = 172;
const TOP_PAD = 190;
const BOTTOM_PAD = 320;
const TOTAL_LEVELS = 60;

export class LevelMap {
  constructor(hooks) {
    this.hooks = hooks;              // {onPlay(level)}
    this.viewport = document.getElementById('map-viewport');
    this.content = document.getElementById('map-content');
    this.canvas = document.getElementById('map-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.selName = document.getElementById('map-sel-name');
    this.selState = document.getElementById('map-sel-state');
    this.playBtn = document.getElementById('btn-play');

    this.pegs = [];
    this.offset = 0;
    this.targetOffset = null;
    this.selected = 1;
    this.drag = null;
    this.suppressClick = false;
    this.contentH = 0;
    this.raf = null;
    this.time = 0;
    this.woodStrip = null;

    this._bind();
  }

  _bind() {
    const vp = this.viewport;
    vp.addEventListener('pointerdown', e => {
      this.drag = { y: e.clientY, off: this.offset, moved: 0, vel: 0, lastY: e.clientY, lastT: performance.now() };
      this.targetOffset = null;
      vp.classList.add('dragging');
      vp.setPointerCapture(e.pointerId);
    });
    vp.addEventListener('pointermove', e => {
      if (!this.drag) return;
      const d = this.drag;
      const dy = e.clientY - d.y;
      d.moved = Math.max(d.moved, Math.abs(dy));
      const now = performance.now();
      d.vel = (e.clientY - d.lastY) / Math.max(1, now - d.lastT) * 1000;
      d.lastY = e.clientY; d.lastT = now;
      this.offset = this.clampOffset(d.off + dy);
      this.layout();
    });
    const end = e => {
      if (!this.drag) return;
      const d = this.drag;
      this.drag = null;
      this.viewport.classList.remove('dragging');
      // swallow the synthetic click that follows a real drag
      if (d.moved > 8) {
        this.suppressClick = true;
        setTimeout(() => { this.suppressClick = false; }, 80);
      }
      if (Math.abs(d.vel) > 60 && d.moved > 8) {
        this.targetOffset = this.clampOffset(this.offset + d.vel * 0.28);
        this.animateTo();
      }
    };
    vp.addEventListener('pointerup', end);
    vp.addEventListener('pointercancel', end);
    vp.addEventListener('wheel', e => {
      e.preventDefault();
      this.targetOffset = null;
      this.offset = this.clampOffset(this.offset - e.deltaY);
      this.layout();
    }, { passive: false });

    this.playBtn.addEventListener('click', () => {
      sfx.play('click');
      const p = this.pegs[this.selected - 1];
      if (p && !p.locked) this.hooks.onPlay(this.selected);
    });
  }

  get maxCompleted() { return this.hooks.getProgress(); }

  clampOffset(v) {
    const min = Math.min(0, this.viewport.clientHeight - this.contentH);
    return clamp(v, min, 0);
  }

  build() {
    // clear old pegs
    for (const p of this.pegs) p.el.remove();
    this.pegs = [];

    const W = this.viewport.clientWidth;
    const cx = W / 2;
    this.contentH = TOP_PAD + TOTAL_LEVELS * PEG_GAP + BOTTOM_PAD;
    this.content.style.height = this.contentH + 'px';

    const rng = mulberry32(777);
    const done = this.maxCompleted;
    const nextLevel = Math.min(done + 1, TOTAL_LEVELS);

    for (let i = 1; i <= TOTAL_LEVELS; i++) {
      const y = this.contentH - BOTTOM_PAD - (i - 1) * PEG_GAP;   // level 1 at bottom
      const x = cx + Math.sin(i * 0.75) * Math.min(110, W * 0.22) + (rng() - 0.5) * 14;
      const el = document.createElement('button');
      el.className = 'peg';
      el.type = 'button';
      el.style.left = x + 'px';
      el.style.top = y + 'px';
      el.textContent = i;
      const peg = { level: i, x, y, el, locked: i > nextLevel, done: i <= done, current: i === nextLevel };
      if (peg.done) {
        el.classList.add('done');
        const chk = document.createElement('span');
        chk.className = 'peg-check';
        chk.innerHTML = '<svg viewBox="0 0 24 24"><path d="M4 12.5 10 18 20 6" fill="none" stroke="#f4ffe9" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        el.appendChild(chk);
      }
      if (peg.locked) { el.classList.add('locked'); el.disabled = true; }
      if (peg.current) el.classList.add('current');
      el.addEventListener('click', () => {
        if (this.suppressClick) return;
        if (peg.locked) return;
        sfx.play('peg');
        this.select(i);
      });
      this.content.appendChild(el);
      this.pegs.push(peg);
    }

    this.select(nextLevel, true);
    // initial scroll: put selected peg in view (slightly above center)
    const peg = this.pegs[nextLevel - 1];
    this.offset = this.clampOffset(this.viewport.clientHeight * 0.55 - peg.y);
    this.layout();
    // returning from a fresh clear: celebrate the newly unlocked peg
    if (this.celebrateLevel && this.pegs[this.celebrateLevel - 1]) {
      const cel = this.pegs[this.celebrateLevel - 1].el;
      setTimeout(() => {
        cel.classList.add('just-unlocked');
        sfx.play('select');
        setTimeout(() => cel.classList.remove('just-unlocked'), 1400);
      }, 450);
      this.celebrateLevel = null;
    }
  }

  select(level, silent = false) {
    this.selected = level;
    const peg = this.pegs[level - 1];
    for (const p of this.pegs) p.el.classList.toggle('selected', p.level === level);
    this.selName.textContent = `LEVEL ${level}`;
    this.selState.className = 'map-sel-state';
    if (peg.done) { this.selState.textContent = 'CLEARED ✓'; this.selState.classList.add('done'); }
    else if (peg.current) { this.selState.textContent = 'READY'; }
    else { this.selState.textContent = 'LOCKED'; this.selState.classList.add('locked'); }
    this.playBtn.disabled = peg.locked;
    if (!silent) {
      // ease it into view
      const viewTop = -this.offset, viewBot = viewTop + this.viewport.clientHeight;
      if (peg.y < viewTop + 90 || peg.y > viewBot - 150) {
        this.targetOffset = this.clampOffset(this.viewport.clientHeight * 0.5 - peg.y);
        this.animateTo();
      }
    }
  }

  animateTo() {
    if (this.raf) return;
    const step = () => {
      if (this.targetOffset === null) { this.raf = null; return; }
      const d = this.targetOffset - this.offset;
      if (Math.abs(d) < 0.6) { this.offset = this.targetOffset; this.targetOffset = null; this.layout(); this.raf = null; return; }
      this.offset += d * 0.16;
      this.layout();
      this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  }

  layout() {
    this.content.style.transform = `translateY(${this.offset}px)`;
  }

  /* background trail: wood strip + carved groove drawn once per resize */
  paint() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = this.viewport.clientWidth;
    this.canvas.width = W * dpr;
    this.canvas.height = this.contentH * dpr;
    this.canvas.style.width = W + 'px';
    this.canvas.style.height = this.contentH + 'px';
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    if (!this.woodStrip) {
      this.woodStrip = makeWoodTexture(
        { base: '#33200f', light: '#4d3018', dark: '#1e1007' },
        420, 900, 9911, false
      );
    }
    // tile the strip
    const pat = ctx.createPattern(this.woodStrip, 'repeat');
    ctx.fillStyle = pat;
    ctx.fillRect(0, 0, W, this.contentH);
    // side vignettes
    const vg = ctx.createLinearGradient(0, 0, W, 0);
    vg.addColorStop(0, 'rgba(0,0,0,.5)');
    vg.addColorStop(0.18, 'rgba(0,0,0,0)');
    vg.addColorStop(0.82, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,.5)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, this.contentH);

    // carved groove connecting pegs
    ctx.lineCap = 'round';
    for (let pass = 0; pass < 2; pass++) {
      ctx.beginPath();
      this.pegs.forEach((p, i) => { if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
      if (pass === 0) {
        ctx.strokeStyle = 'rgba(0,0,0,.55)';
        ctx.lineWidth = 13;
      } else {
        ctx.strokeStyle = 'rgba(255,214,150,.14)';
        ctx.lineWidth = 4;
        ctx.setLineDash([2, 26]);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  show() {
    // (re)build then paint after layout settles
    this.build();
    this.paint();
  }
}
