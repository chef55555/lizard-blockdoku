/* Piece set, derived SHAPES, and the weighted shape/icon pickers. */

import { ICON_WEIGHTS } from './config.js';

/* ---- Piece set: 47 shapes in 16 weighted classes (weights sum 106).
   A class's weight is split evenly among its orientations. Never rotated. ---- */
const SHAPE_CLASSES = [
  { w: 4,  shapes: [[[0,0]]] },                                                     /* Single */
  { w: 6,  shapes: [[[0,0],[0,1]], [[0,0],[1,0]]] },                                /* Line2 */
  { w: 4,  shapes: [[[0,0],[1,1]], [[0,1],[1,0]]] },                                /* Diag2 */
  { w: 10, shapes: [[[0,0],[0,1],[0,2]], [[0,0],[1,0],[2,0]]] },                    /* Line3 */
  { w: 4,  shapes: [[[0,0],[1,1],[2,2]], [[0,2],[1,1],[2,0]]] },                    /* Diag3 */
  { w: 10, shapes: [                                                                 /* Corner3 */
      [[0,0],[1,0],[1,1]], [[0,0],[0,1],[1,0]], [[0,0],[0,1],[1,1]], [[0,1],[1,0],[1,1]] ] },
  { w: 8,  shapes: [[[0,0],[0,1],[1,0],[1,1]]] },                                   /* Square2x2 */
  { w: 8,  shapes: [[[0,0],[0,1],[0,2],[0,3]], [[0,0],[1,0],[2,0],[3,0]]] },        /* Line4 */
  { w: 12, shapes: [                                                                 /* L/J4, 8 orientations */
      [[0,0],[1,0],[2,0],[2,1]], [[0,0],[0,1],[0,2],[1,0]],
      [[0,0],[0,1],[1,1],[2,1]], [[0,2],[1,0],[1,1],[1,2]],
      [[0,1],[1,1],[2,0],[2,1]], [[0,0],[1,0],[1,1],[1,2]],
      [[0,0],[0,1],[1,0],[2,0]], [[0,0],[0,1],[0,2],[1,2]] ] },
  { w: 8,  shapes: [                                                                 /* S/Z4 */
      [[0,1],[0,2],[1,0],[1,1]], [[0,0],[1,0],[1,1],[2,1]],
      [[0,0],[0,1],[1,1],[1,2]], [[0,1],[1,0],[1,1],[2,0]] ] },
  { w: 8,  shapes: [                                                                 /* T4 */
      [[0,0],[0,1],[0,2],[1,1]], [[0,1],[1,0],[1,1],[1,2]],
      [[0,1],[1,0],[1,1],[2,1]], [[0,0],[1,0],[1,1],[2,0]] ] },
  { w: 6,  shapes: [[[0,0],[0,1],[0,2],[0,3],[0,4]], [[0,0],[1,0],[2,0],[3,0],[4,0]]] }, /* Line5 */
  { w: 6,  shapes: [                                                                 /* Corner5 */
      [[0,0],[1,0],[2,0],[2,1],[2,2]], [[0,0],[0,1],[0,2],[1,0],[2,0]],
      [[0,0],[0,1],[0,2],[1,2],[2,2]], [[0,2],[1,2],[2,0],[2,1],[2,2]] ] },
  { w: 3,  shapes: [[[0,1],[1,0],[1,1],[1,2],[2,1]]] },                              /* Plus5 */
  { w: 3,  shapes: [                                                                 /* T5 */
      [[0,0],[0,1],[0,2],[1,1],[2,1]], [[0,1],[1,1],[2,0],[2,1],[2,2]],
      [[0,0],[1,0],[1,1],[1,2],[2,0]], [[0,2],[1,0],[1,1],[1,2],[2,2]] ] },
  { w: 6,  shapes: [                                                                 /* U5 */
      [[0,0],[0,2],[1,0],[1,1],[1,2]],
      [[0,0],[0,1],[1,1],[2,0],[2,1]],
      [[0,0],[0,1],[0,2],[1,0],[1,2]],
      [[0,0],[0,1],[1,0],[2,0],[2,1]] ] },
];

/* Display names for the classes above, same order. The beta test panel builds
   its piece-subset checkboxes from these. */
const SHAPE_CLASS_NAMES = ['Single', 'Line 2', 'Diag 2', 'Line 3', 'Diag 3', 'Corner 3',
  'Square 2x2', 'Line 4', 'L/J 4', 'S/Z 4', 'T 4', 'Line 5', 'Corner 5', 'Plus 5', 'T 5', 'U 5'];

const SHAPES = [];
const SHAPE_CLASS_OF = []; /* shapeId -> class index */
const SHAPE_CLASS_META = []; /* one { name, classIdx, shapeIds } per class */
SHAPE_CLASSES.forEach((cls, classIdx) => {
  const per = cls.w / cls.shapes.length;
  const shapeIds = [];
  for (const cells of cls.shapes) {
    let h = 0, w = 0;
    for (const [r, c] of cells) { h = Math.max(h, r + 1); w = Math.max(w, c + 1); }
    shapeIds.push(SHAPES.length);
    SHAPE_CLASS_OF.push(classIdx);
    SHAPES.push({ cells, w, h, weight: per });
  }
  SHAPE_CLASS_META.push({ name: SHAPE_CLASS_NAMES[classIdx], classIdx, shapeIds });
});
const TOTAL_SHAPE_WEIGHT = SHAPES.reduce((a, s) => a + s.weight, 0);
const TOTAL_ICON_WEIGHT = ICON_WEIGHTS.reduce((a, b) => a + b, 0);

/* ---- Beta test-tool overrides. Inert by default and in production: only the
   beta channel ever calls the setters. A null filter means "no restriction";
   an empty or complete selection also clears to null, so the pickers' fast
   path stays the common case. ---- */
