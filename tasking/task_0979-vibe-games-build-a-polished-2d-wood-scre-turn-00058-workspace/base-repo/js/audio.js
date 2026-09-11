// audio.js — tiny WebAudio SFX synth (no assets)
class Sfx {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this._lastTick = -1;
  }
  _ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }
  unlock() { this._ensure(); }

  _env(node, t0, a, peak, d, end = 0.0001) {
    node.gain.setValueAtTime(0.0001, t0);
    node.gain.linearRampToValueAtTime(peak, t0 + a);
    node.gain.exponentialRampToValueAtTime(end, t0 + a + d);
  }
  _osc(type, f0, f1, t0, dur, peak) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur);
    this._env(g, t0, 0.005, peak, dur);
    o.connect(g).connect(this.master);
    o.start(t0); o.stop(t0 + dur + 0.1);
  }
  _noise(t0, dur, peak, filterType = 'bandpass', f0 = 2000, f1 = f0, q = 1) {
    const ctx = this.ctx;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const flt = ctx.createBiquadFilter();
    flt.type = filterType; flt.Q.value = q;
    flt.frequency.setValueAtTime(f0, t0);
    if (f1 !== f0) flt.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
    const g = ctx.createGain();
    this._env(g, t0, 0.004, peak, dur);
    src.connect(flt).connect(g).connect(this.master);
    src.start(t0);
  }

  play(name) {
    if (!this.enabled) return;
    const ctx = this._ensure();
    if (!ctx) return;
    const t = ctx.currentTime;
    switch (name) {
      case 'windup':
        this._noise(t, 0.16, 0.10, 'bandpass', 900, 3200, 2.5);
        this._osc('triangle', 180, 340, t, 0.14, 0.08);
        break;
      case 'pop':
        this._osc('square', 320, 90, t, 0.09, 0.16);
        this._noise(t, 0.08, 0.12, 'highpass', 2500, 1500);
        this._osc('sine', 900, 1400, t + 0.01, 0.07, 0.07);
        break;
      case 'thud':
        this._osc('sine', 130, 45, t, 0.22, 0.5);
        this._noise(t, 0.14, 0.22, 'lowpass', 500, 120);
        break;
      case 'screwin':
        // ratcheting spin-in
        this._noise(t, 0.14, 0.09, 'bandpass', 2400, 900, 2.5);
        this._osc('triangle', 420, 170, t, 0.15, 0.09);
        this._osc('square', 210, 120, t + 0.13, 0.06, 0.10);
        break;
      case 'cancel':
        this._osc('triangle', 380, 250, t, 0.09, 0.07);
        break;
      case 'undo':
        this._osc('triangle', 300, 520, t, 0.09, 0.08);
        this._osc('triangle', 520, 660, t + 0.08, 0.07, 0.06);
        break;
      case 'thunk':
        // wooden plank clap — deeper than a thud, with a knock transient
        this._osc('sine', 95, 38, t, 0.26, 0.55);
        this._noise(t, 0.05, 0.3, 'lowpass', 1800, 300);
        this._noise(t, 0.18, 0.2, 'lowpass', 420, 100);
        break;
      case 'thunkLand':
        this._osc('sine', 110, 42, t, 0.2, 0.4);
        this._noise(t, 0.1, 0.18, 'lowpass', 600, 140);
        break;
      case 'whoosh':
        this._noise(t, 0.28, 0.10, 'bandpass', 400, 1800, 1.4);
        break;
      case 'click':
        this._osc('square', 700, 500, t, 0.045, 0.09);
        break;
      case 'denied':
        this._osc('square', 130, 110, t, 0.09, 0.10);
        this._osc('square', 98, 90, t + 0.09, 0.1, 0.10);
        break;
      case 'tick': {
        const now = performance.now();
        if (now - this._lastTick < 150) return;
        this._lastTick = now;
        this._osc('square', 1200, 1000, t, 0.04, 0.06);
        break;
      }
      case 'win': {
        const notes = [523.25, 659.25, 783.99, 1046.5];
        notes.forEach((f, i) => {
          this._osc('triangle', f, f, t + i * 0.11, 0.32, 0.16);
          this._osc('sine', f * 2, f * 2, t + i * 0.11, 0.2, 0.05);
        });
        this._noise(t + 0.44, 0.4, 0.06, 'highpass', 4000, 6000);
        break;
      }
      case 'lose':
        [392, 311, 233].forEach((f, i) => this._osc('sawtooth', f, f * 0.94, t + i * 0.17, 0.24, 0.09));
        break;
      case 'select':
        this._osc('triangle', 500, 760, t, 0.08, 0.1);
        break;
      case 'peg':
        this._osc('sine', 600, 880, t, 0.06, 0.08);
        break;
    }
  }
}

export const sfx = new Sfx();
