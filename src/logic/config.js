/* Game constants and channel config (moved verbatim from game.js). */

const PLAYER_NAME = 'Lizard';

/* Beta channel: the same code deployed under .../lizard-blockdoku-beta/ gets
   its own save (github.io shares one localStorage origin across repos) and
   never submits to the real leaderboard. */
const IS_BETA = typeof location !== 'undefined' && location.pathname.includes('-beta');
const SAVE_KEY = IS_BETA ? 'lizard-blockdoku-beta' : 'lizard-blockdoku-v1';

/* App version shown in Settings so a stale service worker is easy to spot.
   APP_BUILD must be bumped together with the sw.js CACHE version on every
   deploy: they are numerically aligned (build 13 = cache v13). */
const APP_VERSION = 'v2.6';
const APP_BUILD = 40;

/* Global leaderboard endpoint (Lambda Function URL). Only enabled when the
   game is served from github.io: the API's CORS is pinned to that origin,
   so calls from anywhere else (localhost dev, the test suite) could never
   succeed and would only spam console errors. The game stays fully playable
   offline either way. window.__LB_URL__ is the smoke suite's mock hook. */
/* Each channel has its own backend so beta playtesting never touches real
   scores. Both are live: BETA_LB_URL points at the lizard-leaderboard-beta
   stack's Function URL (deployed 2026-07-07; see infra/DEPLOY.md section 8).
   If it were empty, beta would stay fully playable with no live board, and it
   NEVER falls back to the production table. */
const PROD_LB_URL = 'https://5hejgq4fhsbt7wcyq7p4pa55wi0iurts.lambda-url.us-east-1.on.aws';
const BETA_LB_URL = 'https://isy2u7iiajjq2kl2p4fzuej6be0udols.lambda-url.us-east-1.on.aws';
const LEADERBOARD_URL = (typeof window !== 'undefined' && window.__LB_URL__)
  || (typeof location !== 'undefined' && location.hostname.endsWith('github.io')
    ? (IS_BETA ? BETA_LB_URL : PROD_LB_URL)
    : '');
const LB_KEY = 'lizard-blockdoku-lb';

/* Beta now submits to its OWN backend (BETA_LB_URL), so this is on: beta can be
   tested end to end without polluting the production board. It stays inert until
   BETA_LB_URL is set (an empty LEADERBOARD_URL blocks all submits). */
const BETA_LB_SUBMITS = true;

/* Beta perk, permanent by design: fresh beta games start with one of each
   item so end-state rescues and item flows are always easy to test.
   Production fresh games start empty-handed. */
const BETA_STARTER_ITEMS = IS_BETA;

/* Icon sets (skins). Only the DISPLAYED glyph changes per set: the icon
   INDICES and their meaning (0=lizard, 1=flower, 2=heart, 3=star, 4=berry,
   5=butterfly) stay fixed, so saves, scoring, weights, and the leaderboard
   are all set-independent. 'garden' is a cohesive critters-and-blooms skin;
   index 0 (the rare double-value special) is the bee so it reads distinct. */
const ICON_SETS = {
  classic: ['\u{1F98E}', '\u{1F338}', '\u{1F49C}', '⭐', '\u{1F353}', '\u{1F98B}'], /* lizard flower heart star berry butterfly */
  garden: ['\u{1F41D}', '\u{1F33B}', '\u{1F337}', '\u{1F344}', '\u{1F40C}', '\u{1F41B}'], /* bee sunflower tulip mushroom snail caterpillar */
};
/* ICONS stays exported as the default set for back-compat (length/bounds
   checks, tests). currentIcons() is what render sites read so a live switch
   updates glyphs; ICON_WEIGHTS/ICON_LABELS/LIZARD_ICON are index-based and
   set-INDEPENDENT. */
const ICONS = ICON_SETS.classic;
let activeIconSet = 'classic';
function currentIcons() { return ICON_SETS[activeIconSet] || ICON_SETS.classic; }
function setActiveIconSet(id) { if (ICON_SETS[id]) activeIconSet = id; }
function iconSetIds() { return Object.keys(ICON_SETS); }
const ICON_WEIGHTS = [8, 23, 23, 23, 23, 23];
const ICON_LABELS = ['Lizard Power!', 'Flower Match!', 'Heart Match!', 'Star Match!', 'Berry Match!', 'Butterfly Match!'];
const LIZARD_ICON = 0;

const N = 9;
const CELL_COUNT = 81;

export { PLAYER_NAME, IS_BETA, SAVE_KEY, APP_VERSION, APP_BUILD, LEADERBOARD_URL, LB_KEY, BETA_LB_SUBMITS, BETA_STARTER_ITEMS, ICONS, ICON_SETS, currentIcons, setActiveIconSet, iconSetIds, ICON_WEIGHTS, ICON_LABELS, LIZARD_ICON, N, CELL_COUNT };
