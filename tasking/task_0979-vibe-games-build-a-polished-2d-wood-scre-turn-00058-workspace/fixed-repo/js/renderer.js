// renderer.js — canvas drawing: wood textures, planks, screws, particles
import { mulberry32, clamp, TAU } from './util.js';

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) + amt, g = ((n >> 8) & 255) + amt, b = (n & 255) + amt;
  r = clamp(r, 0, 255); g = clamp(g, 0, 255); b = clamp(b, 0, 255);
  return `rgb(${r},${g},${b})`;
}

/* ---------- procedural wood grain texture ---------- */
export function makeWoodTexture(wood, lenW, lenH, seed, plankMode = true) {
  const w = Math.max(2, Math.round(lenW));
  const h = Math.max(2, Math.round(lenH));
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  const rng = mulberry32(seed);

  ctx.fillStyle = wood.base;
  ctx.fillRect(0, 0, w, h);

  // long tonal bands
  const bands = plankMode ? 9 : 16;
  for (let i = 0; i < bands; i++) {
    const y0 = rng() * h;
    const bh = (plankMode ? 6 : 14) + rng() * (plankMode ? 22 : 46);
    const col = rng() < 0.5 ? wood.light : wood.dark;
    ctx.globalAlpha = 0.06 + rng() * 0.10;
    ctx.fillStyle = col;
    ctx.fillRect(0, y0, w, bh);
  }
  ctx.globalAlpha = 1;

  // grain streaks
  const lines = plankMode ? Math.floor(h / 3.2) : Math.floor(h / 6);
  for (let i = 0; i < lines; i++) {
    const y0 = rng() * h;
    const amp = 1 + rng() * (plankMode ? 3.2 : 6);
    const per = 90 + rng() * 220;
    const ph = rng() * TAU;
    const dark = rng() < 0.62;
    ctx.strokeStyle = dark ? wood.dark : wood.light;
    ctx.globalAlpha = dark ? 0.10 + rng() * 0.16 : 0.06 + rng() * 0.1;
    ctx.lineWidth = 0.7 + rng() * 1.6;
    ctx.beginPath();
    for (let x = 0; x <= w; x += 9) {
      const y = y0 + Math.sin(x / per * TAU + ph) * amp + Math.sin(x / 37 + ph * 2) * amp * 0.35;
      if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // knots (planks only)
  if (plankMode) {
    const knots = w > 380 ? 2 : 1;
    for (let k = 0; k < knots; k++) {
      if (rng() < 0.35) continue;
      const kx = w * (0.15 + rng() * 0.7);
      const ky = h * (0.2 + rng() * 0.6);
      const kr = 5 + rng() * 9;
      for (let r = kr; r > 0; r -= 1.6) {
        ctx.strokeStyle = wood.dark;
        ctx.globalAlpha = 0.10 + (kr - r) / kr * 0.14;
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        ctx.ellipse(kx, ky, r * 1.7, r, 0.1, 0, TAU);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
  }
  return cv;
}

/* ---------- rounded-rect path ---------- */
export function rrect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/* ============================================================
   GameRenderer — draws the active board each frame
   ============================================================ */
export class GameRenderer {
  constructor(canvas, board) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.board = board;                      // {w,h,...} design space
    this.scale = 1; this.ox = 0; this.oy = 0;
    this.texCache = new Map();
    this.boardTex = null;
    this.dpr = 1;
    this.shake = 0;
    this.particles = [];
    this.time = 0;
  }

  resize(cssW, cssH) {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(cssW * this.dpr);
    this.canvas.height = Math.round(cssH * this.dpr);
    this.cssW = cssW; this.cssH = cssH;
    const pad = 14;
    this.scale = Math.min((cssW - pad * 2) / this.board.w, (cssH - pad * 2) / this.board.h);
    this.ox = (cssW - this.board.w * this.scale) / 2;
    this.oy = (cssH - this.board.h * this.scale) / 2;
    if (!this.boardTex) {
      this.boardTex = makeWoodTexture(
        { base: '#2E1A0F', light: '#4A2C17', dark: '#1B0D07' },
        this.board.w, this.board.h, 4242, false
      );
    }
    if (!this.trayTex) {
      this.trayTex = makeWoodTexture(
        { base: '#5A3A20', light: '#7A5230', dark: '#3C2412' },
        340, 108, 917, true
      );
    }
  }

  screenToBoard(sx, sy) {
    return { x: (sx - this.ox) / this.scale, y: (sy - this.oy) / this.scale };
  }

  plankTexture(p) {
    if (!this.texCache.has(p.id)) {
      this.texCache.set(p.id, makeWoodTexture(p.wood, p.len + 4, p.wid + 4, p.seed, true));
    }
    return this.texCache.get(p.id);
  }

  clearCache() { this.texCache.clear(); }

  addShake(v) { this.shake = Math.min(this.shake + v, 26); }

  /* -------- particles -------- */
  burst(x, y, opts = {}) {
    const n = opts.n ?? 10;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      const sp = (opts.speed ?? 260) * (0.4 + Math.random() * 0.9);
      this.particles.push({
        x, y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - (opts.up ?? 120),
        rot: Math.random() * TAU, vr: (Math.random() - 0.5) * 18,
        life: 0, max: (opts.life ?? 0.7) * (0.6 + Math.random() * 0.7),
        size: (opts.size ?? 7) * (0.5 + Math.random()),
        kind: opts.kind ?? 'chip',
        color: opts.color,
      });
    }
  }
  confetti(x, y) {
    const cols = ['#F25C4A', '#F2C14E', '#4C9A4F', '#3FA8A0', '#F4E8D0', '#E2734F'];
    for (let i = 0; i < 70; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4;
      const sp = 380 + Math.random() * 460;
      this.particles.push({
        x, y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        rot: Math.random() * TAU, vr: (Math.random() - 0.5) * 22,
        life: 0, max: 1.4 + Math.random() * 0.9,
        size: 6 + Math.random() * 8,
        kind: 'confetti',
        color: cols[(Math.random() * cols.length) | 0],
      });
    }
  }

  updateParticles(dt) {
    const g = 1500;
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life += dt;
      if (p.life >= p.max) { this.particles.splice(i, 1); continue; }
      p.vy += g * dt * (p.kind === 'confetti' ? 0.55 : 1);
      p.vx *= (1 - dt * 1.6);
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.rot += p.vr * dt;
    }
  }

  /* -------- main draw -------- */
  draw(dt, state) {
    this.time += dt;
    this.updateParticles(dt);
    this.shake = Math.max(0, this.shake - dt * 60);

    const { ctx } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.cssW, this.cssH);

    // screen shake offset
    let sxo = 0, syo = 0;
    if (this.shake > 0.1) {
      sxo = (Math.random() - 0.5) * this.shake;
      syo = (Math.random() - 0.5) * this.shake;
    }

    ctx.save();
    ctx.translate(this.ox + sxo, this.oy + syo);
    ctx.scale(this.scale, this.scale);

    this.drawBoardBase(ctx);

    for (const p of state.planks) {
      if (p.state === 'alive') this.drawPlank(ctx, p, state, false);
    }
    for (const p of state.planks) {
      if (p.state === 'alive') this.drawPlankHoles(ctx, p, state);
    }
    // falling planks tumble away over everything
    for (const p of state.planks) {
      if (p.state === 'falling') this.drawPlank(ctx, p, state, true);
    }
    // the parking tray (2 neutral slots) sits below the planks
    this.drawParkingTray(ctx, state);
    // lift / place / cancel / free-fly screw animations
    for (const a of state.anims) this.drawAnimScrew(ctx, a);
    // held screw follows the cursor, drawn above all planks
    if (state.held) this.drawHeldScrew(ctx, state);

    this.drawParticles(ctx);

    ctx.restore();
  }

  drawBoardBase(ctx) {
    const { w, h } = this.board;
    ctx.save();
    // shadow bed under board
    ctx.fillStyle = 'rgba(0,0,0,.45)';
    rrect(ctx, -14, 8, w + 28, h + 26, 34);
    ctx.fill();
    // board slab
    rrect(ctx, -12, -12, w + 24, h + 24, 30);
    ctx.save();
    ctx.clip();
    ctx.drawImage(this.boardTex, -12, -12, w + 24, h + 24);
    // vignette + light from top-left (sun-lit bench)
    const g = ctx.createRadialGradient(w * 0.28, h * 0.12, 60, w * 0.5, h * 0.5, h * 0.85);
    g.addColorStop(0, 'rgba(255,205,130,.13)');
    g.addColorStop(0.55, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,.42)');
    ctx.fillStyle = g;
    ctx.fillRect(-12, -12, w + 24, h + 24);
    ctx.restore();
    // beveled rim
    ctx.lineWidth = 5;
    ctx.strokeStyle = 'rgba(255,214,150,.16)';
    rrect(ctx, -9, -10, w + 18, h + 21, 28);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,.5)';
    rrect(ctx, -11, -6, w + 22, h + 17, 29);
    ctx.stroke();
    ctx.restore();
  }

  /* ---------- the parking tray: 2 neutral buffer slots below the planks ---------- */
  drawParkingTray(ctx, state) {
    const slots = state.parking;
    if (!slots || !slots.length) return;
    const holding = !!state.held;
    const cx = (slots[0].x + slots[slots.length - 1].x) / 2;
    const cy = slots[0].y;
    const tw = (slots[slots.length - 1].x - slots[0].x) + 152;
    const th = 106;
    const x0 = cx - tw / 2, y0 = cy - th / 2 + 6;

    ctx.save();
    // soft shadow under the tray
    ctx.save();
    ctx.translate(4, 7);
    ctx.shadowColor = 'rgba(10,4,0,.55)';
    ctx.shadowBlur = 16;
    ctx.fillStyle = 'rgba(0,0,0,.5)';
    rrect(ctx, x0, y0, tw, th, 24);
    ctx.fill();
    ctx.restore();

    // tray body
    ctx.save();
    rrect(ctx, x0, y0, tw, th, 24);
    ctx.clip();
    ctx.drawImage(this.trayTex, x0, y0, tw, th);
    const vg = ctx.createLinearGradient(x0, y0, x0, y0 + th);
    vg.addColorStop(0, 'rgba(255,225,170,.13)');
    vg.addColorStop(0.5, 'rgba(255,255,255,0)');
    vg.addColorStop(1, 'rgba(0,0,0,.22)');
    ctx.fillStyle = vg;
    ctx.fillRect(x0, y0, tw, th);
    ctx.restore();

    // bevel rim
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = 'rgba(255,225,170,.25)';
    rrect(ctx, x0 + 1.5, y0 + 1.5, tw - 3, th - 3, 22);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(28,12,2,.55)';
    rrect(ctx, x0, y0, tw, th, 24);
    ctx.stroke();

    // carved label
    ctx.textAlign = 'center';
    ctx.font = '700 15px Nunito, sans-serif';
    ctx.fillStyle = 'rgba(255,226,180,.14)';
    ctx.fillText('P A R K I N G', cx, y0 + 22);
    ctx.fillStyle = 'rgba(26,10,2,.6)';
    ctx.fillText('P A R K I N G', cx, y0 + 21);

    // slots
    for (const s of slots) {
      const key = s.slot ? s.key : s.id;
      const isHome = holding && state.held.homeHole === key;
      if (s.screw !== null) {
        const sc = state.screws[s.screw];
        if (sc.busy) {
          this.drawHole(ctx, s.x, s.y, {});
        } else {
          this.drawScrewHead(ctx, s.x, s.y, sc.slotAngle, {});
          if (!holding && state.focusScrew === sc.id) {
            ctx.save();
            ctx.strokeStyle = 'rgba(63,168,160,.95)';
            ctx.lineWidth = 3.5;
            ctx.setLineDash([7, 6]);
            ctx.lineDashOffset = -this.time * 30;
            ctx.beginPath(); ctx.arc(s.x, s.y, 29, 0, TAU); ctx.stroke();
            ctx.restore();
          }
        }
      } else {
        const highlight = holding && !isHome;
        const hovered = highlight && state.hoverHole === key;
        this.drawHole(ctx, s.x, s.y, { highlight, hovered, isHome });
      }
    }
    ctx.restore();
  }

  drawPlank(ctx, p, state, falling) {
    const t = this.time;
    let dx = 0, dy = 0, rot = p.angle, alpha = 1;

    if (falling) {
      dx = p.fx; dy = p.fy; rot += p.frot; alpha = clamp(1 - p.fall * 0.25, 0, 1);
    } else if (p.shiver) {
      const s = Math.sin(t * 26 + p.id * 1.7) * 0.011 * p.shiverAmt;
      rot += s;
      dx = Math.sin(t * 31 + p.id) * 1.4 * p.shiverAmt;
      dy = Math.cos(t * 27 + p.id * 2) * 1.1 * p.shiverAmt;
    }

    const depth = state.topZ - p.z;   // 0 = top plank

    ctx.save();
    ctx.translate(p.x + dx, p.y + dy);
    ctx.rotate(rot);
    ctx.globalAlpha = alpha;

    // drop shadow — deeper planks have tighter shadows; falling planks cast big soft ones
    const shOff = falling ? 18 + p.fall * 30 : 10 + depth * 2.5;
    const shBlur = falling ? 26 : 14;
    ctx.save();
    ctx.translate(shOff * 0.6, shOff);
    ctx.shadowColor = 'rgba(12,4,0,.6)';
    ctx.shadowBlur = shBlur;
    ctx.shadowOffsetY = 0;
    ctx.fillStyle = 'rgba(0,0,0,.5)';
    rrect(ctx, -p.len / 2, -p.wid / 2, p.len, p.wid, p.wid / 2.6);
    ctx.fill();
    ctx.restore();

    // body
    const tex = this.plankTexture(p);
    ctx.save();
    rrect(ctx, -p.len / 2, -p.wid / 2, p.len, p.wid, p.wid / 2.6);
    ctx.clip();
    ctx.drawImage(tex, -p.len / 2 - 2, -p.wid / 2 - 2, p.len + 4, p.wid + 4);

    // dimming for depth (ambient occlusion from stack above)
    if (!falling && depth > 0) {
      ctx.fillStyle = `rgba(10,4,0,${Math.min(0.34, 0.13 + depth * 0.09)})`;
      ctx.fillRect(-p.len / 2 - 2, -p.wid / 2 - 2, p.len + 4, p.wid + 4);
    }
    // top-left sunlight kiss
    const hg = ctx.createLinearGradient(-p.len / 2, -p.wid / 2, p.len / 3, p.wid / 2);
    hg.addColorStop(0, 'rgba(255,235,190,.14)');
    hg.addColorStop(0.5, 'rgba(255,255,255,0)');
    hg.addColorStop(1, 'rgba(0,0,0,.12)');
    ctx.fillStyle = hg;
    ctx.fillRect(-p.len / 2 - 2, -p.wid / 2 - 2, p.len + 4, p.wid + 4);
    ctx.restore();

    // rounded bevel edge
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(255,225,170,.22)';
    rrect(ctx, -p.len / 2 + 1.5, -p.wid / 2 + 1.5, p.len - 3, p.wid - 3, p.wid / 2.6 - 1.5);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(30,12,2,.5)';
    rrect(ctx, -p.len / 2, -p.wid / 2, p.len, p.wid, p.wid / 2.6);
    ctx.stroke();

    ctx.restore();
  }

  /* ---------- holes + seated screws for one plank ---------- */
  drawPlankHoles(ctx, p, state) {
    const holding = !!state.held;
    for (const h of state.holes) {
      if (h.plank !== p.id) continue;
      const pos = state.holePos(h);
      const covered = !state.holeVisible(h);
      const isHome = holding && state.held.homeHole === h.id;

      if (h.screw !== null) {
        const sc = state.screws[h.screw];
        if (sc.busy) { this.drawHole(ctx, pos.x, pos.y, { covered, dim: covered }); continue; }
        this.drawScrewHead(ctx, pos.x, pos.y, sc.slotAngle, { covered, dim: covered });
        // keyboard focus ring on liftable screws
        if (!covered && !holding && state.focusScrew === sc.id) {
          ctx.save();
          ctx.strokeStyle = 'rgba(63,168,160,.95)';
          ctx.lineWidth = 3.5;
          ctx.setLineDash([7, 6]);
          ctx.lineDashOffset = -this.time * 30;
          ctx.beginPath(); ctx.arc(pos.x, pos.y, 29, 0, TAU); ctx.stroke();
          ctx.restore();
        }
      } else {
        // empty hole
        const validTarget = holding && !covered && !isHome;
        const hovered = validTarget && state.hoverHole === h.id;
        this.drawHole(ctx, pos.x, pos.y, {
          covered, dim: covered,
          highlight: validTarget,
          hovered,
          isHome,
          phase: (this.time * 2.2 + h.id * 0.9) % 1,
        });
      }
    }
  }

  /* ---------- an open screw-hole ---------- */
  drawHole(ctx, x, y, opts = {}) {
    const { covered = false, dim = false, highlight = false, hovered = false, isHome = false, phase = 0 } = opts;
    ctx.save();
    ctx.translate(x, y);
    if (dim) ctx.globalAlpha = 0.5;

    if (highlight) {
      // pulsing teal target ring
      const pulse = 0.5 + 0.5 * Math.sin(this.time * 5 + x * 0.01);
      const R = hovered ? 34 : 28 + pulse * 4;
      ctx.strokeStyle = hovered ? 'rgba(127,232,222,.98)' : `rgba(63,168,160,${0.55 + pulse * 0.4})`;
      ctx.lineWidth = hovered ? 5 : 3.5;
      ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.stroke();
      if (hovered) {
        ctx.fillStyle = 'rgba(63,168,160,.22)';
        ctx.beginPath(); ctx.arc(0, 0, R - 2, 0, TAU); ctx.fill();
      }
    } else if (isHome) {
      // dashed amber "home" ring — clicking it cancels
      ctx.strokeStyle = 'rgba(224,163,62,.8)';
      ctx.lineWidth = 3;
      ctx.setLineDash([6, 7]);
      ctx.lineDashOffset = -this.time * 24;
      ctx.beginPath(); ctx.arc(0, 0, 28, 0, TAU); ctx.stroke();
      ctx.setLineDash([]);
    } else if (!covered) {
      // faint rim so empty holes read as usable even when not holding
      ctx.strokeStyle = 'rgba(244,232,208,.16)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, 0, 24, 0, TAU); ctx.stroke();
    }

    // bored socket
    const g = ctx.createRadialGradient(0, 0, 1, 0, 0, 15);
    g.addColorStop(0, 'rgba(8,3,0,.85)');
    g.addColorStop(0.55, 'rgba(20,8,2,.55)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, 15, 0, TAU); ctx.fill();
    ctx.fillStyle = covered ? 'rgba(5,2,0,.55)' : 'rgba(5,2,0,.8)';
    ctx.beginPath(); ctx.arc(0, 0, 7.5, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(255,220,160,.16)';
    ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(0, -0.8, 7.5, Math.PI * 1.05, Math.PI * 1.95); ctx.stroke();
    ctx.restore();
  }

  /* ---------- one glossy steel screw head ---------- */
  drawScrewHead(ctx, x, y, rot, opts = {}) {
    const { covered = false, dim = false, liftK = 0, ghost = false, glintId = 0, glow = false } = opts;
    const R = 19;
    ctx.save();
    ctx.translate(x, y);

    if (covered) {
      // ghost under the plank above: dim, recessed, with lock glyph
      ctx.globalAlpha = 0.42;
      ctx.fillStyle = 'rgba(10,5,2,.55)';
      ctx.beginPath(); ctx.arc(0, 1.5, R + 3, 0, TAU); ctx.fill();
      const g = ctx.createRadialGradient(-4, -5, 2, 0, 0, R);
      g.addColorStop(0, '#6d7680');
      g.addColorStop(1, '#31383f');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.fill();
      ctx.globalAlpha = 0.55;
      ctx.strokeStyle = '#e8ddc8';
      ctx.fillStyle = '#e8ddc8';
      ctx.lineWidth = 2.6;
      ctx.beginPath(); ctx.arc(0, -3.5, 5, Math.PI, 0); ctx.stroke();
      rrect(ctx, -7.5, -3.5, 15, 12, 3); ctx.fill();
      ctx.fillStyle = '#31383f';
      ctx.beginPath(); ctx.arc(0, 1.5, 2.2, 0, TAU); ctx.fill();
      ctx.fillRect(-1.1, 2.2, 2.2, 4);
      ctx.restore();
      return;
    }

    if (dim) ctx.globalAlpha = 0.5;
    if (ghost) ctx.globalAlpha = 0.6;

    // lift: the head rises, scales up and its shadow softens
    const scale = 1 + liftK * 0.3;
    const rise = liftK * 30;

    // rust-amber ring around the seat
    if (liftK < 0.6 && !ghost) {
      const rg = ctx.createRadialGradient(0, 0, R - 1, 0, 0, R + 5);
      rg.addColorStop(0, 'rgba(196,120,50,.5)');
      rg.addColorStop(1, 'rgba(196,120,50,0)');
      ctx.fillStyle = rg;
      ctx.beginPath(); ctx.arc(0, 0, R + 5, 0, TAU); ctx.fill();
    }

    // cast shadow on the wood (stays behind as the screw lifts)
    ctx.globalAlpha = (ghost ? 0.3 : 0.45) * (1 - liftK * 0.6);
    ctx.fillStyle = 'rgba(8,3,0,.6)';
    ctx.beginPath(); ctx.ellipse(0, 2.2, R + 1.5, R * 0.8, 0, 0, TAU); ctx.fill();
    ctx.globalAlpha = ghost ? 0.6 : (dim ? 0.5 : 1);

    if (glow) {
      ctx.save();
      ctx.shadowColor = 'rgba(127,232,222,.95)';
      ctx.shadowBlur = 22;
      ctx.fillStyle = 'rgba(127,232,222,.25)';
      ctx.beginPath(); ctx.arc(0, -rise, R + 6, 0, TAU); ctx.fill();
      ctx.restore();
    }

    ctx.translate(0, -rise);
    ctx.scale(scale, scale);

    // idle glint shimmer on seated screws
    const glintPhase = (this.time * 0.9 + glintId * 1.31) % 3.4;
    const glint = liftK === 0 && glintPhase < 0.55 ? Math.sin(glintPhase / 0.55 * Math.PI) : 0;

    // steel head
    const g = ctx.createRadialGradient(-R * 0.35, -R * 0.4, 2, 0, 0, R);
    g.addColorStop(0, '#F2F7FC');
    g.addColorStop(0.35, '#C7D2DC');
    g.addColorStop(0.75, '#8D9AA6');
    g.addColorStop(1, '#5A6672');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.fill();

    // rim light
    ctx.strokeStyle = 'rgba(255,255,255,.55)';
    ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(0, 0, R - 1, Math.PI * 1.1, Math.PI * 1.85); ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,.35)';
    ctx.beginPath(); ctx.arc(0, 0, R - 1, Math.PI * 0.1, Math.PI * 0.85); ctx.stroke();

    // cross slot (Phillips)
    ctx.save();
    ctx.rotate(rot);
    ctx.fillStyle = '#39424B';
    const sw = 5.6, sl = R * 1.28;
    rrect(ctx, -sl / 2, -sw / 2, sl, sw, 2.4); ctx.fill();
    rrect(ctx, -sw / 2, -sl / 2, sw, sl, 2.4); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.28)';
    rrect(ctx, -sl / 2, -sw / 2 + 1, sl, 1.6, 0.8); ctx.fill();
    rrect(ctx, -sw / 2 + 1, -sl / 2, 1.6, sl, 0.8); ctx.fill();
    ctx.restore();

    // cool blue-white specular
    ctx.fillStyle = 'rgba(225,240,255,.85)';
    ctx.beginPath();
    ctx.ellipse(-R * 0.32, -R * 0.38, R * 0.22, R * 0.13, -0.6, 0, TAU);
    ctx.fill();

    if (glint > 0) {
      ctx.save();
      ctx.rotate(-0.6);
      ctx.globalAlpha = glint * 0.9;
      const gg = ctx.createLinearGradient(-R, 0, R, 0);
      gg.addColorStop(0.35, 'rgba(255,255,255,0)');
      gg.addColorStop(0.5, 'rgba(255,255,255,.9)');
      gg.addColorStop(0.65, 'rgba(255,255,255,0)');
      ctx.fillStyle = gg;
      ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }

  /* ---------- lift / place / cancel animations ---------- */
  drawAnimScrew(ctx, a) {
    const liftK = a.kind === 'lift' ? (a.liftK || 0) : Math.max(0.35, a.liftK || 0.35);
    this.drawScrewHead(ctx, a.x, a.y, a.rot, { liftK, glintId: a.screw.id });
  }

  /* ---------- the held screw: floats with the cursor + ghost preview ---------- */
  drawHeldScrew(ctx, state) {
    const h = state.held;
    // ghost preview inside the hovered valid hole
    if (state.hoverHole !== null && state.hoverHole !== undefined) {
      const hole = state.locMap ? state.locMap.get(state.hoverHole) : state.holes[state.hoverHole];
      if (hole && state.hoverHole !== h.homeHole) {
        const pos = state.holePos(hole);
        this.drawScrewHead(ctx, pos.x, pos.y, h.screw.slotAngle, { ghost: true });
      }
    }
    const bobY = Math.sin(h.bob * 6) * 3;
    this.drawScrewHead(ctx, h.px, h.py + bobY, h.screw.slotAngle + Math.sin(h.bob * 2.2) * 0.35,
      { liftK: 0.72, glow: true });
  }

  drawParticles(ctx) {
    for (const p of this.particles) {
      const t = 1 - p.life / p.max;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.globalAlpha = clamp(t * 1.4, 0, 1);
      if (p.kind === 'chip') {
        ctx.fillStyle = p.color || '#8a6234';
        ctx.beginPath();
        ctx.moveTo(-p.size / 2, 0);
        ctx.lineTo(0, -p.size / 3);
        ctx.lineTo(p.size / 2, p.size / 6);
        ctx.lineTo(p.size / 5, p.size / 2);
        ctx.closePath(); ctx.fill();
      } else if (p.kind === 'spark') {
        ctx.fillStyle = p.color || '#FFF2C8';
        ctx.beginPath(); ctx.arc(0, 0, p.size * 0.4 * t + 1, 0, TAU); ctx.fill();
      } else { // confetti
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      }
      ctx.restore();
    }
  }
}
