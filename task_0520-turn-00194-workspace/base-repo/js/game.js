// game.js — RELOCATION state machine:
// lift a screw (held) -> place into a highlighted empty hole -> planks with
// zero screws fall. Includes undo stack, manual restart, cursor-follow held
// screw, keyboard play, timer, and all feel/juice.
import { BOARD, pointInPlank } from './generator.js';
import { GameRenderer } from './renderer.js';
import { clamp, formatTime } from './util.js';
import { sfx } from './audio.js';

const LIFT_TIME = 0.34;    // spin-out wind-up before the screw is held
const PLACE_TIME = 0.30;   // spin-in when placing
const CANCEL_TIME = 0.24;  // quick spin back home on cancel

/* coarse overlap test between two planks (for the trapped-plank rule) */
let _covRng = 12345;
function coveredShare(a, b) {
  let hit = 0;
  const N = 14;
  const c = Math.cos(a.angle), s = Math.sin(a.angle);
  for (let i = 0; i < N; i++) {
    _covRng = (_covRng * 1103515245 + 12345) & 0x7fffffff;
    const r1 = _covRng / 0x7fffffff;
    _covRng = (_covRng * 1103515245 + 12345) & 0x7fffffff;
    const r2 = _covRng / 0x7fffffff;
    const lx = (r1 - 0.5) * a.len;
    const ly = (r2 - 0.5) * a.wid;
    const wx = a.x + lx * c - ly * s;
    const wy = a.y + lx * s + ly * c;
    if (pointInPlank(wx, wy, b)) hit++;
  }
  return hit >= 2;
}

export class Game {
  constructor(canvas, hooks) {
    this.canvas = canvas;
    this.renderer = new GameRenderer(canvas, BOARD);
    this.hooks = hooks;          // {onWin, onLose, onTick, onCombo, onLevelStart, onHistory}
    this.state = 'idle';         // idle | playing | paused | won | lost
    this.planks = [];
    this.holes = [];
    this.screws = [];
    this.anims = [];             // lift/place/cancel screw animations
    this.topZ = 0;
    this.timeLeft = 0;
    this.timeTotal = 0;
    this.slowmo = 1;
    this._epoch = 0;
    this._idleMs = 0;
    this._pauseSpan = 0;
    this._pauseAt = 0;
    this._announced = false;
    this.held = null;            // {screw, hx, hy, px, py, homeHole}
    this.cursor = null;          // board-space pointer for held-screw follow
    this.hoverHole = null;       // hole id the cursor is over (valid target)
    this.history = [];           // undo stack
    this.focusScrew = null;      // keyboard-focused screw id
    this.shakeEnabled = true;
    this._deniedAt = 0;
    this._lastPlaceAt = 0;
    this._combo = 0;

    this._onDown = this.handlePointer.bind(this);
    this._onMove = this.handleMove.bind(this);
    canvas.addEventListener('pointerdown', this._onDown);
    canvas.addEventListener('pointermove', this._onMove);
    canvas.tabIndex = 0;
    this._onKey = this.handleKey.bind(this);
    canvas.addEventListener('keydown', this._onKey);
    this._loop = this.loop.bind(this);
    this.raf = null;
    this.lastT = 0;
  }

  get topZcalc() {
    let z = 0;
    for (const p of this.planks) if (p.state === 'alive') z = Math.max(z, p.z);
    return z;
  }

