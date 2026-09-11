// main.js — app orchestration: screens, HUD, overlays, persistence
import { generateLevel } from './generator.js';
import { Game } from './game.js';
import { LevelMap } from './map.js';
import { sfx } from './audio.js';
import { formatTime } from './util.js';
import { TitleAmbience } from './title.js';

const $ = id => document.getElementById(id);

const SAVE_KEY = 'screwout-save-v1';
const store = {
  load() {
    try { return { progress: 0, sound: true, shake: true, gems: 0, ...JSON.parse(localStorage.getItem(SAVE_KEY) || '{}') }; }
    catch { return { progress: 0, sound: true, shake: true, gems: 0 }; }
  },
  save(s) { try { localStorage.setItem(SAVE_KEY, JSON.stringify(s)); } catch { } },
};
const save = store.load();
sfx.enabled = save.sound;

const screens = {
  title: $('screen-title'),
  map: $('screen-map'),
  game: $('screen-game'),
};
const ambience = new TitleAmbience($('title-canvas'));
function show(name) {
  for (const k in screens) screens[k].hidden = k !== name;
  if (name === 'title') ambience.start();
  else ambience.stop();
}

/* ---------------- game instance ---------------- */
let game = null;
let currentLevel = 1;

const hudTime = $('hud-time');
const hudTimerPlaque = $('hud-timer-plaque');
const hudLevel = $('hud-level');

function refreshGems() {
  document.querySelectorAll('.gem-chip span').forEach(el => { el.textContent = save.gems; });
}

function refreshTimerPlaque(t) {
  hudTime.textContent = formatTime(t);
  hudTimerPlaque.classList.toggle('warn', t <= 12 && t > 5);
  hudTimerPlaque.classList.toggle('danger', t <= 5);
}

const levelBanner = $('level-banner');
const levelBannerText = $('level-banner-text');
let bannerTimer = null;
function showLevelBanner(level) {
  levelBannerText.textContent = `LEVEL ${level}`;
  levelBanner.hidden = false;
  // restart the animation
  levelBannerText.style.animation = 'none';
  void levelBannerText.offsetWidth;
  levelBannerText.style.animation = '';
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => { levelBanner.hidden = true; }, 1550);
}

const comboToast = $('combo-toast');
let comboTimer = null;
let lastDeadlockToast = 0;
function showCombo(n, text) {
  if (text) {
    const now = performance.now();
    if (now - lastDeadlockToast < 2500) return;   // don't spam the stuck hint
    lastDeadlockToast = now;
  }
  comboToast.textContent = text || `${n}× COMBO!`;
  comboToast.hidden = false;
  comboToast.style.animation = 'none';
  void comboToast.offsetWidth;
  comboToast.style.animation = '';
  clearTimeout(comboTimer);
  comboTimer = setTimeout(() => { comboToast.hidden = true; }, 1000);
  sfx.play('select');
}

function startLevel(level) {
  currentLevel = level;
  const data = generateLevel(level);
  hudLevel.textContent = `LEVEL ${level}`;
  refreshTimerPlaque(data.timeLimit);
  levelBanner.hidden = true;
  comboToast.hidden = true;
  if (!game) {
    game = new Game($('game-canvas'), {
      onWin: stats => {
        const firstClear = level > save.progress;
        // gem payout: base for a clear, bonus for beating par (40% time left)
        let earned = 1;
        if (stats.timeLeft >= stats.timeTotal * 0.4) earned += 2;
        else if (stats.timeLeft >= stats.timeTotal * 0.2) earned += 1;
        if (firstClear) earned += 2;
        stats.gems = earned;
        save.gems += earned;
        save.progress = Math.max(save.progress, level);
        store.save(save);
        refreshGems();
        if (firstClear) map.celebrateLevel = level + 1;
        showOverlay('win', stats);
        mapDirty = true;
      },
      onLose: () => showOverlay('lose'),
      onTick: t => refreshTimerPlaque(t),
      onCombo: n => showCombo(n),
      onLevelStart: lv => showLevelBanner(lv),
      onHistory: has => { $('btn-undo').disabled = !has; },
      onDeadlock: () => showCombo(0, 'STUCK — UNDO A MOVE!'),
    });
    game.shakeEnabled = save.shake;
  }
  game.shakeEnabled = save.shake;
  show('game');
  hideOverlay();
  sizeGame();
  game.loadLevel(data);
}

function sizeGame() {
  if (!game) return;
  const wrap = $('board-wrap');
  game.resize(wrap.clientWidth, wrap.clientHeight);
}

/* ---------------- overlay manager ---------------- */
const overlay = $('overlay');
const modals = { pause: $('ov-pause'), win: $('ov-win'), lose: $('ov-lose'), howto: $('ov-howto'), settings: $('ov-settings'), credits: $('ov-credits') };
let settingsReturn = null;

