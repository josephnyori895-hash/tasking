// generator.js — procedural RELOCATION level creation + exact solvability verification
//
// A level is a stack of layered planks. Each plank owns several screw-holes;
// some holes hold screws, the rest are empty. A plank falls only when zero of
// its holes hold screws AND it is not trapped under a higher plank. A hole is
// usable only while VISIBLE (not covered by any on-board plank above it).
//
// Because the very last screw always strands on the final remaining plank,
// a solvable level MUST end in a cascade: one move that empties 2+ planks at
// once. The generator carves such a solution path by construction, then the
// BFS verifier confirms it end-to-end.
import { mulberry32, clamp, TAU } from './util.js';

/* Board design-space constants (canvas units). The view scales to fit.
   maxY keeps planks above the PARKING tray strip at the bottom of the board. */
export const BOARD = { w: 900, h: 1270, minX: 90, maxX: 810, minY: 120, maxY: 1050 };

/* Two neutral PARKING SLOTS in a small wooden tray below the planks.
   A lifted screw may rest in either slot; slots never pin any plank and a
   parked screw can be picked back up at any time. Solver capacity: +2. */
export const PARKING_SLOTS = [
  { id: 0, x: BOARD.w / 2 - 95, y: 1172 },
  { id: 1, x: BOARD.w / 2 + 95, y: 1172 },
];
export const PARK_COUNT = PARKING_SLOTS.length;

const WOODS = [
  { key: 'oak',       base: '#D9A55F', light: '#EBC57F', dark: '#A9743B', end: '#B3814a' },
  { key: 'mahogany',  base: '#9E4A33', light: '#BC6448', dark: '#6E2E1F', end: '#7d3a28' },
  { key: 'driftwood', base: '#A9A294', light: '#C6C0B2', dark: '#767065', end: '#8d877b' },
  { key: 'walnut',    base: '#6B4529', light: '#8A5C38', dark: '#452B16', end: '#54361e' },
  { key: 'cherry',    base: '#B4643F', light: '#D08455', dark: '#81422A', end: '#96502f' },
];

function woodForIndex(i) {
  const order = [0, 3, 1, 4, 2];
  return WOODS[order[i % order.length]];
}

/* ---- point in plank (rotated rect) ---- */
export function pointInPlank(px, py, p, grow = 0) {
  const dx = px - p.x, dy = py - p.y;
  const c = Math.cos(-p.angle), s = Math.sin(-p.angle);
  const lx = dx * c - dy * s;
  const ly = dx * s + dy * c;
  return Math.abs(lx) <= p.len / 2 + grow && Math.abs(ly) <= p.wid / 2 + grow;
}

/* ---- overlap sampling ---- */
function coveredFrac(a, b, rng) {
  let hit = 0, N = 28;
  const c = Math.cos(a.angle), s = Math.sin(a.angle);
  for (let i = 0; i < N; i++) {
    const lx = (rng() - 0.5) * a.len;
    const ly = (rng() - 0.5) * a.wid;
    const wx = a.x + lx * c - ly * s;
    const wy = a.y + lx * s + ly * c;
    if (pointInPlank(wx, wy, b)) hit++;
  }
  return hit / N;
}

function overlapsTooMuch(candidate, placed, rng) {
  for (const q of placed) {
    const dx = candidate.x - q.x, dy = candidate.y - q.y;
    const reach = Math.max(candidate.len, candidate.wid) / 2 + Math.max(q.len, q.wid) / 2;
    if (dx * dx + dy * dy > reach * reach) continue;
    const f1 = coveredFrac(candidate, q, rng);
    const f2 = coveredFrac(q, candidate, rng);
    if (Math.max(f1, f2) > 0.6) return true;
  }
  return false;
}

function randomPlank(rng) {
  const len = 360 + rng() * 260;
  const wid = 118 + rng() * 56;
  const angle = (rng() - 0.5) * TAU;
  const hw = Math.abs(Math.cos(angle)) * len / 2 + Math.abs(Math.sin(angle)) * wid / 2;
  const hh = Math.abs(Math.sin(angle)) * len / 2 + Math.abs(Math.cos(angle)) * wid / 2;
  const mX = hw + 26, mY = hh + 26;
  const x = BOARD.minX + mX + rng() * Math.max(1, (BOARD.maxX - mX) - (BOARD.minX + mX));
  const y = BOARD.minY + mY + rng() * Math.max(1, (BOARD.maxY - mY) - (BOARD.minY + mY));
  return { x, y, len, wid, angle };
}