  /* ================= level setup ================= */
  loadLevel(levelData) {
    this.levelData = levelData;
    this.planks = levelData.planks.map(p => ({
      ...p, state: 'alive',
      shiver: false, shiverAmt: 0,
      fx: 0, fy: 0, frot: 0, fall: 0, vx: 0, vy: 0, vr: 0,
      landed: false, whooshed: false, floorY: BOARD.h * 0.92,
    }));
    this.holes = levelData.holes.map(h => ({ ...h }));
    this.screws = [];
    for (const h of this.holes) {
      if (!h.filled) continue;
      this.screws.push({
        id: this.screws.length,
        hole: h.id,
        slotAngle: ((h.id * 137) % 360) * Math.PI / 180,
        busy: false,
      });
      h.screw = this.screws[this.screws.length - 1].id;
    }
    for (const h of this.holes) if (h.screw === undefined) h.screw = null;
    this.anims = [];
    this.held = null;
    this.cursor = null;
    this.hoverHole = null;
    this.history = [];
    this.focusScrew = null;
    this.renderer.particles.length = 0;
    this.renderer.clearCache();
    this.topZ = this.topZcalc;
    this.timeTotal = levelData.timeLimit;
    this.timeLeft = levelData.timeLimit;
    this.state = 'playing';
    this.slowmo = 1;
    this.renderer.updateParticles(0);
    this.armClock(true);
    this.syncSession();
    this.startLoop();
  }

  clockMs() {
    if (!this._epoch) return 0;
    return performance.now() - this._epoch - this._idleMs;
  }

  armClock(fresh) {
    const now = performance.now();
    this.lastT = now;
    if (fresh) {
      this._epoch = now;
      this._idleMs = 0;
      this._pauseSpan = 0;
      this._pauseAt = now;
      this._announced = false;
    }
    this._lastTickSec = Math.ceil(this.timeTotal - this.clockMs() / 1000);
    if (!this._announced && this.levelData && this.hooks.onLevelStart) {
      this._announced = false;
      this.hooks.onLevelStart(this.levelData.level);
    }
  }

  syncSession() {
    this.hoverHole = null;
    this._combo = 1;
    this._lastPlaceAt = this.clockMs();
    this.history.length = 0;
    for (const p of this.planks) {
      if (p.state !== 'alive') continue;
      p.shiver = false;
      p.shiverAmt = 0;
      p.trapped = false;
    }
    this.updateShivers();
    this.pruneFocus();
    this.emitHistory();
  }

  restart() {
    if (!this.levelData) return;
    sfx.play('click');
    this.loadLevel(this.levelData);
  }

  /* ================= geometry helpers ================= */
  holePos(h) {
    const p = this.planks[h.plank];
    if (p.state !== 'alive') return { x: h.x, y: h.y };
    const c = Math.cos(p.angle), s = Math.sin(p.angle);
    return { x: p.x + h.lx * c - h.ly * s, y: p.y + h.lx * s + h.ly * c };
  }

  holeVisible(h) {
    const pos = this.holePos(h);
    for (let z = h.plank + 1; z < this.planks.length; z++) {
      const q = this.planks[z];
      if (q.state !== 'alive') continue;
      if (pointInPlank(pos.x, pos.y, q, 4)) return false;
    }
    return true;
  }

  plankScrewCount(plankId) {
    let n = 0;
    for (const h of this.holes) if (h.plank === plankId && h.screw !== null) n++;
    return n;
  }

  /* ================= interaction ================= */
  screenPoint(e) {
    const rect = this.canvas.getBoundingClientRect();
    return this.renderer.screenToBoard(e.clientX - rect.left, e.clientY - rect.top);
  }

  handleMove(e) {
    this.cursor = this.screenPoint(e);
    this.hoverHole = null;
    if (this.held && this.state === 'playing') {
      const h = this.holeAt(this.cursor, true);
      this.hoverHole = h ? h.id : null;
    }
  }

  holeAt(pt, onlyValidTargets = false) {
    // search top-down so holes on higher planks win
    for (let z = this.planks.length - 1; z >= 0; z--) {
      const p = this.planks[z];
      if (p.state !== 'alive') continue;
      for (const h of this.holes) {
        if (h.plank !== p.id) continue;
        if (onlyValidTargets && h.screw !== null) continue;
        const pos = this.holePos(h);
        const dx = pt.x - pos.x, dy = pt.y - pos.y;
        const hitR = Math.max(30, 24 / this.renderer.scale);
        if (dx * dx + dy * dy <= hitR * hitR) {
          if (onlyValidTargets && !this.holeVisible(h)) return null;  // covered: not a target
          return h;
        }
      }
    }
    return null;
  }