function showOverlay(name, data) {
  overlay.hidden = false;
  for (const k in modals) modals[k].hidden = k !== name;
  if (name === 'win' && data) {
    $('win-stats').innerHTML =
      `<div><b>${formatTime(data.timeLeft)}</b><span>TIME LEFT</span></div>` +
      `<div><b>+${data.gems}</b><span>GEMS</span></div>` +
      `<div><b>${data.level}</b><span>LEVEL</span></div>`;
  }
}
function hideOverlay() { overlay.hidden = true; }
function anyOverlayOpen() { return !overlay.hidden; }

/* ---------------- level map ---------------- */
let mapDirty = true;
const map = new LevelMap({
  onPlay: level => { sfx.play('click'); startLevel(level); },
  getProgress: () => save.progress,
});

function showMap() {
  show('map');
  map.show();               // rebuild reflects fresh progress
  mapDirty = false;
}

/* ---------------- wiring: title ---------------- */
$('btn-enter').addEventListener('click', () => { sfx.unlock(); sfx.play('click'); showMap(); });
$('btn-continue').addEventListener('click', () => { sfx.play('click'); showMap(); });
$('btn-howto').addEventListener('click', () => { sfx.play('click'); showOverlay('howto'); });
$('btn-settings-title').addEventListener('click', () => { sfx.play('click'); settingsReturn = 'title'; showOverlay('settings'); });

/* ---------------- wiring: map ---------------- */
$('btn-map-home').addEventListener('click', () => { sfx.play('click'); show('title'); });

/* ---------------- wiring: HUD / pause ---------------- */
$('btn-pause').addEventListener('click', () => {
  if (!game || game.state !== 'playing') return;
  sfx.play('click');
  game.pause();
  showOverlay('pause');
});
$('btn-resume').addEventListener('click', () => { sfx.play('click'); hideOverlay(); game.resume(); });
$('btn-undo').addEventListener('click', () => { if (game) game.undo(); });
$('btn-restart').addEventListener('click', () => { if (game && game.state === 'playing') game.restart(); });
$('btn-restart-pause').addEventListener('click', () => { sfx.play('click'); hideOverlay(); startLevel(currentLevel); });
$('btn-quit').addEventListener('click', () => { sfx.play('click'); hideOverlay(); game.state = 'idle'; showMap(); });
$('btn-settings-pause').addEventListener('click', () => { sfx.play('click'); settingsReturn = 'pause'; showOverlay('settings'); });

/* ---------------- wiring: win / lose ---------------- */
$('btn-next').addEventListener('click', () => { sfx.play('click'); startLevel(currentLevel + 1); });
$('btn-win-map').addEventListener('click', () => { sfx.play('click'); showMap(); });
$('btn-try-again').addEventListener('click', () => { sfx.play('click'); startLevel(currentLevel); });
$('btn-lose-map').addEventListener('click', () => { sfx.play('click'); showMap(); });

/* ---------------- wiring: howto / settings ---------------- */
$('btn-howto-close').addEventListener('click', () => { sfx.play('click'); hideOverlay(); });
$('btn-credits').addEventListener('click', () => { sfx.play('click'); showOverlay('credits'); });
$('btn-credits-close').addEventListener('click', () => { sfx.play('click'); hideOverlay(); });
$('btn-settings-close').addEventListener('click', () => {
  sfx.play('click');
  if (settingsReturn === 'pause') showOverlay('pause');
  else hideOverlay();
  settingsReturn = null;
});
$('set-sound').checked = save.sound;
$('set-shake').checked = save.shake;
$('set-sound').addEventListener('change', e => {
  save.sound = e.target.checked; store.save(save); sfx.enabled = save.sound;
  if (save.sound) sfx.play('click');
});
$('set-shake').addEventListener('change', e => {
  save.shake = e.target.checked; store.save(save);
  if (game) game.shakeEnabled = save.shake;
});
$('btn-reset-progress').addEventListener('click', () => {
  save.progress = 0; save.gems = 0; store.save(save); mapDirty = true;
  refreshGems();
  sfx.play('denied');
});

/* ---------------- global keys ---------------- */
window.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (!screens.game.hidden) {
      if (game.state === 'playing') { game.pause(); showOverlay('pause'); }
      else if (game.state === 'paused' && !modals.pause.hidden) { hideOverlay(); game.resume(); }
      else if (game.state === 'paused' && !modals.settings.hidden) { showOverlay('pause'); settingsReturn = null; }
    } else if (anyOverlayOpen()) hideOverlay();
  }
});

/* ---------------- resize ---------------- */
window.addEventListener('resize', () => {
  sizeGame();
  if (!screens.map.hidden) { map.paint(); map.offset = map.clampOffset(map.offset); map.layout(); }
  if (!screens.title.hidden) ambience.resize();
});

/* unlock audio on first interaction anywhere */
window.addEventListener('pointerdown', () => sfx.unlock(), { once: true });

/* continue button visibility */
if (save.progress > 0) $('btn-continue').hidden = false;
refreshGems();

/* debug handle (harmless in production) */
window.__so = {
  get game() { return game; },
  map,
  startLevel,
  save,
};

/* ambient: subtle vignette breathing on title (CSS handles the rest) */
show('title');
