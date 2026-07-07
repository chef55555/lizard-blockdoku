// Pure UTC period-key helpers for the leaderboard. Intentionally free of any
// AWS / Node runtime deps so tests/backend-periods.test.js can import and
// exercise it directly. Period keys are ALWAYS derived from the server clock,
// never from anything the client sends.

/* ISO-8601 week date for a UTC instant. Returns the ISO week-year (which can
   differ from the calendar year in late December / early January) and the
   1..53 ISO week number. Method: shift the date to the Thursday of its ISO
   week (whose calendar year IS the ISO week-year by definition), then count
   weeks from Jan 1 of that year. All math is in UTC. */
export function isoWeekYear(nowMs) {
  const date = new Date(nowMs);
  // Truncate to a UTC calendar day so the time of day cannot skew the result.
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  // ISO weekday: Mon=1 .. Sun=7 (JS Sunday is 0, which becomes 7).
  const dayNum = d.getUTCDay() || 7;
  // Move to the Thursday of this ISO week.
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const isoYear = d.getUTCFullYear();
  const yearStart = Date.UTC(isoYear, 0, 1);
  const week = Math.ceil(((d.getTime() - yearStart) / 86400000 + 1) / 7);
  return { isoYear, week };
}

const pad = (n, len) => String(n).padStart(len, '0');

/* yyyy-mm-dd for a UTC instant. */
function dayStr(nowMs) {
  const d = new Date(nowMs);
  return pad(d.getUTCFullYear(), 4) + '-' + pad(d.getUTCMonth() + 1, 2) + '-' + pad(d.getUTCDate(), 2);
}

/* GGGG-Www ISO week string, e.g. 2025-W01 (year and week both zero-padded). */
function weekStr(nowMs) {
  const { isoYear, week } = isoWeekYear(nowMs);
  return pad(isoYear, 4) + '-W' + pad(week, 2);
}

/* All three period keys for an instant. The DynamoDB item stores the chosen
   key in its `lb` attribute, so the existing GSI (partition lb, sort score)
   serves each period with a single descending Query. */
export function periodKeys(nowMs) {
  return {
    all: 'ALL',
    day: 'D#' + dayStr(nowMs),
    week: 'W#' + weekStr(nowMs),
  };
}

/* The single key for the period NAME the client asked for ('all' | 'day' |
   'week'). Anything unknown falls back to all-time, so a stray or malformed
   query can never miss the board entirely. */
export function periodKeyFor(name, nowMs) {
  const keys = periodKeys(nowMs);
  if (name === 'day') return keys.day;
  if (name === 'week') return keys.week;
  return keys.all;
}

/* ---- Difficulty dimension ----
   A second, client-supplied board dimension folded into the same GSI key.
   Easy KEEPS the bare period key ('ALL', 'D#…', 'W#…') so every score written
   before difficulties existed is already the Easy board: zero migration.
   Normal/Hard prefix the key ('normal#ALL', 'hard#D#…'). Unlike the period,
   difficulty comes from the client (the server cannot derive it), so anything
   unknown or missing falls back to Easy. */
const DIFF_IDS = ['easy', 'normal', 'hard'];
function normDiff(d) { return DIFF_IDS.includes(d) ? d : 'easy'; }
function withDiff(difficulty, periodKey) {
  const d = normDiff(difficulty);
  return d === 'easy' ? periodKey : d + '#' + periodKey;
}

/* All three board keys for a submit, difficulty folded in. */
export function boardKeys(difficulty, nowMs) {
  const keys = periodKeys(nowMs);
  return {
    all: withDiff(difficulty, keys.all),
    day: withDiff(difficulty, keys.day),
    week: withDiff(difficulty, keys.week),
  };
}

/* The single board key for a /top read (difficulty + period name). */
export function boardKeyFor(difficulty, name, nowMs) {
  return withDiff(difficulty, periodKeyFor(name, nowMs));
}