  screwAt(pt) {
    const hitR = Math.max(30, 24 / this.renderer.scale);
    for (let z = this.planks.length - 1; z >= 0; z--) {
      const p = this.planks[z];
      if (p.state !== 'alive') continue;
      for (const h of this.holes) {
        if (h.plank !== p.id || h.screw === null) continue;
        const sc = this.screws[h.screw];
        if (sc.busy) continue;
        const pos = this.holePos(h);
        const dx = pt.x - pos.x, dy = pt.y - pos.y;
        if (dx * dx + dy * dy <= hitR * hitR) return { screw: sc, hole: h };
      }
    }
    return null;
  }

  handlePointer(e) {
    if (this.state !== 'playing') return;
    sfx.unlock();
    this.canvas.focus({ preventScroll: true });
    const pt = this.screenPoint(e);
    this.cursor = pt;

    /* ---- holding a screw: try to place / cancel ---- */
    if (this.held) {
      const target = this.holeAt(pt, true);
      if (target) {
        if (target.id === this.held.homeHole) { this.cancelHeld(); return; }
        this.placeHeld(target);
        return;
      }
      // clicked anything else: cancel back home
      this.cancelHeld();
      return;
    }

    /* ---- not holding: try to lift a screw ---- */
    const hit = this.screwAt(pt);
    if (hit) {
      if (!this.holeVisible(hit.hole)) { this.deny(this.holePos(hit.hole)); return; }
      this.beginLift(hit.screw, hit.hole);
      return;
    }

    /* ---- tapped a covered ghost screw? feedback ---- */
    for (const h of this.holes) {
      if (h.screw === null) continue;
      const pos = this.holePos(h);
      const dx = pt.x - pos.x, dy = pt.y - pos.y;
      if (dx * dx + dy * dy <= 34 * 34 && !this.holeVisible(h)) {
        this.deny(pos);
        return;
      }
    }
  }

  deny(pos) {
    const now = performance.now();
    if (now - this._deniedAt < 250) return;
    this._deniedAt = now;
    sfx.play('denied');
    this.renderer.burst(pos.x, pos.y, { n: 5, kind: 'spark', color: '#d8b090', speed: 90, up: 30, life: 0.4, size: 5 });
  }

  /* ---- lift ---- */
  beginLift(screw, hole) {
    screw.busy = true;
    this.pushHistory({ type: 'lift', screw: screw.id, hole: hole.id });
    const pos = this.holePos(hole);
    this.anims.push({
      kind: 'lift', screw, hole,
      t: 0, dur: LIFT_TIME,
      x: pos.x, y: pos.y,
      rot: screw.slotAngle,
    });
    sfx.play('windup');
  }

  finishLift(anim) {
    const { screw, hole } = anim;
    hole.screw = null;                    // source hole becomes empty
    this.held = {
      screw, homeHole: hole.id,
      hx: anim.x, hy: anim.y,
      px: anim.x, py: anim.y,
      bob: 0,
    };
    this.updateShivers();
    this.emitHistory();
  }

  /* ---- cancel ---- */
  cancelHeld() {
    const held = this.held;
    this.held = null;
    const hole = this.holes[held.homeHole];
    const pos = this.holePos(hole);
    this.anims.push({
      kind: 'cancel', screw: held.screw, hole,
      t: 0, dur: CANCEL_TIME,
      x0: held.px, y0: held.py, x1: pos.x, y1: pos.y,
      rot: held.screw.slotAngle + 3,
    });
    sfx.play('cancel');
    this.pushHistory({ type: 'cancel', screw: held.screw.id, hole: hole.id });
    this.emitHistory();
  }

  finishCancel(anim) {
    anim.hole.screw = anim.screw.id;
    anim.screw.busy = false;
  }

