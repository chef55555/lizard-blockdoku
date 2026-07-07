/* Difficulty presets. Easy is the IDENTITY (today's exact production game) so
   existing saves, feel, and leaderboard carry over untouched; Normal and Hard
   are the new, progressively harder tiers. One config table drives several
   gameplay knobs at once: the shape-generation bias, the tray mercy rule, the
   starting item count, the item earn rate, and whether game-over item rescues
   apply. Pure logic: main.js reads the accessors and pushes the weight bias
   into pieces.js, so this module never imports the UI. */

import { SHAPE_CLASSES } from './pieces.js';

const DIFFICULTY_IDS = ['easy', 'normal', 'hard'];

/* Shape-class indices (order fixed by SHAPE_CLASSES in pieces.js): the small,
   friendly classes vs the awkward 5-cell classes. Normal/Hard damp the former
   and boost the latter; Easy applies no bias at all. */
const SMALL_CLASSES = [0, 1, 2, 3, 5, 6]; /* Single, Line2, Diag2, Line3, Corner3, Square2x2 */
const BIG_CLASSES = [11, 12, 13, 14, 15]; /* Line5, Corner5, Plus5, T5, U5 */

/* A per-class multiplier array (one entry per shape class, base 1). */
function biasArray(smallMul, bigMul) {
  const a = new Array(SHAPE_CLASSES.length).fill(1);
  for (const i of SMALL_CLASSES) if (i < a.length) a[i] = smallMul;
  for (const i of BIG_CLASSES) if (i < a.length) a[i] = bigMul;
  return a;
}

/* weightMul: per-class multiplier array, or null for "no bias" (Easy = today).
   mercy: genTray regeneration attempts. starter: items of each kind on a fresh
   game (prod; the beta perk is separate). itemRate: multiplier on item point
   accrual. rescues: whether a held reroll/rotate/flip staves off game over. */
const DIFFICULTY = {
  easy: { weightMul: null, mercy: 20, starter: 0, itemRate: 1.0, rescues: true },
  normal: { weightMul: biasArray(0.7, 1.5), mercy: 10, starter: 0, itemRate: 0.8, rescues: true },
  hard: { weightMul: biasArray(0.4, 2.2), mercy: 4, starter: 0, itemRate: 0.5, rescues: false },
};

let active = 'easy';

function setActiveDifficulty(id) { if (DIFFICULTY[id]) active = id; }
function currentDifficulty() { return active; }
function cfg() { return DIFFICULTY[active] || DIFFICULTY.easy; }

function difficultyWeightMul() { return cfg().weightMul; }
function mercyAttempts() { return cfg().mercy; }
function starterCount() { return cfg().starter; }
function itemRateMul() { return cfg().itemRate; }
function rescuesEnabled() { return cfg().rescues; }

export {
  DIFFICULTY, DIFFICULTY_IDS, setActiveDifficulty, currentDifficulty,
  difficultyWeightMul, mercyAttempts, starterCount, itemRateMul, rescuesEnabled,
};