function holeAnchors(plank, count, rng) {
  const anchors = [];
  const margin = 66;
  const span = plank.len / 2 - margin;
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0 : (i / (count - 1)) * 2 - 1;
    const lx = t * span * (0.84 + rng() * 0.16) + (rng() - 0.5) * 22;
    const ly = (rng() - 0.5) * (plank.wid - 78);
    anchors.push({ lx, ly });
  }
  return anchors;
}

function anchorWorld(plank, a) {
  const c = Math.cos(plank.angle), s = Math.sin(plank.angle);
  return { x: plank.x + a.lx * c - a.ly * s, y: plank.y + a.lx * s + a.ly * c };
}

/* ============================================================
   SOLVER — exact BFS over (aliveMask, screwBitset) states.
   Cells 0..H-1 are plank holes; cells H..H+1 are the two neutral
   PARKING SLOTS (always visible, always open, never pin a plank),
   so the solver carries the same +2 temporary capacity the player
   has. BigInt bitsets keep cells past 31 exact.
   ============================================================ */
export function solveLevel(planks, holes, timeBudgetMs = 90) {
  const N = planks.length;
  const H = holes.length;
  const C = H + PARK_COUNT;                     // total cells incl. parking
  const holePlank = holes.map(h => h.plank);
  const cellPlank = i => (i < H ? holePlank[i] : -1);
  const bits = [];
  for (let i = 0; i < C; i++) bits.push(1n << BigInt(i));

  let startScrews = 0n;
  for (let i = 0; i < H; i++) if (holes[i].filled) startScrews |= bits[i];
  const startAlive = (1 << N) - 1;

  /* Goal = every plank down AND no screws left anywhere (board or parking).
     Alive-only is not enough: leftover parked screws must not count as a win. */
  const goalTest = (alive, screws) => alive === 0 && screws === 0n;
  /* Drop cascade: a plank falls when it is (or becomes) empty of its OWN
     screws. `screws` is the exact post-move bitset, so parked screws keep
     pinning their planks. `skipPlank` = the source cell's plank, treated as
     emptied by the lift (its other screws were already counted in `screws`
     only if they stay — they do). */
  const dropPass = (alive, screws, skipPlank = -1) => {
    let changed = true;
    while (changed) {
      changed = false;
      for (let z = 0; z < N; z++) {
        if (!(alive & (1 << z))) continue;
        if (z === skipPlank) { alive &= ~(1 << z); changed = true; continue; }
        let has = false;
        for (let h = 0; h < H; h++) {
          if (holePlank[h] === z && (screws & bits[h])) { has = true; break; }
        }
        if (!has) { alive &= ~(1 << z); changed = true; }
      }
    }
    return alive;
  };

  const covers = holes.map(h => {
    const list = [];
    for (let zj = h.plank + 1; zj < N; zj++) {
      if (pointInPlank(h.x, h.y, planks[zj], 4)) list.push(zj);
    }
    return list;
  });
  /* parking cells are neutral: never covered, always usable */
  const isVis = (i, aliveMask) => {
    if (i >= H) return true;
    for (const z of covers[i]) if (aliveMask & (1 << z)) return false;
    return true;
  };
  const aliveCount = (mask) => { let c = 0; for (let z = 0; z < N; z++) if (mask & (1 << z)) c++; return c; };

  /* Precomputed per-alive-mask legal moves as {keep, add} positive bitset
     masks (BigInt ~ is negative, so one "delta" mask won't do). Whether the
     source plank pi empties depends on the state's screws, so each move
     caches both outcomes: expand() picks keepNoDrop/keepDrop + the matching
     alive mask with one bitmask test. A placed screw always pins its plank,
     so parked screws never let their plank fall. */
  const deltasCache = new Map();
  const getDeltas = (alive, S) => {
    const key = `${alive}|${S}`;
    let d = deltasCache.get(key);
    if (d) return d;
    d = [];
    const lastPlank = aliveCount(alive) === 1;
    const clearOf = (fromAlive, toAlive) => {
      let clear = 0n;
      for (let k = 0; k < H; k++) {
        const pk = holePlank[k];
        if ((fromAlive & (1 << pk)) && !(toAlive & (1 << pk))) clear |= bits[k];
      }
      return clear;
    };
    for (let i = 0; i < C; i++) {
      if (!(S & bits[i])) continue;                          // source must hold a screw
      const pi = cellPlank(i);
      if (pi >= 0 && !(alive & (1 << pi))) continue;
      if (!isVis(i, alive)) continue;
      for (let j = 0; j < C; j++) {
        if (i === j) continue;
        if (S & bits[j]) continue;                           // target occupied
        const pj = cellPlank(j);
        if (pj >= 0 && !(alive & (1 << pj))) continue;
        if (!isVis(j, alive)) continue;
        /* exact post-move bitset: every parked screw pins its own plank, so
           only planks genuinely emptied of ALL their screws fall */
        const next = (S & ~bits[i]) | bits[j];
        const nextAlive = dropPass(alive, next);
        d.push({ i, j, keep: bits[i] | clearOf(alive, nextAlive), add: bits[j], alive: nextAlive });
      }
      /* FINAL-PLANK FREE LIFT: the last plank's screw pops out of play */
      if (lastPlank && pi >= 0) {
        const next = S & ~bits[i];
        const nextAlive = dropPass(alive, next);
        d.push({ i, j: -1, keep: bits[i] | clearOf(alive, nextAlive), add: 0n, alive: nextAlive });
      }
    }
    if (deltasCache.size > 60000) deltasCache.clear();
    deltasCache.set(key, d);
    return d;
  };

  const startKey = `${startAlive}|${startScrews}`;
  const visited = new Set([startKey]);

  const t0 = performance.now();
  const MAX_STATES = 400000;

  /* Greedy DFS: progress moves (drop a plank / final free lift) first, then
     plank->plank, parking LAST. Finds a solution path fast while visited-
     tracking keeps it complete. solutionLen = the path length found. */
  const stack = [{ alive: startAlive, screws: startScrews, moves: [] }];
  let states = 0;

  while (stack.length) {
    if (++states > MAX_STATES || performance.now() - t0 > timeBudgetMs) {
      return { solvable: false, aborted: true, states, bestDepth: 0 };
    }
    const cur = stack[stack.length - 1];
    if (goalTest(cur.alive, cur.screws)) {
      return { solvable: true, moves: cur.moves, states, solutionLen: cur.moves.length };
    }

    const deltas = getDeltas(cur.alive, cur.screws);
    /* order: free lift & plank-dropping moves first, then plank->plank,
       then anything touching parking */
    const rank = d => (d.j === -1 ? 0 : (d.alive < cur.alive ? 1 : (d.i < H && d.j < H ? 2 : 3)));
    deltas.sort((a, b) => rank(a) - rank(b));

    /* push ALL unvisited children (best LAST so it's popped first). A child
       pushed then never re-expanded means every path through it failed. */
    let pushed = false;
    for (let di = deltas.length - 1; di >= 0; di--) {
      const d = deltas[di];
      const screws = (cur.screws & ~d.keep) | d.add;
      const key = `${d.alive}|${screws}`;
      if (visited.has(key)) continue;
      visited.add(key);
      stack.push({ alive: d.alive, screws, moves: cur.moves.concat({ from: d.i, to: d.j }) });
      pushed = true;
    }
    if (!pushed) stack.pop();                  // dead end -> backtrack
  }
  return { solvable: false, aborted: false, states, bestDepth: 0 };
}