  /* ---- place ---- */
  placeHeld(hole) {
    const held = this.held;
    this.held = null;
    const pos = this.holePos(hole);
    this.anims.push({
      kind: 'place', screw: held.screw, hole,
      t: 0, dur: PLACE_TIME,
      x0: held.px, y0: held.py, x1: pos.x, y1: pos.y,
      rot: held.screw.slotAngle + 3,
    });
    sfx.play('screwin');
    this.pushHistory({ type: 'place', screw: held.screw.id, from: held.homeHole, to: hole.id, fell: [] });
  }

  finishPlace(anim) {
    anim.hole.screw = anim.screw.id;
    anim.screw.busy = false;
    const pos = this.holePos(anim.hole);
    this.renderer.burst(pos.x, pos.y, { n: 6, kind: 'spark', color: '#FFE9B0', speed: 150, up: 90, life: 0.35, size: 5 });
    if (this.shakeEnabled) this.renderer.addShake(2);

    // combo feel for quick consecutive placements
    const nowMs = this.clockMs();
    this._combo = (nowMs - this._lastPlaceAt < 2200) ? this._combo + 1 : 1;
    this._lastPlaceAt = nowMs;
    if (this._combo >= 3 && this.hooks.onCombo) this.hooks.onCombo(this._combo, pos.x, pos.y);

    // record the move then cascade drops
    const rec = this.history[this.history.length - 1];
    const fell = this.cascadeDrops();
    if (rec && rec.type === 'place') rec.fell = fell;
    this.updateShivers();
    this.emitHistory();
    this.checkWin();
  }

  /* ---- planks fall only when truly clearable: zero screws AND fully
        uncovered. A plank emptied under a cover is TRAPPED — its buried
        screws can never leave (zero-spare capacity), so it can never fall.
        It visibly shivers to signal the mistake. Undo is the way out. ---- */
  plankTrapped(p) {
    if (this.plankScrewCount(p.id) !== 0) return false;
    for (let z = p.id + 1; z < this.planks.length; z++) {
      const q = this.planks[z];
      if (q.state !== 'alive') continue;
      // any overlap at all traps it (screws under q can't be reached)
      const reach = (Math.max(p.len, p.wid) + Math.max(q.len, q.wid)) / 2;
      const dx = p.x - q.x, dy = p.y - q.y;
      if (dx * dx + dy * dy > reach * reach) continue;
      if (coveredShare(p, q)) return true;
    }
    return false;
  }

  plankClearable(p) {
    if (this.plankScrewCount(p.id) !== 0) return false;
    return !this.plankTrapped(p);
  }

  cascadeDrops() {
    const fell = [];
    let changed = true;
    let guard = 0;
    while (changed && guard++ < 20) {
      changed = false;
      for (const p of this.planks) {
        if (p.state !== 'alive') continue;
        if (this.plankClearable(p)) {
          this.dropPlank(p);
          fell.push(p.id);
          changed = true;
        }
      }
    }
    return fell;
  }

  dropPlank(p) {
    p.state = 'falling';
    p.fall = 0; p.fx = 0; p.fy = 0; p.frot = 0;
    p.vy = -60 - Math.random() * 60;
    p.vx = (Math.random() - 0.5) * 160;
    p.vr = (Math.random() < 0.5 ? -1 : 1) * (0.8 + Math.random() * 1.6);
    p.landed = false;
    p.whooshed = false;
    p.floorY = BOARD.h * 0.92;
    sfx.play('thunk');
    if (this.shakeEnabled) this.renderer.addShake(7);
    this.renderer.burst(p.x, p.y + p.wid / 2, { n: 12, kind: 'chip', color: '#5a3a1e', speed: 300, up: 40, life: 0.8, size: 9 });
    this.topZ = this.topZcalc;
  }

  /* ---- undo ---- */
  pushHistory(rec) {
    this.history.push(rec);
    if (this.history.length > 400) this.history.shift();
  }