let allowedShapeIds = null; /* Set<shapeId> */
let allowedShapeWeight = 0;
let allowedIcons = null; /* Set<icon index> */
let allowedIconWeight = 0;
let rerollForce1x1 = false;

/* Difficulty generation bias: a per-class multiplier array (base 1), or null
   for "no bias". null keeps pickShapeId on its original fast path so Easy's
   distribution is byte-for-byte the historic one. Composes with the beta
   shape filter above. effTotal* are the difficulty-weighted sums, recomputed
   whenever the bias or the filter changes so a pick never re-sums per call. */
let difficultyMul = null;
let effTotalAll = TOTAL_SHAPE_WEIGHT;
let effTotalAllowed = 0;

/* This shape's weight after the difficulty bias (identity when no bias). */
function effWeight(id) {
  return difficultyMul ? SHAPES[id].weight * difficultyMul[SHAPE_CLASS_OF[id]] : SHAPES[id].weight;
}

function recomputeEffTotals() {
  effTotalAll = 0;
  for (let id = 0; id < SHAPES.length; id++) effTotalAll += effWeight(id);
  effTotalAllowed = 0;
  if (allowedShapeIds) for (const id of allowedShapeIds) effTotalAllowed += effWeight(id);
}

function setDifficultyWeights(mulByClass) {
  difficultyMul = (Array.isArray(mulByClass) && mulByClass.length === SHAPE_CLASSES.length) ? mulByClass : null;
  recomputeEffTotals();
}

function setShapeClassFilter(classIdxs) {
  allowedShapeIds = null;
  allowedShapeWeight = 0;
  if (!Array.isArray(classIdxs)) { recomputeEffTotals(); return; }
  const cls = new Set(classIdxs.filter((v) => Number.isInteger(v) && v >= 0 && v < SHAPE_CLASSES.length));
  if (cls.size === 0 || cls.size >= SHAPE_CLASSES.length) { recomputeEffTotals(); return; }
  allowedShapeIds = new Set();
  for (let id = 0; id < SHAPES.length; id++) {
    if (cls.has(SHAPE_CLASS_OF[id])) {
      allowedShapeIds.add(id);
      allowedShapeWeight += SHAPES[id].weight;
    }
  }
  recomputeEffTotals();
}

function setIconFilter(iconIdxs) {
  allowedIcons = null;
  allowedIconWeight = 0;
  if (!Array.isArray(iconIdxs)) return;
  const set = new Set(iconIdxs.filter((v) => Number.isInteger(v) && v >= 0 && v < ICON_WEIGHTS.length));
  if (set.size === 0 || set.size >= ICON_WEIGHTS.length) return;
  allowedIcons = set;
  for (const i of set) allowedIconWeight += ICON_WEIGHTS[i];
}

function setRerollForce1x1(on) { rerollForce1x1 = !!on; }
function isRerollForce1x1() { return rerollForce1x1; }

/* The active icon filter as a sorted list, or null when unrestricted. Lets
   the scenario builders theme their boards inside the allowed set. */
function iconFilterList() {
  return allowedIcons ? [...allowedIcons].sort((a, b) => a - b) : null;
}

/* Next shape id after `id`, cycling within the allowed set (the whole set when
   unfiltered). With a one-shape filter this returns `id` itself: the caller's
   "hand back something different" guarantee is impossible to keep, so it
   degrades to keeping the shape. */
function nextAllowedShapeId(id) {
  for (let step = 1; step <= SHAPES.length; step++) {
    const cand = (id + step) % SHAPES.length;
    if (!allowedShapeIds || allowedShapeIds.has(cand)) return cand;
  }
  return id;
}

/* Weighted random pickers over the piece and icon sets. With a filter active
   the walk is the same, restricted to the allowed members and their weight. */
function pickShapeId(rng) {
  if (!allowedShapeIds) {
    /* No bias: the exact historic path, so Easy is byte-for-byte unchanged. */
    if (!difficultyMul) {
      let t = rng() * TOTAL_SHAPE_WEIGHT;
      for (let i = 0; i < SHAPES.length; i++) {
        t -= SHAPES[i].weight;
        if (t < 0) return i;
      }
      return SHAPES.length - 1;
    }
    let t = rng() * effTotalAll;
    for (let i = 0; i < SHAPES.length; i++) {
      t -= effWeight(i);
      if (t < 0) return i;
    }
    return SHAPES.length - 1;
  }
  let t = rng() * (difficultyMul ? effTotalAllowed : allowedShapeWeight);
  let last = 0;
  for (const i of allowedShapeIds) {
    last = i;
    t -= effWeight(i);
    if (t < 0) return i;
  }
  return last;
}

function pickIcon(rng) {
  if (!allowedIcons) {
    let t = rng() * TOTAL_ICON_WEIGHT;
    for (let i = 0; i < ICON_WEIGHTS.length; i++) {
      t -= ICON_WEIGHTS[i];
      if (t < 0) return i;
    }
    return ICON_WEIGHTS.length - 1;
  }
  let t = rng() * allowedIconWeight;
  let last = 0;
  for (const i of allowedIcons) {
    last = i;
    t -= ICON_WEIGHTS[i];
    if (t < 0) return i;
  }
  return last;
}

export { SHAPE_CLASSES, SHAPE_CLASS_NAMES, SHAPE_CLASS_OF, SHAPE_CLASS_META, SHAPES,
  TOTAL_SHAPE_WEIGHT, TOTAL_ICON_WEIGHT, pickShapeId, pickIcon,
  setShapeClassFilter, setIconFilter, setRerollForce1x1, isRerollForce1x1,
  setDifficultyWeights, iconFilterList, nextAllowedShapeId };