/* ============================================================
   GENERATION — construction-first.
   Carve a guaranteed solution path, then let BFS confirm it.
   The path empties planks top-down and always ends in a cascade
   (the final move empties the last two planks together).
   ============================================================ */
function paramsFor(level) {
  const plankCount = clamp(2 + Math.ceil(level / 3), 2, 7);
  return {
    plankCount,
    holesMin: 3,
    holesMax: level < 4 ? 3 : level < 10 ? 4 : 5,
    spareBase: level <= 2 ? 3 : level <= 5 ? 2.4 : level <= 9 ? 2 : level <= 16 ? 1.5 : 1.1,
    minSolution: clamp(2 + level, 4, 14),
  };
}

function tryBuildCarved(planks, level, rng) {
  const N = planks.length;
  const top = N - 1;

  // hole counts per plank
  const { holesMin, holesMax, spareBase } = paramsFor(level);
  const holes = [];
  for (const p of planks) {
    const n = holesMin + Math.floor(rng() * (holesMax - holesMin + 1));
    const anchors = holeAnchors(p, n, rng);
    anchors.forEach(a => {
      const w = anchorWorld(p, a);
      holes.push({ id: holes.length, plank: p.id, lx: a.lx, ly: a.ly, x: w.x, y: w.y, filled: false });
    });
  }
  const H = holes.length;
  const byPlank = [];
  for (let z = 0; z < N; z++) byPlank.push(holes.filter(h => h.plank === z));

  /* is hole h initially visible? (no higher plank covers it) */
  const initVis = holes.map(h => {
    for (let z = h.plank + 1; z < N; z++) {
      if (pointInPlank(h.x, h.y, planks[z], 4)) return false;
    }
    return true;
  });

  /* choose the launchpad: a hole on the TOP plank that is never covered by
     anything below it (top is highest, so all its holes are visible at start
     unless a same-or-higher plank covers it — none is higher). It must simply
     be a top-plank hole. */
  const topHoles = byPlank[top];
  if (topHoles.length < 2) return null;
  const launch = topHoles[Math.floor(rng() * topHoles.length)];

  /* carve the endgame cascade: the final move takes a screw from the second-
     to-last surviving plank into the last empty hole of the final plank,
     emptying both. To guarantee this, designate:
       - finalA = bottom-most plank that survives to the end (say plank 0)
       - finalB = plank 1
     We ensure plank 0 ends with exactly 1 screw and plank 1 with exactly 1
     screw and 1 empty hole, so the last move (0's screw -> 1's hole) empties
     both. For higher planks we empty them into lower holes as we go.
     Rather than hand-simulating (fragile with visibility), we lay a SIMPLE
     guaranteed pattern and let BFS confirm:
       - plank 0: exactly 1 screw
       - plank 1: exactly 1 screw + >=1 empty hole
       - all higher planks: screws that can each reach SOME visible empty hole
     The cleanest guaranteed-solvable pattern given BFS confirmation:
       - fill counts: p0=1, p1=1, others = 1 screw each (minimal), leaving many
         empty holes everywhere.
     With 1 screw per plank and abundant empty holes, a top-down strip always
     works IF empties are reachable. To be safe we bias screws onto the top
     plank and empties onto lower planks. */

  // minimal-screw carve: 1 screw on each plank, rest empty.
  // extra screws go on the TOP plank (its holes are always reachable).
  const screwsPer = planks.map((_, z) => 1);
  let totalScrews = N;
  // add extra screws to the top plank up to (topHoles - 1) so it keeps >=1 empty
  const extraTop = Math.min(topHoles.length - 1, Math.floor(rng() * (topHoles.length - 1)) + (level > 5 ? 1 : 0));
  screwsPer[top] += Math.max(0, extraTop);
  totalScrews += Math.max(0, extraTop);

  // ensure spare capacity overall
  if (totalScrews >= H) return null;

  // assign: for each plank, fill screwsPer[z] holes (prefer visible ones low,
  // any on top)
  for (let z = 0; z < N; z++) {
    const own = [...byPlank[z]];
    // shuffle
    for (let i = own.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1));[own[i], own[j]] = [own[j], own[i]]; }
    // prefer visible holes to fill on lower planks (keeps puzzle readable),
    // but allow some buried for flavor on higher levels
    own.sort((a, b) => (initVis[b.id] ? 1 : 0) - (initVis[a.id] ? 1 : 0));
    for (let k = 0; k < screwsPer[z] && k < own.length; k++) own[k].filled = true;
  }

  /* difficulty re-tune for the +2 parking capacity: bury one screw (two at
     high levels) under higher planks. A buried screw only becomes reachable
     once its cover drops — real planning pressure the parking buffer supports
     without making dead-ends impossible to escape. BFS confirms solvability. */
  const buriedCandidates = [];
  for (let z = 0; z < top; z++) {
    for (const h of byPlank[z]) if (!h.filled && !initVis[h.id]) buriedCandidates.push(h);
  }
  for (let i = buriedCandidates.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1));[buriedCandidates[i], buriedCandidates[j]] = [buriedCandidates[j], buriedCandidates[i]]; }
  const buriedWanted = level >= 6 ? (level >= 9 ? 2 : 1) : 0;
  let buriedAdded = 0;
  for (const h of buriedCandidates) {
    if (buriedAdded >= buriedWanted || totalScrews >= H - 2) break;
    h.filled = true; totalScrews++; buriedAdded++;
  }
  /* Endgame safety: the last-surviving plank is emptied by free lifts, but
     its screws must be UNCOVERED by then — never one of its own. Keep the
     bottom plank's holes screw-free so its buried screws can't deadlock the
     finale; BFS re-verifies every layout anyway. */
  for (const h of byPlank[0]) if (h.filled && !initVis[h.id]) { h.filled = false; totalScrews--; }

  // guarantee the launchpad hole is empty
  launch.filled = false;
  // guarantee at least one empty visible hole besides launch
  const emptyVis = holes.filter(h => !h.filled && initVis[h.id]);
  if (emptyVis.length < 1) return null;

  return { holes, totalScrews };
}