  emitHistory() {
    if (this.hooks.onHistory) this.hooks.onHistory(this.history.length > 0);
  }

  undo() {
    if (this.state !== 'playing' || this.held || this.anims.length) return;
    const rec = this.history.pop();
    if (!rec) { sfx.play('denied'); return; }
    sfx.play('undo');

    if (rec.type === 'lift') {
      // screw is still in its hole (lift anim completed -> hole emptied? no:
      // if the lift finished, the screw became HELD — but undo is disabled
      // while holding, so a completed lift means the screw was placed/cancelled
      // afterwards, which produced later records. A bare 'lift' at the top of
      // the stack only happens if the lift anim is still running — guarded.
      return;
    }
    if (rec.type === 'cancel') {
      // revert: lift the screw back out of that hole
      const hole = this.holes[rec.hole];
      const screw = this.screws[rec.screw];
      if (hole.screw === screw.id) {
        hole.screw = null;
        const pos = this.holePos(hole);
        this.held = { screw, homeHole: hole.id, hx: pos.x, hy: pos.y, px: pos.x, py: pos.y, bob: 0 };
        screw.busy = false;
      }
    }
    if (rec.type === 'place') {
      const screw = this.screws[rec.screw];
      const toHole = this.holes[rec.to];
      const fromHole = this.holes[rec.from];
      // un-fall planks (reverse order they fell)
      for (let i = rec.fell.length - 1; i >= 0; i--) {
        const p = this.planks[rec.fell[i]];
        p.state = 'alive';
        p.fx = 0; p.fy = 0; p.frot = 0; p.fall = 0;
        this.renderer.burst(p.x, p.y, { n: 8, kind: 'chip', color: '#8a6234', speed: 220, up: 140, life: 0.6, size: 7 });
      }
      this.topZ = this.topZcalc;
      // move screw back to its source hole
      if (toHole.screw === screw.id) toHole.screw = null;
      fromHole.screw = screw.id;
      screw.busy = false;
      this.renderer.burst(this.holePos(fromHole).x, this.holePos(fromHole).y,
        { n: 5, kind: 'spark', color: '#BFE8E4', speed: 140, up: 80, life: 0.4, size: 5 });
    }
    this.updateShivers();
    this.emitHistory();
  }

  /* ---- shiver tells: last-screw planks tremble; trapped planks strain ---- */
  updateShivers() {
    for (const p of this.planks) {
      if (p.state !== 'alive') { p.shiver = false; p.trapped = false; continue; }
      const left = this.plankScrewCount(p.id);
      p.trapped = this.plankTrapped(p);
      p.shiver = left === 1 || p.trapped;
      p.shiverAmt = p.trapped ? 1.6 : (left === 1 ? 1 : 0);
    }
  }

  /* ---- win ---- */
  checkWin() {
    const aliveLeft = this.planks.filter(q => q.state === 'alive');
    if (aliveLeft.length) {
      // deadlock nudge: every remaining plank is trapped or no moves exist
      const anyTrapped = aliveLeft.some(p => p.trapped);
      if (anyTrapped && this.hooks.onDeadlock) this.hooks.onDeadlock();
      return;
    }
    this.state = 'won';
    this.slowmo = 0.45;
    const stats = {
      timeLeft: this.timeLeft,
      timeTotal: this.timeTotal,
      level: this.levelData.level,
    };
    setTimeout(() => { this.slowmo = 1; }, 650);
    setTimeout(() => {
      this.renderer.confetti(BOARD.w / 2, BOARD.h * 0.35);
      this.renderer.confetti(BOARD.w * 0.25, BOARD.h * 0.5);
      this.renderer.confetti(BOARD.w * 0.75, BOARD.h * 0.5);
      sfx.play('win');
    }, 700);
    setTimeout(() => this.hooks.onWin(stats), 1750);
  }

  /* ================= keyboard play ================= */
  liftableScrews() {
    const out = [];
    for (const h of this.holes) {
      if (h.screw === null) continue;
      const sc = this.screws[h.screw];
      if (sc.busy) continue;
      if (!this.holeVisible(h)) continue;
      const pos = this.holePos(h);
      out.push({ screw: sc, hole: h, x: pos.x, y: pos.y });
    }
    return out.sort((a, b) => (a.y - b.y) || (a.x - b.x));
  }

  validTargets() {
    if (!this.held) return [];
    return this.holes
      .filter(h => h.screw === null && this.planks[h.plank].state === 'alive' && this.holeVisible(h))
      .map(h => ({ hole: h, ...this.holePos(h) }))
      .sort((a, b) => (a.y - b.y) || (a.x - b.x));
  }

  handleKey(e) {
    if (this.state !== 'playing') return;
    const k = e.key;
    if (k === 'z' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); this.undo(); return; }
    if (k === 'Escape' && this.held) { e.preventDefault(); this.cancelHeld(); return; }
    if (k !== 'Tab' && k !== 'Enter' && k !== ' ' && !k.startsWith('Arrow')) return;
    e.preventDefault();
    sfx.unlock();

    if (this.held) {
      const targets = this.validTargets();
      if (!targets.length) return;
      if (k === 'Enter' || k === ' ') {
        const pick = targets.find(t => t.hole.id === this.hoverHole) || targets[0];
        if (pick.hole.id === this.held.homeHole) this.cancelHeld();
        else this.placeHeld(pick.hole);
        this.hoverHole = null;
        return;
      }
      const dir = (k === 'Tab' && e.shiftKey) || k === 'ArrowUp' || k === 'ArrowLeft' ? -1 : 1;
      const idx = targets.findIndex(t => t.hole.id === this.hoverHole);
      const next = idx === -1 ? (dir === 1 ? 0 : targets.length - 1) : (idx + dir + targets.length) % targets.length;
      this.hoverHole = targets[next].hole.id;
      sfx.play('peg');
      return;
    }