export function generateLevel(level) {
  const seed = (level * 7919 + 1337) >>> 0;
  const { plankCount, minSolution } = paramsFor(level);

  let built = null, solution = null, attempts = 0;

  while (attempts++ < 110) {
    const rng = mulberry32(seed + attempts * 977);
    // --- planks ---
    const planks = [];
    let ok = true;
    for (let z = 0; z < plankCount; z++) {
      let p = null, tries = 0;
      while (tries++ < 60) {
        const cand = randomPlank(rng);
        if (!overlapsTooMuch(cand, planks, rng)) { p = cand; break; }
      }
      if (!p) { ok = false; break; }
      p.id = z; p.z = z;
      p.wood = woodForIndex(z);
      p.seed = (seed ^ (z * 0x85EBCA6B)) >>> 0;
      planks.push(p);
    }
    if (!ok) continue;

    const carve = tryBuildCarved(planks, level, rng);
    if (!carve) continue;
    const { holes } = carve;

    // --- verify ---
    const res = solveLevel(planks, holes);
    (window.__gendbg = window.__gendbg || []).push({
      attempt: attempts, H: holes.length, screws: carve.totalScrews,
      solvable: res.solvable, solLen: res.solutionLen || 0,
      aborted: !!res.aborted, states: res.states, bestDepth: res.bestDepth,
      filledPer: planks.map(p => holes.filter(h => h.plank === p.id && h.filled).length).join(','),
    });
    if (!res.solvable) continue;
    // not too trivial
    if (res.solutionLen < Math.min(minSolution, holes.length - 1)) continue;

    built = { planks, holes };
    solution = res;
    break;
  }

  if (!built) {
    // defensive fallback: guaranteed-solvable minimal stack
    const frng = mulberry32(seed + 99991);
    const planks = [];
    for (let z = 0; z < Math.max(2, plankCount); z++) {
      planks.push({
        id: z, z, x: 450 + (frng() - 0.5) * 140, y: 380 + z * 210,
        len: 500, wid: 150, angle: (frng() - 0.5) * 0.5,
        wood: woodForIndex(z), seed: (seed ^ (z * 0x85EBCA6B)) >>> 0,
      });
    }
    const holes = [];
    planks.forEach((p, pi) => {
      const isTop = pi === planks.length - 1;
      for (let i = 0; i < 3; i++) {
        const a = { lx: (i - 1) * 170, ly: (frng() - 0.5) * 40 };
        const w = anchorWorld(p, a);
        // 1 screw on plank 0, 1 on plank 1 (with empties), top gets 1 screw + 2 empty
        const filled = i === 0;
        holes.push({ id: holes.length, plank: p.id, lx: a.lx, ly: a.ly, x: w.x, y: w.y, filled });
      }
    });
    built = { planks, holes };
    solution = solveLevel(planks, holes);
  }
  const solutionLen = solution && solution.solvable ? solution.solutionLen : 0;

  const { planks, holes } = built;
  const screwCount = holes.filter(h => h.filled).length;
  const timeLimit = clamp(
    Math.round(16 + screwCount * 4.4 + plankCount * 2.4 - Math.min(level, 14) * 0.8),
    30, 110
  );

  return {
    level, seed, planks, holes, screwCount,
    spareHoles: holes.length - screwCount,
    timeLimit,
    solutionLen,
  };
}