    const list = this.liftableScrews();
    if (!list.length) return;
    if (k === 'Enter' || k === ' ') {
      const pick = list.find(l => l.screw.id === this.focusScrew) || list[0];
      this.beginLift(pick.screw, pick.hole);
      return;
    }
    const dir = (k === 'Tab' && e.shiftKey) || k === 'ArrowUp' || k === 'ArrowLeft' ? -1 : 1;
    const idx = list.findIndex(l => l.screw.id === this.focusScrew);
    const next = idx === -1 ? (dir === 1 ? 0 : list.length - 1) : (idx + dir + list.length) % list.length;
    this.focusScrew = list[next].screw.id;
    sfx.play('peg');
  }

  pruneFocus() {
    if (this.focusScrew === null) return;
    if (!this.liftableScrews().some(l => l.screw.id === this.focusScrew)) {
      const list = this.liftableScrews();
      this.focusScrew = list.length ? list[0].screw.id : null;
    }
  }

  /* ================= main loop ================= */
  startLoop() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.lastT = performance.now();
    this.raf = requestAnimationFrame(this._loop);
  }
  stopLoop() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = null;
  }
  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this._idleMs += this._pauseSpan;
    this._pauseSpan = 0;
    this._pauseAt = performance.now();
  }
  resume() {
    if (this.state !== 'paused') return;
    this._pauseSpan = performance.now() - this._pauseAt;
    this.state = 'playing';
    this.armClock(false);
    this.syncSession();
  }

  loop(now) {
    this.raf = requestAnimationFrame(this._loop);
    let dt = (now - this.lastT) / 1000;
    this.lastT = now;
    dt = Math.min(dt, 0.05);
    if (this.slowmo < 1) this.slowmo = Math.min(1, this.slowmo + dt * 1.2);
    const sdt = dt * this.slowmo;

    if (this.state === 'playing' || this.state === 'won') {
      if (this.state === 'playing') {
        const spent = this.clockMs() / 1000;
        this.timeLeft = clamp(this.timeTotal - spent, 0, this.timeTotal);
        const sec = Math.ceil(this.timeLeft);
        if (sec !== this._lastTickSec) {
          this._lastTickSec = sec;
          this.hooks.onTick(this.timeLeft);
          if (this.timeLeft <= 5.2 && this.timeLeft > 0) sfx.play('tick');
        }
        if (this.timeLeft <= 0) {
          this.timeLeft = 0;
          this.state = 'lost';
          sfx.play('lose');
          setTimeout(() => this.hooks.onLose(), 500);
        }
      }

      /* screw lift/place/cancel animations */
      for (let i = this.anims.length - 1; i >= 0; i--) {
        const a = this.anims[i];
        a.t += sdt;
        const k = clamp(a.t / a.dur, 0, 1);
        if (a.kind === 'lift') {
          a.rot = a.screw.slotAngle + Math.sin(k * k * 26) * 0.24 * (1 - k * 0.4) + k * k * 1.4;
          a.liftK = k;
        } else {
          // arc toward target + spin in
          const e = 1 - Math.pow(1 - k, 3);
          a.x = a.x0 + (a.x1 - a.x0) * e;
          a.y = a.y0 + (a.y1 - a.y0) * e - Math.sin(k * Math.PI) * 46;
          a.rot = a.screw.slotAngle + 3 + k * 4.2;
          a.liftK = 1 - k * 0.55;
        }
        if (a.t >= a.dur) {
          this.anims.splice(i, 1);
          if (a.kind === 'lift') this.finishLift(a);
          else if (a.kind === 'place') this.finishPlace(a);
          else this.finishCancel(a);
        }
      }

      /* held screw follows the cursor with springy lag */
      if (this.held && this.cursor) {
        const h = this.held;
        h.bob += sdt;
        const tx = this.cursor.x, ty = this.cursor.y - 26;
        const stiff = 1 - Math.pow(0.0001, sdt);
        h.px += (tx - h.px) * stiff;
        h.py += (ty - h.py) * stiff;
      }

      /* falling planks physics */
      for (const p of this.planks) {
        if (p.state !== 'falling') continue;
        p.fall += sdt;
        p.vy += 2600 * sdt;
        p.fy += p.vy * sdt;
        p.fx += p.vx * sdt;
        p.frot += p.vr * sdt;
        const floor = p.floorY;
        if (!p.whooshed && p.vy > 0 && p.fy > floor - p.y - 220) {
          p.whooshed = true;
          sfx.play('whoosh');
        }
        if (!p.landed && p.fy > floor - p.y + p.wid) {
          p.landed = true;
          p.vy = -p.vy * 0.22;
          p.vr *= 1.6;
          sfx.play('thunkLand');
          if (this.shakeEnabled) this.renderer.addShake(4);
          this.renderer.burst(p.x + p.fx, floor + 14, { n: 14, kind: 'chip', color: '#6e4a26', speed: 380, up: 220, life: 0.9, size: 8 });
          this.renderer.burst(p.x + p.fx, floor + 14, { n: 6, kind: 'spark', color: '#caa06a', speed: 200, up: 120, life: 0.5, size: 6 });
        }
        if (p.landed) {
          p.vx += (p.vx >= 0 ? 1 : -1) * 60 * sdt + p.vr * 30 * sdt;
          if (Math.abs(p.vx) < 140) p.vx += (p.vx >= 0 ? 1 : -1) * 260 * sdt;
        }
        if (p.fall > 2.2 || p.fy > BOARD.h + 500) {
          p.state = 'gone';
          this.topZ = this.topZcalc;
        }
      }
    }

    if (this.state === 'playing') this.pruneFocus();
    this.renderer.draw(dt, this);
  }

  resize(w, h) { this.renderer.resize(w, h); }
  timerText() { return formatTime(this.timeLeft); }
}
