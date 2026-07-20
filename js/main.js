/* THE HOROLOGICAL ATLAS — app
   Deep Field — Magnitude Is Influence.
   Zero dependencies. Canvas 2D. ES module. */

'use strict';

/* ======================================================================
   0 · TOKENS (mirrors app.css)
   ====================================================================== */

const FIELD_HEX = '#06080B';
const FIELD_RGB = [6, 8, 11];
const INK_RGB = [233, 237, 242];            /* #E9EDF2 */
const VIGNETTE_RGB = [4, 5, 10];            /* #04050A */
const TEXT_2 = '#9AA4B2';
const TEXT_3 = '#5C6672';
const TEXT_2_RGB = [154, 164, 178];
const TEXT_3_RGB = [92, 102, 114];         /* label hover lerps these — no per-frame parsing */
const LUME = '#E4D5A8';
const LUME_RGB = [228, 213, 168];
const LUME_GLOW_0 = 'rgba(228,213,168,0.14)';   /* precomputed — no per-frame strings */
const LUME_GLOW_1 = 'rgba(228,213,168,0)';
const DIM_FIELD = 0.12;

const FONT_UI = "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', system-ui, 'Helvetica Neue', sans-serif";
const FONT_MONO = "ui-monospace, 'SF Mono', 'Cascadia Code', Menlo, monospace";

const Z_MAX = 14;
const TIER_2 = 2.2;                          /* star → glyph */
const TIER_3 = 6;                            /* glyph → labeled glyph */
const XFADE = 0.12;                          /* ±12% crossfade band */

/* magnitude — one curve, shared by initData and the Ephemeris re-derivation:
   floor 1.6 so the fit view reads as a populated sky; cap 3.8 and slope 0.42
   keep the hero's dominance. Hierarchy intact, night intact. */
const magR = d => Math.min(1.6 + 0.42 * Math.sqrt(d), 3.8);

/* ambient thread ink — one cached string, alpha rides globalAlpha */
const THREAD_INK = 'rgb(233,237,242)';

let REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', e => { REDUCED = e.matches; invalidate(); });

/* ======================================================================
   1 · UTILITIES
   ====================================================================== */

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;

/* cubic-bezier easing (CSS-compatible), Newton–Raphson on x */
function cubicBezier(x1, y1, x2, y2) {
  const ax = 3 * x1 - 3 * x2 + 1, bx = 3 * x2 - 6 * x1, cx = 3 * x1;
  const ay = 3 * y1 - 3 * y2 + 1, by = 3 * y2 - 6 * y1, cy = 3 * y1;
  const sampleX = t => ((ax * t + bx) * t + cx) * t;
  const sampleY = t => ((ay * t + by) * t + cy) * t;
  const sampleDX = t => (3 * ax * t + 2 * bx) * t + cx;
  return x => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 6; i++) {
      const err = sampleX(t) - x;
      const d = sampleDX(t);
      if (Math.abs(err) < 1e-5) break;
      if (Math.abs(d) < 1e-6) break;
      t -= err / d;
    }
    return sampleY(clamp(t, 0, 1));
  };
}
const easeGlide = cubicBezier(0.4, 0.0, 0.1, 1);
const easeOut = cubicBezier(0.22, 1, 0.36, 1);
/* the ascent — a rise, not a scroll. Unweights quickly, holds a near-steady
   mid-rise (the long middle is where the depth actually reads as distance
   travelled), then the water thickens and sets you down on the surface with
   no bounce. Steeper out of the gate than easeGlide, longer tail than easeOut. */
const easeAscent = cubicBezier(0.18, 0.62, 0.10, 1);
const easeExit = cubicBezier(0.4, 0, 1, 1);
const easeBeat = cubicBezier(0.3, 0, 0, 1);

/* color — the anti-confetti rule. No data hex ever hits the canvas raw. */
const hexCache = new Map();
function hexRgb(hex) {
  if (hexCache.has(hex)) return hexCache.get(hex);
  let out = [154, 164, 178];
  if (typeof hex === 'string') {
    let h = hex.replace('#', '').trim();
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    if (/^[0-9a-fA-F]{6}$/.test(h)) {
      out = [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    }
  }
  hexCache.set(hex, out);
  return out;
}
const rgbStr = (c) => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
const rgbaStr = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

const mixCache = new Map();
function mixed(kind, hex) {
  const key = kind + '|' + hex;
  if (mixCache.has(key)) return mixCache.get(key);
  const d = hexRgb(hex);
  let out;
  if (kind === 'fill') {           /* mix(data, field, 22% data) */
    out = FIELD_RGB.map((f, i) => f + 0.22 * (d[i] - f));
  } else if (kind === 'stroke') {  /* data + 70% toward ink */
    out = d.map((v, i) => v + 0.70 * (INK_RGB[i] - v));
  } else {                         /* 'star': dial + 70% toward white(#E9EDF2) */
    out = d.map((v, i) => v + 0.70 * (INK_RGB[i] - v));
  }
  const s = rgbStr(out);
  mixCache.set(key, s);
  return s;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const fmtNum = n => Number(n).toLocaleString('en-US');
const sentence = s => { s = String(s ?? ''); return s.charAt(0).toUpperCase() + s.slice(1); };

/* nearest plain-English color name, for `Rotating · Black` spec values */
const COLOR_NAMES = [
  ['Black', [12, 14, 16]], ['Blue', [30, 60, 120]], ['Navy', [16, 28, 60]],
  ['Green', [30, 90, 60]], ['Red', [170, 40, 40]], ['Orange', [225, 120, 40]],
  ['Yellow', [220, 190, 60]], ['Grey', [120, 126, 134]], ['Silver', [190, 195, 200]],
  ['White', [235, 236, 238]], ['Cream', [228, 213, 180]], ['Gold', [190, 150, 80]],
  ['Brown', [95, 65, 45]], ['Burgundy', [100, 30, 45]], ['Teal', [40, 110, 115]],
  ['Purple', [90, 60, 130]]
];
function colorName(hex) {
  if (!hex) return null;
  const c = hexRgb(hex);
  let best = null, bd = Infinity;
  for (const [name, ref] of COLOR_NAMES) {
    const d = (c[0] - ref[0]) ** 2 + (c[1] - ref[1]) ** 2 + (c[2] - ref[2]) ** 2;
    if (d < bd) { bd = d; best = name; }
  }
  return best;
}

const familyLabel = id => sentence(String(id ?? '').replace(/-/g, ' '));

/* one sentence per family — the only prose in the family index */
const FAMILY_CHARACTER = {
  'pioneers': "Two watches from before the formula existed — Omega's double-cased Marine and the radium-lit Radiomir — between them sketching everything the century would refine.",
  'submariner-lineage': "The template itself: rotating bezel, Oyster case, Mercedes hands, revised in increments so small the 1953 original remains legible in the 2020 reference.",
  'fifty-fathoms-lineage': "The other 1953 — Fiechter's combat-swimmer brief of locking bezel and moisture indicator, the diver written first as a military specification.",
  'seamaster-lineage': "Omega's long argument with the Submariner, carried from broad-arrow CK2913 to monobloc PloProf to a 6,000-metre Ultra Deep — the lineage that kept experimenting.",
  'tudor-lineage': "The working-grade sibling that grew snowflake hands into a house style, then taught the whole industry how to mine an archive with the Black Bay.",
  'japanese-toolwatch': "From the 62MAS forward, Seiko and Citizen rebuilt the diver as honest industrial product — Tunas, Turtles, and the quartz that democratized the depth rating.",
  'doxa-professional': "An orange dial and a no-decompression bezel, dived by Cousteau's people and written into Clive Cussler — the professional's watch sold to amateurs who actually dove.",
  'super-compressor': "EPSA's spring-loaded caseback sealed tighter the deeper it went; its twin crowns and inner bezel remain the most-copied case architecture never signed by a watch brand.",
  'italian-military': "Radium instruments for the frogmen of the Decima MAS, cushion cases supplied by Rolex — and a crown-sealing lever that still defines the house.",
  'german-engineering': "Submarine steel, tegimented surfaces, captive bezels — the dive watch treated as an engineering problem with a documented, over-built solution.",
  'vintage-skindiver': "The sixties' democratic diver — slim bezel, broad crown, a hundred Swiss names — the common stock every revival since has drawn against.",
  'modern-heritage': "The established houses reopening their own drawers: Sixty-Five, Captain Cook, KonTiki — reissues faithful enough to sit on this map beside their sources.",
  'microbrand-modern': "Direct-to-collector brands built on the skin-diver's plain grammar — thirty-nine millimetres, two hundred metres, nothing the brief didn't ask for.",
  'avant-garde': "What happens when the formula is optional: Zenith's faceted Defy and Richard Mille's RM 028, divers built as provocations four decades apart."
};

/* one flagship per family — the watch the category means; it leads every shelf */
const FAMILY_FLAGSHIP = {
  'pioneers': 'omega-marine-1932',
  'italian-military': 'panerai-luminor-1950',
  'fifty-fathoms-lineage': 'blancpain-fifty-fathoms-1953',
  'submariner-lineage': 'rolex-submariner-5513-1962',
  'vintage-skindiver': 'zodiac-sea-wolf-1953',
  'tudor-lineage': 'tudor-black-bay-58-2018',
  'seamaster-lineage': 'omega-seamaster-professional-2531-1993',
  'super-compressor': 'jlc-memovox-polaris-1968',
  'japanese-toolwatch': 'seiko-skx007-1996',
  'doxa-professional': 'doxa-sub-300-1967',
  'avant-garde': 'richard-mille-rm028-2010',
  'german-engineering': 'sinn-u1-2005',
  'modern-heritage': 'oris-divers-sixty-five-2015',
  'microbrand-modern': 'halios-seaforth-2017'
};

/* ======================================================================
   2 · DOM
   ====================================================================== */

const $ = id => document.getElementById(id);
const canvas = $('atlas'), body = document.body;
const elStatus = $('status'), elS1 = $('status-1'), elS2 = $('status-2');
const elSearch = $('search'), elSearchToggle = $('search-toggle'),
      elSearchInput = $('search-input'), elSearchResults = $('search-results');
const elPanel = $('panel'), elPanelClose = $('panel-close'), elPanelContent = $('panel-content');
const elFooterGauge = $('footer-gauge'),
      elFitChip = $('fit-chip'), elCartouche = $('cartouche'), elCart2 = $('cart-2'), elLive = $('live');
const elTimeline = $('timeline'), elTlPlay = $('tl-play'), elTlTrack = $('tl-track'),
      elTlRuler = $('tl-ruler'), elTlThumb = $('tl-thumb'), elTlReadout = $('tl-readout'),
      elTlNow = $('tl-now');
const tlCtx = elTlRuler.getContext('2d');
const elFamPreview = $('fam-preview'), elFpMedia = $('fp-media'),
      elFpOverline = $('fp-overline'), elFpName = $('fp-name'), elFpLine = $('fp-line');
const elLightbox = $('lightbox'), elLbImg = $('lb-img'), elLbClose = $('lb-close'),
      elLbPrev = $('lb-prev'), elLbNext = $('lb-next'),
      elLbTitle = $('lb-title'), elLbCredit = $('lb-credit'), elLbCount = $('lb-count');
const elLensChip = $('lens-chip'), elLensPanel = $('lens-panel'),
      elLensGroups = $('lens-groups'), elLensClear = $('lens-clear');
const elNoMatch = $('no-match'), elNmClear = $('nm-clear');
let nmHideTimer = null;
/* the over-filtered empty state — a designed destination, not a dead end.
   Shown only when the Lens has narrowed the resting Descent to nothing. */
function updateNoMatch() {
  /* never over the open Lens — the user is actively filtering; the empty-state
     belongs on the descent, seen once the Lens is closed (Apple HIG: no
     competing, overlapping surfaces) */
  const show = S.mode === 'descent' && !S.morph && DS.full && DS.n === 0 && !lensOpen;
  if (show) {
    clearTimeout(nmHideTimer);
    if (elNoMatch.hidden) {
      elNoMatch.hidden = false;
      requestAnimationFrame(() => requestAnimationFrame(() => elNoMatch.classList.add('on')));
    }
  } else if (!elNoMatch.hidden) {
    elNoMatch.classList.remove('on');
    clearTimeout(nmHideTimer);
    nmHideTimer = setTimeout(() => { elNoMatch.hidden = true; }, REDUCED ? 90 : 320);
  }
}
elNmClear.addEventListener('click', () => { anyInput(); lensClear(); });

const ctx = canvas.getContext('2d');
let dpr = 1, W = 0, H = 0;
let vignetteCanvas = null;
let haloCache = null;            /* {x,y,R,grad} — selection halo, invalidates on move */

/* ======================================================================
   3 · STATE
   ====================================================================== */

const S = {
  loaded: false,
  failed: false,
  mode: 'sky',                   /* 'sky' | 'descent' — one dataset, two projections (§18) */
  morph: null,                   /* {t0, dir:1|-1, fromS} — the showpiece transition (§18b) */
  watches: [],
  families: [],
  byId: new Map(),
  children: new Map(),           /* id -> direct child ids */
  bounds: { minX: 0, maxX: 1, minY: 0, maxY: 1 },
  yearMin: 1932, yearMax: 2026,

  cam: { x: 0, y: 0, z: 1 },
  fitZ: 0.5,
  flight: null,                  /* {from,to,t0,dur,ease,arcZ} */

  hoverId: null,
  hoverAnims: new Map(),         /* id -> {from,to,t0,dur} */

  selection: null,               /* {id, related:Set, edges:[], panelAnc:[], panelDesc:[], t0, genSpan} */
  releasing: null,               /* {edges, related, t0} */

  familyView: null,              /* {id, members:Set, memberList:[year-asc], label, minYear, maxYear, t0, chained} */
  famHoverId: null,              /* family id under the pointer (labels) */
  famHoverAnims: new Map(),      /* famId -> {from,to,t0,dur} — 160ms in / 220ms out */
  famLabelRects: [],             /* rebuilt each frame by draw() pass 4 — winning rects only */

  panelHoverId: null,
  panelHoverAnims: new Map(),    /* id(str) -> {from,to,t0} — 120ms curve-brighten on lineage-row hover */

  reveal: null,                  /* {t0} — ignite choreography */
  revealDone: false,

  threads: null,                 /* struct-of-arrays ambient lineage — §13b */
  weave: null,                   /* {t0[,reduced]} — thread weave, set by startReveal */
  weaveDone: false,

  drift: { x: 0, y: 0, on: false, angle: Math.random() * Math.PI * 2, release: null },
  observatoryManual: false,
  observatoryIdle: false,
  exportMode: false,

  /* the Ephemeris — y is the displayed year; y === max means the present (no filter) */
  time: { y: 2026, min: 1930, max: 2026, anim: null, playing: false, playFrom: 0, playT0: 0 },

  minuteAnim: null,              /* {from,to,t0} minute-of-day dead-beat */
  dispMinute: null,

  dragging: false
};

/* effective year this frame — Infinity until data arrives, then S.time.max (the present) */
let curTY = Infinity;

/* photograph manifests — id -> {file, credit, license, source}; empty until loaded.
   IMAGES = editorial photography (atmosphere); CATALOG = WatchBase renders
   re-plated dark (uniformity). Rows prefer CATALOG; single heroes prefer IMAGES. */
let IMAGES = {};
let CATALOG = {};
/* LORE = sourced heritage narratives for the field's legends (data/lore.json).
   Progressive enhancement — a watch without an entry simply shows no heritage. */
let LORE = {};
/* MEDIA = heritage image gallery per watch (data/media.json): owners in period,
   archival ads, the watch in use. Feeds a filmstrip in the panel + the lightbox. */
let MEDIA = {};
/* FITTING = per-watch signed weights + archetype + hook for THE FITTING quiz
   (data/fitting.json). Loaded no-cache; the quiz scores over it. */
let FITTING = null;
let pendingFitOpen = false;      /* #fit deep-link fired before fitting.json landed */
/* card surfaces demand dial-forward soldier shots — an editorial photo rides a
   card only if the pose audit cleared it (no pose field = not yet audited) */
const frontalOk = e => !e || e.pose !== 'angled';

/* ======================================================================
   4 · SCHEDULING — single rAF loop, idle when settled
   ====================================================================== */

let rafId = null;
function invalidate() {
  if (rafId === null) rafId = requestAnimationFrame(frame);
}
function animating() {
  const now = performance.now();
  if (S.morph) return true;                       /* incl. the 200ms reduced-motion crossfade */
  if (S.mode === 'descent') {
    if (DS.reflow) return true;                   /* the Lens narrow/expand reflow */
    if (DS.phase !== 'rest') return true;
    if (DS.cxA || DS.cyA) return true;
    if (now < DS.rampUntil) return true;          /* image alpha-ramps over glyph plates */
    if (DS.hintT0 && now < DS.hintT0 + 400) return true;   /* wheel-affordance fade-out */
    if (!REDUCED && now < DS.snowUntil) return true;       /* marine-snow tail (§18c) — 10fps via snowOnly */
  }
  if (S.flight) return true;
  if (S.drift.on || S.drift.release) return true;
  if (S.reveal && !S.revealDone) return true;
  if (S.weave && !S.weaveDone) return true;
  if (S.time.anim || S.time.playing) return true;
  if (lensAnim.from !== lensAnim.to && now - lensAnim.t0 < 420) return true;
  if (S.minuteAnim && now - S.minuteAnim.t0 < 140) return true;
  for (const a of S.hoverAnims.values()) if (now - a.t0 < a.dur) return true;
  for (const a of S.famHoverAnims.values()) if (now - a.t0 < 220) return true;
  for (const a of famActiveAnims.values()) if (now - a.t0 < a.dur) return true;
  for (const a of S.panelHoverAnims.values()) if (now - a.t0 < 140) return true;
  if (S.selection && now - S.selection.t0 < S.selection.animLen + 500) return true;
  if (S.familyView && now - S.familyView.t0 < 900) return true;   /* dim ramp window */
  if (S.releasing && now - S.releasing.t0 < 420) return true;
  return false;
}
/* idle drift is the only continuous animation — 8px/min cannot justify 60fps */
function driftOnly(now) {
  if (S.morph || S.mode !== 'sky') return false;
  if (!S.drift.on || S.flight || S.drift.release) return false;
  if (S.reveal && !S.revealDone) return false;
  if (S.weave && !S.weaveDone) return false;
  if (S.time.anim || S.time.playing) return false;
  if (lensAnim.from !== lensAnim.to && performance.now() - lensAnim.t0 < 420) return false;
  if (S.minuteAnim && now - S.minuteAnim.t0 < 140) return false;
  for (const a of S.hoverAnims.values()) if (now - a.t0 < a.dur) return false;
  for (const a of S.famHoverAnims.values()) if (now - a.t0 < 220) return false;
  for (const a of famActiveAnims.values()) if (now - a.t0 < a.dur) return false;
  for (const a of S.panelHoverAnims.values()) if (now - a.t0 < 140) return false;
  if (S.selection && now - S.selection.t0 < S.selection.animLen + 500) return false;
  if (S.familyView && now - S.familyView.t0 < 900) return false;
  if (S.releasing) return false;
  return true;
}
function frame(now) {
  rafId = null;
  stepFlight(now);
  stepDrift(now);
  stepDescent(now);
  if (S.mode === 'descent') syncSounding();
  if (S.loaded) {
    curTY = timeYear(now);
    positionThumb(curTY);
    maybeTimeChrome(curTY);
    /* a selected watch scrubbed out of existence releases its selection —
       or falls back to its family index when it came through one. Birth is
       judged against where time is headed, not the interpolating frame:
       selecting an unborn watch time-travels and must not be killed mid-flight */
    if (S.selection) {
      const targetY = S.time.anim ? S.time.anim.to : curTY;
      if (targetY < S.time.max - 1e-6) {
        const sw = S.byId.get(S.selection.id);
        if (sw && bornAlphaOf(sw, targetY) <= 0) {
          if (S.familyView && S.familyView.chained) returnToFamily();
          else deselect();
        }
      }
    }
  }
  draw(ctx, W, H, now, false);
  /* (the reduced-motion crossfade veil is drawn inside draw(), at the tail
     of whichever scene is incoming — see drawReducedMorphVeil) */
  if (animating()) {
    const pn = performance.now();
    /* ~10fps is plenty for sky drift — and for the marine-snow tail (§18c) */
    if (driftOnly(pn) || snowOnly(pn)) setTimeout(invalidate, 100);
    else invalidate();
  } else if (S.loaded) {
    scheduleURLWrite();          /* §19 — the settled view becomes the URL */
  }
}

/* ======================================================================
   5 · DATA
   ====================================================================== */

async function loadData() {
  /* photographs are progressive enhancement — never block the field on them */
  fetch('./data/images.json', { cache: 'no-cache' })
    .then(r => r.ok ? r.json() : null)
    .then(j => { if (j && typeof j === 'object') IMAGES = j; })
    .catch(() => { /* no manifest yet — glyphs carry the panel */ });
  fetch('./data/catalog.json', { cache: 'no-cache' })
    .then(r => r.ok ? r.json() : null)
    .then(j => { if (j && typeof j === 'object') { CATALOG = j; scheduleWarmShelf(); } })
    .catch(() => { /* no catalog layer yet */ });
  fetch('./data/lore.json', { cache: 'no-cache' })
    .then(r => r.ok ? r.json() : null)
    .then(j => { if (j && typeof j === 'object') { LORE = j; refreshPanelLore(); } })
    .catch(() => { /* no heritage layer yet */ });
  fetch('./data/media.json', { cache: 'no-cache' })
    .then(r => r.ok ? r.json() : null)
    .then(j => { if (j && typeof j === 'object') { MEDIA = j; refreshPanelLore(); } })
    .catch(() => { /* no media layer yet */ });
  fetch('./data/fitting.json', { cache: 'no-cache' })
    .then(r => r.ok ? r.json() : null)
    .then(j => { if (j && typeof j === 'object') { FITTING = j; if (pendingFitOpen) { const o = pendingFitOpen; pendingFitOpen = false; openFitting(o === true ? null : o); } } })
    .catch(() => { /* the fitting is progressive — the atlas stands without it */ });
  const t = setTimeout(() => {
    if (!S.loaded && !S.failed) {
      elS1.textContent = 'Charting the atlas…';
      elS2.textContent = '';
      elStatus.hidden = false;
      requestAnimationFrame(() => elStatus.classList.add('on'));
    }
  }, 300);
  try {
    const res = await fetch('./data/atlas.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error('http ' + res.status);
    const data = await res.json();
    if (!data || !Array.isArray(data.watches) || data.watches.length === 0) throw new Error('empty');
    clearTimeout(t);
    initData(data);
  } catch (err) {
    clearTimeout(t);
    S.failed = true;
    S.weaveDone = true;            /* nothing to weave — never leave the scheduler armed */
    elSearch.hidden = true;        /* search is inert while failed — don't offer a dead control */
    elStatus.classList.add('error');
    elS1.textContent = 'The atlas could not be loaded.';
    elS2.textContent = 'Serve the project root and ensure data/atlas.json exists.';
    elStatus.hidden = false;
    requestAnimationFrame(() => elStatus.classList.add('on'));
    body.classList.remove('pre-reveal');
    invalidate();
  }
}

function initData(data) {
  S.watches = data.watches.filter(w => w && w.id != null && isFinite(w.x) && isFinite(w.y));
  S.families = Array.isArray(data.families) ? data.families : [];
  S.byId = new Map(S.watches.map(w => [w.id, w]));

  /* graph */
  S.children = new Map();
  for (const w of S.watches) {
    for (const p of (w.parents || [])) {
      if (!S.byId.has(p)) continue;
      if (!S.children.has(p)) S.children.set(p, []);
      S.children.get(p).push(w.id);
    }
  }
  for (const kids of S.children.values()) kids.sort((a, b) => (S.byId.get(a).year || 0) - (S.byId.get(b).year || 0));

  /* transitive descendant count — THE ONE LAW: magnitude = influence */
  const memo = new Map();
  const countDesc = (id, seen) => {
    if (memo.has(id)) return memo.get(id);
    if (seen.has(id)) return new Set();      /* cycle guard */
    seen.add(id);
    const acc = new Set();
    for (const c of (S.children.get(id) || [])) {
      acc.add(c);
      for (const d of countDesc(c, seen)) acc.add(d);
    }
    seen.delete(id);
    memo.set(id, acc);
    return acc;
  };
  for (const w of S.watches) {
    const dset = countDesc(w.id, new Set());
    w._desc = dset.size;
    /* sorted descendant intro years — magnitude becomes a function of time */
    w._descYears = [...dset].map(i => S.byId.get(i).year || 0).sort((a, b) => a - b);
    w._r = magR(w._desc);
    w._glow = null;
  }

  /* every lineage edge, precomputed once — the ambient structure (§13b) */
  buildThreads();

  /* reveal order: canon first */
  const ranked = [...S.watches].sort((a, b) => b._desc - a._desc);
  const n = ranked.length;
  ranked.forEach((w, i) => {
    /* ignite start distributed by rank inside 200–1100ms (each fade is 300ms → ends by 1400ms) */
    w._ignite = 200 + (n > 1 ? (i / (n - 1)) : 0) * 900;
  });

  /* world bounds */
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const w of S.watches) {
    if (w.x < minX) minX = w.x; if (w.x > maxX) maxX = w.x;
    if (w.y < minY) minY = w.y; if (w.y > maxY) maxY = w.y;
  }
  if (!isFinite(minX)) { minX = 0; maxX = 1; minY = 0; maxY = 1; }
  S.bounds = { minX, maxX, minY, maxY };

  const years = S.watches.map(w => w.year).filter(y => isFinite(y));
  S.yearMin = years.length ? Math.min(...years) : 1932;
  S.yearMax = years.length ? Math.max(...years) : 2026;

  /* the Ephemeris — time domain, family birth years, ruler */
  S.time.min = Math.floor(S.yearMin / 10) * 10;
  S.time.max = S.yearMax;
  S.time.y = S.time.max;
  curTY = S.time.max;
  yearsSorted = years.slice().sort((a, b) => a - b);
  const famMin = new Map();
  for (const w of S.watches) {
    const k = w.designFamily;
    if (!famMin.has(k) || (w.year || 9999) < famMin.get(k)) famMin.set(k, w.year || 9999);
  }
  for (const f of S.families) f._minYear = famMin.get(f.id) ?? S.yearMin;

  /* the Lens — attribute keys per watch */
  for (const w of S.watches) {
    const lo = Array.isArray(w.priceBandUsd) ? w.priceBandUsd[0] : 0;
    const hi = Array.isArray(w.priceBandUsd) ? w.priceBandUsd[1] : lo;
    const p = Math.sqrt(Math.max(lo, 1) * Math.max(hi, 1));
    const cn = colorName(w.dialColor);
    w._price = p;   /* geometric mean of the band — the range slider keys on this */
    w._lens = {
      dial: cn === 'Black' ? 'black'
        : (cn === 'Blue' || cn === 'Navy' || cn === 'Teal' || cn === 'Purple') ? 'blue'
        : cn === 'Green' ? 'green'
        : (cn === 'Orange' || cn === 'Red' || cn === 'Burgundy' || cn === 'Yellow'
           || cn === 'Gold' || cn === 'Brown') ? 'warm'   /* gilt folded in — one member didn't earn a chip */
        : (cn === 'White' || cn === 'Cream' || cn === 'Silver' || cn === 'Grey') ? 'light'
        : null,
      /* solar folds into quartz (an Eco-Drive is solar-charged quartz) and
         spring-drive into automatic (it winds itself) — the chips went, the
         watches stay filterable instead of orphaned */
      movement: w.movement === 'solar' ? 'quartz'
        : w.movement === 'spring-drive' ? 'automatic'
        : w.movement || null,
      size: !isFinite(w.diameterMm) ? 's3' : w.diameterMm < 38.5 ? 's1' : w.diameterMm < 39.5 ? 's39' : w.diameterMm < 40.5 ? 's40' : w.diameterMm < 41.5 ? 's41' : w.diameterMm < 42.5 ? 's42' : 's3',
      origin: w.country || null,
      /* pre-1950 is three watches across two decades — two chips guarding dead
         ends; one honest shelf instead */
      era: !w.year ? null : w.year < 1950 ? 'pre' : String(Math.floor(w.year / 10) * 10),
      /* authored per-watch; steel is the fallback because it is true for the
         overwhelming share of the corpus. 'composite' (G-Shock resin) matches
         no chip on purpose — the four options are the four honest materials. */
      material: w.caseMaterial || 'steel',
    };
  }
  buildLens();

  elTlTrack.setAttribute('aria-valuemin', String(S.time.min));
  elTlTrack.setAttribute('aria-valuemax', String(S.time.max));
  elTimeline.hidden = false;
  sizeRuler();

  /* chrome copy computed from data */
  elFooterGauge.textContent = `${S.yearMin} — ${S.yearMax} · ${S.watches.length} watches`;
  elCart2.textContent = `${S.yearMin} — ${S.yearMax} · ${S.watches.length} WATCHES`;
  canvas.setAttribute('aria-label',
    `The Horological Atlas — a map of ${S.watches.length} dive watches, ${S.yearMin}–${S.yearMax}`);

  elStatus.classList.remove('on');
  setTimeout(() => { elStatus.hidden = true; }, 340);

  computeFit();
  S.cam.x = (minX + maxX) / 2;
  S.cam.y = (minY + maxY) / 2;
  S.cam.z = S.fitZ;

  /* the Descent — depth ordering, strata, sprite plumbing (§18) */
  initDescent();

  S.loaded = true;
  if (!applyDeepLink()) defaultToDescent();   /* restore a shared view, else land in the default (descent) */
  scheduleMinuteTick();
  resetIdleTimer();
  invalidate();
}

/* Land directly in the Descent at boot — the rest-state of a completed dir=1
   morph, minus the flight. The sky reveal is consumed (never seen from below);
   toggling up to SKY later just shows the field settled. */
function defaultToDescent() {
  const now = performance.now();
  S.reveal = null; S.revealDone = true; S.weave = null; S.weaveDone = true;
  try { sessionStorage.setItem('atlas.revealed', '1'); } catch (e) { /* private mode */ }
  body.classList.remove('pre-reveal', 'revealing');   /* chrome fades in via .chrome, no stagger */
  S.mode = 'descent';
  DS.cxA = DS.cyA = null;
  DS.cx = descTargetCX();
  DS.cy = descTargetCY();
  DS.phase = 'rest';
  DS.v = 0;
  DS.lastT = now;
  DS.lastFocus = -1;
  refreshFocus();
  applyDescentChrome(true);
  body.classList.add('descent');
  scheduleWaterTail(now);
  syncToggle();
}

/* ======================================================================
   19 · DEEP LINKS — every view is a URL
   mode, selection, descent depth, sky camera, year, family → the hash,
   restored on load. replaceState only (no history spam), written when the
   view settles or a selection/mode changes. Lens filters deferred (v1).
   ====================================================================== */

let urlSig = '', urlTimer = null;

function urlFromState() {
  const p = ['m=' + S.mode];
  if (S.selection) p.push('w=' + S.selection.id);
  else if (S.mode === 'descent') p.push('d=' + Math.round(DS.s));
  else if (S.familyView) p.push('fam=' + S.familyView.id);
  else p.push('c=' + Math.round(S.cam.x) + ',' + Math.round(S.cam.y) + ',' + S.cam.z.toFixed(2));
  if (S.mode === 'sky' && timeEngaged()) p.push('y=' + Math.round(curTY));
  return '#' + p.join('&');
}
/* ---- THE WARM SHELF ------------------------------------------------------
   While the hero holds the eye, the first cards of the descent fetch at idle,
   so arrival shows plates instead of glyphs popping in. The browser's HTTP
   cache is the hand-off: the sprite loader later requests the same URLs and
   hits it. Deliberately at idle (never competing with boot for the thing the
   visitor is looking at), skipped under Data Saver, and capped at ten — the
   first viewport and a half, not the corpus. */
let warmShelfDone = false;
function warmFirstShelf() {
  if (warmShelfDone) return;
  if (navigator.connection && navigator.connection.saveData) { warmShelfDone = true; return; }
  if (!DS.order || !DS.order.length || !CATALOG || !Object.keys(CATALOG).length) {
    setTimeout(warmFirstShelf, 1200);            /* a layer is still landing — retry */
    return;
  }
  warmShelfDone = true;
  for (const w of DS.order.slice(0, 10)) {
    const c = CATALOG[w.id];
    if (c && c.file) { const im = new Image(); im.src = './data/' + c.file; }
  }
}
function scheduleWarmShelf() {
  if ('requestIdleCallback' in window) requestIdleCallback(warmFirstShelf, { timeout: 5000 });
  else setTimeout(warmFirstShelf, 2500);
}

function writeURL() {
  urlTimer = null;
  if (!S.loaded || S.morph) return;
  /* the fitting overlay owns the address bar while it's open — otherwise the
     world underneath keeps settling and overwrites #fit&r=<id>, so a recipient
     who copies the URL sends on a link to the atlas instead of the plate */
  if (fitOpen) return;
  const h = urlFromState();
  if (h === urlSig) return;
  urlSig = h;
  try { history.replaceState(null, '', h); } catch (e) { /* file:// */ }
}
function scheduleURLWrite() {
  if (urlTimer == null) urlTimer = setTimeout(writeURL, 250);
}

/* land the settled sky directly (deep-link into sky) — the reveal is consumed,
   the chrome is sky, no morph animation */
function landSky() {
  S.reveal = null; S.revealDone = true; S.weave = null; S.weaveDone = true;
  try { sessionStorage.setItem('atlas.revealed', '1'); } catch (e) { /* private mode */ }
  body.classList.remove('pre-reveal', 'revealing', 'descent');
  S.mode = 'sky';
  applyDescentChrome(false);
  syncToggle();
}

/* apply the URL hash at boot; returns false when there's nothing to restore
   (caller then lands in the default projection, descent) */
function applyDeepLink() {
  let h = '';
  try { h = (location.hash || '').replace(/^#/, ''); } catch (e) { return false; }
  if (!h) return false;
  /* #fit — open THE FITTING at boot, over the default projection. Land descent
     underneath so a close/See-it-in-the-atlas has a world to return to. */
  if (h === 'fit' || h.indexOf('fit&') === 0 || /(^|&)fit(&|$)/.test(h)) {
    defaultToDescent();
    scheduleWaterTail(performance.now());
    /* #fit&r=<id> — a plate someone was sent. Open on THEIR result, with one
       thing to do: take your own. */
    let rec = null;
    try { rec = new URLSearchParams(h).get('r'); } catch (e) {}
    const opts = rec ? { received: rec } : null;
    if (FITTING) openFitting(opts); else pendingFitOpen = opts || true;
    return true;
  }
  const p = new URLSearchParams(h);
  const w = p.get('w');

  if (p.get('m') === 'sky') {
    landSky();
    const yr = parseInt(p.get('y'), 10);
    if (isFinite(yr)) { S.time.anim = null; S.time.y = clamp(yr, S.time.min, S.time.max); curTY = S.time.y; }
    if (w && S.byId.has(w)) selectWatch(w);
    else if (p.get('fam') && S.families.some(f => f.id === p.get('fam'))) openFamily(p.get('fam'));
    else if (p.get('c')) {
      const [cx, cy, cz] = String(p.get('c')).split(',').map(Number);
      if (isFinite(cx) && isFinite(cy) && isFinite(cz)) { S.cam.x = cx; S.cam.y = cy; S.cam.z = clamp(cz, S.fitZ, Z_MAX); clampCam(); }
    }
    return true;
  }

  /* descent — the default; restore a selection or a depth */
  defaultToDescent();
  if (w && S.byId.has(w)) {
    const ww = S.byId.get(w);
    if (isFinite(ww._di)) { DS.s = ww._di; DS.lastFocus = -1; refreshFocus(); }
    selectWatch(w, { fly: false });
  } else {
    const d = parseInt(p.get('d'), 10);
    if (isFinite(d)) { DS.s = clamp(d, 0, DS.n - 1); DS.lastFocus = -1; refreshFocus(); }
  }
  /* the tail was scheduled at the surface (defaultToDescent) — re-read it at
     the restored depth, or a deep-linked hadal arrival sleeps in 4s */
  scheduleWaterTail(performance.now());
  return true;
}

function computeFit() {
  const { minX, maxX, minY, maxY } = S.bounds;
  const ew = Math.max(maxX - minX, 1e-6), eh = Math.max(maxY - minY, 1e-6);
  const portrait = H > W && W < 620;
  if (portrait) {
    /* Mobile portrait: the sky is wide, the screen is tall — fitting to width
       strands the constellation as a speck in a sea of black. Instead fill the
       USABLE band (between the top nav and the bottom actions) and let the sky
       bleed gently past the sides, pannable — immersive, not a distant cluster. */
    const usableH = Math.max(H - 260, H * 0.6);   /* ~nav (top) + actions (bottom) */
    const fitH = usableH / eh;
    const fitW = (W - 24) / ew;
    S.fitZ = Math.min(fitH, fitW * 1.85);         /* toward filling height; keep edge labels mostly on-screen */
  } else {
    S.fitZ = Math.min((W - 120) / ew, (H - 120) / eh);
  }
  if (!isFinite(S.fitZ) || S.fitZ <= 0) S.fitZ = 1;
}
const worldDiag = () => Math.hypot(S.bounds.maxX - S.bounds.minX, S.bounds.maxY - S.bounds.minY);

/* ======================================================================
   6 · CAMERA
   ====================================================================== */

function toScreen(wx, wy) {
  return [
    (wx - (S.cam.x + S.drift.x / S.cam.z)) * S.cam.z + W / 2,
    (wy - (S.cam.y + S.drift.y / S.cam.z)) * S.cam.z + H / 2
  ];
}
function toWorld(sx, sy) {
  return [
    (sx - W / 2) / S.cam.z + S.cam.x + S.drift.x / S.cam.z,
    (sy - H / 2) / S.cam.z + S.cam.y + S.drift.y / S.cam.z
  ];
}

function clampCam() {
  const { minX, maxX, minY, maxY } = S.bounds;
  const px = (maxX - minX) * 0.25, py = (maxY - minY) * 0.25;
  S.cam.x = clamp(S.cam.x, minX - px, maxX + px);
  S.cam.y = clamp(S.cam.y, minY - py, maxY + py);
  S.cam.z = clamp(S.cam.z, S.fitZ, Z_MAX);
}

let reducedCutTimer = null;      /* pending reduced-motion cut — cancellable like any flight */
let pendingCam = null;           /* target of the pending cut, so steps compound correctly */
function flyTo(x, y, z, dur = 1000, ease = easeGlide) {
  z = clamp(z, S.fitZ, Z_MAX);
  if (REDUCED) {
    /* cut with a 200ms whole-canvas opacity crossfade — cancellable, compoundable */
    pendingCam = { x, y, z };
    clearTimeout(reducedCutTimer);
    canvas.style.transition = 'opacity 100ms linear';
    canvas.style.opacity = '0';
    reducedCutTimer = setTimeout(() => {
      reducedCutTimer = null;
      const tgt = pendingCam; pendingCam = null;
      if (tgt) { S.cam.x = tgt.x; S.cam.y = tgt.y; S.cam.z = tgt.z; clampCam(); }
      canvas.style.opacity = '1';
      setTimeout(() => { canvas.style.transition = ''; }, 120);
      invalidate();
    }, 100);
    return;
  }
  const from = { x: S.cam.x, y: S.cam.y, z: S.cam.z };
  const to = { x, y, z };
  /* van Wijk arc when travel > 40% of world extent */
  let arcZ = null;
  const dist = Math.hypot(to.x - from.x, to.y - from.y);
  if (dist > 0.4 * worldDiag()) {
    const bw = Math.abs(to.x - from.x) + 80 / Math.min(from.z, to.z);
    const bh = Math.abs(to.y - from.y) + 80 / Math.min(from.z, to.z);
    const zBoth = Math.min((W - 120) / Math.max(bw, 1e-6), (H - 120) / Math.max(bh, 1e-6));
    arcZ = clamp(Math.min(zBoth, from.z, to.z), S.fitZ, Z_MAX);
    if (arcZ >= Math.min(from.z, to.z) * 0.98) arcZ = null;
  }
  S.flight = { from, to, arcZ, t0: performance.now(), dur, ease };
  chromeDim(true);
  invalidate();
}

function cancelFlight() {
  if (S.flight) { S.flight = null; chromeDim(false); }
  if (reducedCutTimer !== null) {
    clearTimeout(reducedCutTimer);
    reducedCutTimer = null;
    pendingCam = null;
    canvas.style.opacity = '1';
    canvas.style.transition = '';
  }
}

function stepFlight(now) {
  const f = S.flight;
  if (!f) return;
  const p = clamp((now - f.t0) / f.dur, 0, 1);
  const e = f.ease(p);
  S.cam.x = lerp(f.from.x, f.to.x, e);
  S.cam.y = lerp(f.from.y, f.to.y, e);
  let zl = lerp(Math.log(f.from.z), Math.log(f.to.z), e);
  if (f.arcZ != null) {
    const peak = 0.35;
    const b = p < peak ? easeGlide(p / peak) : easeGlide((1 - p) / (1 - peak));
    zl = lerp(zl, Math.log(f.arcZ), b);
  }
  S.cam.z = Math.exp(zl);
  clampCam();
  if (p >= 1) { S.flight = null; chromeDim(false); }
}

function fitAll(dur = 1000) {
  const { minX, maxX, minY, maxY } = S.bounds;
  computeFit();
  flyTo((minX + maxX) / 2, (minY + maxY) / 2, S.fitZ, dur);
}

/* selection flight — panel never covers the watch */
function flyToWatch(w) {
  const z = Math.max(S.cam.z, 7);
  let cx = w.x, cy = w.y;
  if (window.innerWidth > 760) {
    /* watch lands at viewport x = (vw − 360)/2 → camera center offset right by 180/z */
    cx = w.x + 180 / z;
  } else {
    /* bottom sheet: watch lands in the visible upper band (~19vh) */
    cy = w.y + (H / 2 - H * 0.19) / z;
  }
  flyTo(cx, cy, z);
}

/* family flight — the panel never covers the family's territory.
   Bbox uses ALL members regardless of time: geography is fixed; the camera
   must not lurch when the user scrubs with the index open. */
function fitFamily(fam) {
  const members = S.watches.filter(w => w.designFamily === fam.id);
  if (!members.length) return;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const w of members) {
    if (w.x < minX) minX = w.x; if (w.x > maxX) maxX = w.x;
    if (w.y < minY) minY = w.y; if (w.y > maxY) maxY = w.y;
  }
  const bw = Math.max(maxX - minX, 1e-6), bh = Math.max(maxY - minY, 1e-6);
  let z, cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  if (window.innerWidth > 760) {
    /* free region = viewport minus the 360px panel + 16px inset; z capped
       at 5 so a two-member family stays a region of the field, not an exhibit */
    z = clamp(Math.min((W - 392 - 120) / bw, (H - 120) / bh), S.fitZ, 5);
    cx += 180 / z;
  } else {
    /* bottom sheet: fit into the visible upper band */
    z = clamp(Math.min((W - 64) / bw, (H * 0.34) / bh), S.fitZ, 5);
    cy += (H / 2 - H * 0.19) / z;
  }
  flyTo(cx, cy, z, 1000);
}

/* ======================================================================
   7 · CHROME DIM / OBSERVATORY / IDLE
   ====================================================================== */

let chromeRestoreTimer = null;
function chromeDim(on) {
  if (on) {
    clearTimeout(chromeRestoreTimer);
    body.classList.add('dim-chrome');
  } else {
    clearTimeout(chromeRestoreTimer);
    chromeRestoreTimer = setTimeout(() => body.classList.remove('dim-chrome'), 400);
  }
}

let idleTimer = null;
function resetIdleTimer() {
  clearTimeout(idleTimer);
  if (S.observatoryIdle) wakeFromIdle();
  if (REDUCED || !S.loaded) return;
  idleTimer = setTimeout(() => {
    if (S.exportMode || S.observatoryManual) return;
    if (S.mode !== 'sky' || S.morph) return;   /* the Cousteau drift is a sky ritual (v1) */
    S.observatoryIdle = true;
    S.drift.on = true;
    S.drift.last = performance.now();
    body.classList.add('observatory');
    scheduleCousteau();
    invalidate();
  }, 45000);
}

/* ---- the surfacing — Cousteau, once per session, only in idle drift ---- */
const elCousteau = $('cousteau');
let cousteauTimer = null, cousteauHideTimer = null, cousteauSeen = false;
try { cousteauSeen = sessionStorage.getItem('atlas.cousteau') === '1'; } catch (e) { /* private mode */ }

function scheduleCousteau() {
  if (cousteauSeen) return;
  clearTimeout(cousteauTimer);
  /* five seconds of drift first — the sky settles before the words arrive */
  cousteauTimer = setTimeout(() => {
    if (!S.observatoryIdle || S.exportMode) return;
    cousteauSeen = true;
    try { sessionStorage.setItem('atlas.cousteau', '1'); } catch (e) { /* private mode */ }
    elCousteau.hidden = false;
    requestAnimationFrame(() => elCousteau.classList.add('on'));
    /* long enough to read twice, gone before it becomes furniture */
    cousteauHideTimer = setTimeout(dismissCousteau, 18000);
  }, 5000);
}
function dismissCousteau() {
  clearTimeout(cousteauTimer);
  clearTimeout(cousteauHideTimer);
  cousteauTimer = cousteauHideTimer = null;
  if (elCousteau.hidden) return;
  elCousteau.classList.remove('on');
  elCousteau.classList.add('off');
  setTimeout(() => { elCousteau.hidden = true; elCousteau.classList.remove('off'); }, 950);
}
function wakeFromIdle() {
  S.observatoryIdle = false;
  S.drift.on = false;
  dismissCousteau();
  /* drift is display-only and cancels on wake — glide the offset home over 240ms */
  if (S.drift.x || S.drift.y) {
    S.drift.release = { x: S.drift.x, y: S.drift.y, t0: performance.now() };
  }
  if (!S.observatoryManual && !S.exportMode) body.classList.remove('observatory');
  invalidate();
}
function stepDrift(now) {
  if (S.drift.on) {
    const dt = Math.min(now - (S.drift.last || now), 100);
    S.drift.last = now;
    const v = 8 / 60000;                       /* ~8 px/min */
    S.drift.angle += dt * 0.00002;
    S.drift.x += Math.cos(S.drift.angle) * v * dt;
    S.drift.y += Math.sin(S.drift.angle) * v * dt;
  } else if (S.drift.release) {
    const p = clamp((now - S.drift.release.t0) / 240, 0, 1);
    const e = 1 - easeOut(p);
    S.drift.x = S.drift.release.x * e;
    S.drift.y = S.drift.release.y * e;
    if (p >= 1) { S.drift.release = null; S.drift.x = 0; S.drift.y = 0; }
  }
}

function toggleObservatory() {
  S.observatoryManual = !S.observatoryManual;
  if (S.observatoryManual) closeLensPanel();
  if (S.observatoryManual) body.classList.add('observatory');
  else if (!S.observatoryIdle) body.classList.remove('observatory');
  invalidate();
}

/* ======================================================================
   8 · REVEAL (Ignition)
   ====================================================================== */

function startReveal() {
  /* runs once per session (§4) — same sessionStorage pattern as Cousteau */
  let seen = false;
  try { seen = sessionStorage.getItem('atlas.revealed') === '1'; } catch (e) { /* private mode */ }
  try { sessionStorage.setItem('atlas.revealed', '1'); } catch (e) { /* private mode */ }
  if (seen) {
    S.reveal = null; S.revealDone = true;
    S.weaveDone = true;                     /* returning session — the poster arrives complete */
    body.classList.remove('pre-reveal');
    invalidate();
    return;
  }
  if (REDUCED) {
    /* reduced motion: a single 400ms opacity fade, no scale, no stagger —
       threads crossfade in with the stars, no dash, no weave */
    S.reveal = { t0: performance.now(), reduced: true };
    S.weave = { t0: performance.now(), reduced: true };
    body.classList.remove('pre-reveal');
    setTimeout(() => { S.revealDone = true; S.weaveDone = true; invalidate(); }, 400);
    invalidate();
    return;
  }
  S.reveal = { t0: performance.now() };
  /* after the sky exists, the threads weave in — oldest edges first,
     1500–3000ms: the century assembling itself (§13b) */
  S.weave = { t0: S.reveal.t0 };
  body.classList.add('revealing');
  setTimeout(() => body.classList.remove('pre-reveal'), 1500);
  setTimeout(() => { S.revealDone = true; invalidate(); }, 1950);
  setTimeout(() => body.classList.remove('revealing'), 2100);   /* stagger CSS must not outlive the Ignition */
  setTimeout(() => { S.weaveDone = true; invalidate(); }, 3100);
  invalidate();
}
function skipReveal() {
  /* any input cuts to the finished poster — ignition and weave alike */
  if (S.weave && !S.weaveDone) {
    S.weaveDone = true;
    invalidate();
  }
  if (S.reveal && !S.revealDone) {
    S.revealDone = true;
    body.classList.remove('pre-reveal');
    body.classList.remove('revealing');
    invalidate();
  }
}
function revealState(w, now) {
  if (S.revealDone || !S.reveal) return { a: 1, s: 1 };
  if (S.reveal.reduced) return { a: clamp((now - S.reveal.t0) / 400, 0, 1), s: 1 };
  const t = now - S.reveal.t0 - w._ignite;
  if (t <= 0) return { a: 0, s: 0.6 };
  const p = easeOut(clamp(t / 300, 0, 1));
  return { a: p, s: 0.6 + 0.4 * p };
}
function revealFamAlpha(now) {
  if (S.revealDone || !S.reveal) return 1;
  if (S.reveal.reduced) return clamp((now - S.reveal.t0) / 400, 0, 1);
  return clamp((now - S.reveal.t0 - 1200) / 400, 0, 1);
}

/* ======================================================================
   9 · TIME — live hands, dead-beat minute
   ====================================================================== */

let minuteTimer = null;
function scheduleMinuteTick() {
  clearTimeout(minuteTimer);
  const d = new Date();
  const wait = (60 - d.getSeconds()) * 1000 - d.getMilliseconds() + 20;
  minuteTimer = setTimeout(() => {
    const n = new Date();
    const m = n.getHours() * 60 + n.getMinutes();
    if (S.dispMinute != null && m !== S.dispMinute && !REDUCED) {
      /* shortest forward step modulo 1440 — at midnight animate 1439 → 1440,
         never backward through the day (angle math wraps via mod) */
      let delta = m - S.dispMinute;
      if (delta < -720) delta += 1440;
      S.minuteAnim = { from: m - delta, to: m, t0: performance.now() };
    }
    S.dispMinute = m;
    scheduleMinuteTick();
    invalidate();
  }, Math.max(wait, 250));
}
function currentMinuteOfDay(now) {
  if (S.dispMinute == null) {
    const d = new Date();
    S.dispMinute = d.getHours() * 60 + d.getMinutes();
  }
  if (S.minuteAnim && !REDUCED) {
    const p = clamp((now - S.minuteAnim.t0) / 120, 0, 1);
    const v = lerp(S.minuteAnim.from, S.minuteAnim.to, easeBeat(p));
    if (p >= 1) S.minuteAnim = null;
    return v;
  }
  return S.dispMinute;
}

/* ======================================================================
   9b · THE EPHEMERIS — the field as it existed
   Scrub the century: watches unborn at the chosen year do not render, and
   magnitude re-derives from only the descendants that existed by then.
   The one law holds — every pixel still encodes data, now indexed by time.
   ====================================================================== */

const PLAY_MS = 32000;                /* the whole century in 32s (~3 yr/s) */
let yearsSorted = [];
let tlW = 0, tlH = 0, tlDragging = false;
let lastTlYear = null, lastTlEngaged = null, lastLensSig = '';

function bornAlphaOf(w, TY) {
  const y = w.year || 0;
  return y <= TY ? 1 : TY > y - 0.6 ? (TY - (y - 0.6)) / 0.6 : 0;
}
function descAt(w, TY) {
  const a = w._descYears || [];
  let lo = 0, hi = a.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] <= TY) lo = m + 1; else hi = m; }
  return lo;
}
function countBorn(yr) {
  let lo = 0, hi = yearsSorted.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (yearsSorted[m] <= yr) lo = m + 1; else hi = m; }
  return lo;
}
function timeEngaged() {
  return S.time.playing || S.time.anim != null || S.time.y < S.time.max - 1e-6;
}
function timeYear(now) {
  const T = S.time;
  if (T.anim) {
    const p = clamp((now - T.anim.t0) / T.anim.dur, 0, 1);
    const v = lerp(T.anim.from, T.anim.to, T.anim.ease(p));
    if (p >= 1) { T.y = T.anim.to; T.anim = null; }
    return v;
  }
  if (T.playing) {
    let v = T.playFrom + (now - T.playT0) / PLAY_MS * (T.max - T.min);
    if (REDUCED) v = T.playFrom + Math.floor((v - T.playFrom) / 2) * 2;  /* stepped, not swept */
    if (v >= T.max) { T.playing = false; T.y = T.max; setPlayIcon(false); return T.max; }
    return v;
  }
  return T.y;
}
function setTimeYear(y, opts = {}) {
  const T = S.time;
  if (T.playing) { T.playing = false; setPlayIcon(false); }
  y = clamp(y, T.min, T.max);
  if (y >= T.max - 0.25) y = T.max;   /* the right edge is the present */
  const from = timeYear(performance.now());
  if (opts.dur && !REDUCED && Math.abs(y - from) > 0.01) {
    T.anim = { from, to: y, t0: performance.now(), dur: opts.dur, ease: opts.ease || easeGlide };
  } else {
    T.anim = null;
    T.y = y;
  }
  invalidate();
}
function stopPlay() {
  if (!S.time.playing) return;
  S.time.y = timeYear(performance.now());
  S.time.playing = false;
  setPlayIcon(false);
}
function togglePlay() {
  if (!S.loaded) return;
  const T = S.time;
  if (T.playing) { stopPlay(); invalidate(); return; }
  const cur = T.anim ? T.anim.to : T.y;
  T.anim = null;
  T.playFrom = cur >= T.max - 1e-6 ? T.min : cur;   /* from the top, or resume */
  T.playT0 = performance.now();
  T.playing = true;
  setPlayIcon(true);
  elLive.textContent = 'Playing the century.';
  invalidate();
}
function returnToPresent() {
  stopPlay();
  setTimeYear(S.time.max, { dur: 900 });
  elLive.textContent = 'Returned to the present.';
}

const ICON_PLAY = '<svg width="9" height="10" viewBox="0 0 9 10" aria-hidden="true"><path d="M1 0.8 L8.2 5 L1 9.2 Z" fill="currentColor"/></svg>';
const ICON_PAUSE = '<svg width="9" height="10" viewBox="0 0 9 10" aria-hidden="true"><path d="M2 1 V9 M7 1 V9" stroke="currentColor" stroke-width="1.5" fill="none"/></svg>';
function setPlayIcon(playing) {
  elTlPlay.innerHTML = playing ? ICON_PAUSE : ICON_PLAY;
  elTlPlay.setAttribute('aria-label', playing ? 'Pause' : 'Play the century');
  elTlPlay.setAttribute('title', playing ? 'Pause (Space)' : 'Play the century (Space)');
}

function positionThumb(TY) {
  if (tlW <= 0) return;
  const T = S.time;
  const x = (clamp(TY, T.min, T.max) - T.min) / (T.max - T.min) * tlW;
  elTlThumb.style.transform = `translateX(${x}px)`;
}
function sizeRuler() {
  tlW = elTlTrack.clientWidth;
  tlH = elTlTrack.clientHeight || 40;
  if (tlW <= 0) return;
  elTlRuler.width = Math.max(1, Math.round(tlW * dpr));
  elTlRuler.height = Math.max(1, Math.round(tlH * dpr));
  tlCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawRuler(curTY === Infinity ? S.time.max : curTY);
}
function drawRuler(TY) {
  if (!S.loaded || tlW <= 0) return;
  const T = S.time;
  tlCtx.clearRect(0, 0, tlW, tlH);
  const pxY = tlW / (T.max - T.min);
  const base = 18.5;
  const engaged = TY < T.max - 1e-6;
  tlCtx.lineWidth = 1;
  tlCtx.strokeStyle = 'rgba(233,237,242,0.10)';
  tlCtx.beginPath(); tlCtx.moveTo(0, base); tlCtx.lineTo(tlW, base); tlCtx.stroke();
  const step = pxY * 5 >= 44 ? 5 : pxY * 10 >= 44 ? 10 : 20;
  const minor = pxY >= 3;
  tlCtx.textAlign = 'center';
  tlCtx.textBaseline = 'alphabetic';
  tlCtx.font = '400 9px ' + FONT_MONO;
  for (let y = Math.ceil(T.min); y <= T.max; y++) {
    const isMajor = y % step === 0;
    if (!isMajor && !minor) continue;
    const x = Math.round((y - T.min) * pxY) + 0.5;
    const dim = engaged && y > TY ? 0.35 : 1;      /* epochs not yet reached recede */
    tlCtx.strokeStyle = `rgba(233,237,242,${(isMajor ? 0.22 : 0.10) * dim})`;
    tlCtx.beginPath();
    tlCtx.moveTo(x, base + 1.5);
    tlCtx.lineTo(x, base + 1.5 + (isMajor ? 6 : 3));
    tlCtx.stroke();
    if (isMajor && x >= 15 && x <= tlW - 15) {
      /* a clipped year is worse than no year — edge labels wait for space */
      tlCtx.fillStyle = engaged && y > TY ? 'rgba(92,102,114,0.4)' : TEXT_3;
      tlCtx.fillText(String(y), x, base - 6);
    }
  }
}
function maybeTimeChrome(TY) {
  /* in descent the footer belongs to the depth gauge, the cartouche to the
     strata — release the memo so the sky copy re-derives on surfacing */
  if (descentChromeOn) { lastTlYear = null; return; }
  const yr = Math.round(TY);
  const engaged = TY < S.time.max - 1e-6;
  const lsig = lensSigStr();
  if (yr === lastTlYear && engaged === lastTlEngaged && lsig === lastLensSig) return;
  lastTlYear = yr; lastTlEngaged = engaged; lastLensSig = lsig;
  const total = S.watches.length;
  const lensOn = lensActive();
  if (engaged) {
    const vis = countBorn(yr);
    const suffix = lensOn ? ` · ${lensCount()} in lens` : '';
    elFooterGauge.textContent = `${S.yearMin} — ${yr} · ${vis} of ${total} watches${suffix}`;
    elCart2.textContent = `AS OF ${yr} · ${vis} OF ${total} WATCHES${lensOn ? ` · LENS ${lensCount()}` : ''}`;
    elTlTrack.setAttribute('aria-valuetext', `${yr} — ${vis} of ${total} watches`);
  } else if (lensOn) {
    elFooterGauge.textContent = `${lensCount()} of ${total} · ${lensSummaryText()}`;
    elCart2.textContent = `${lensCount()} OF ${total} · ${lensSummaryText().toUpperCase()}`;
    elTlTrack.setAttribute('aria-valuetext', `Now — all ${total} watches`);
  } else {
    elFooterGauge.textContent = `${S.yearMin} — ${S.yearMax} · ${total} watches`;
    elCart2.textContent = `${S.yearMin} — ${S.yearMax} · ${total} WATCHES`;
    elTlTrack.setAttribute('aria-valuetext', `Now — all ${total} watches`);
  }
  elTlTrack.setAttribute('aria-valuenow', String(yr));
  elTlReadout.textContent = String(yr);
  elTimeline.classList.toggle('engaged', engaged);
  elTimeline.classList.toggle('at-now', !engaged);
  drawRuler(TY);
  /* the family index counts honestly under time — class flips only, no re-inject */
  if (S.familyView && !S.selection && !elPanel.hidden) updateFamilyPanelTime(yr, engaged);
}

/* --- ephemeris input --- */
function scrubTo(e) {
  const r = elTlTrack.getBoundingClientRect();
  if (r.width <= 0) return;
  const f = clamp((e.clientX - r.left) / r.width, 0, 1);
  const y = S.time.min + f * (S.time.max - S.time.min);
  S.time.anim = null;
  S.time.y = y >= S.time.max - 0.25 ? S.time.max : y;
  invalidate();
}
elTlTrack.addEventListener('pointerdown', e => {
  if (!S.loaded) return;
  anyInput();
  stopPlay();
  tlDragging = true;
  elTlTrack.setPointerCapture(e.pointerId);
  scrubTo(e);
});
elTlTrack.addEventListener('pointermove', e => { if (tlDragging) scrubTo(e); });
function endTlDrag() {
  if (!tlDragging) return;
  tlDragging = false;
  /* detent — settle on the whole year, dead-beat */
  if (S.time.y < S.time.max - 1e-6) setTimeYear(Math.round(S.time.y), { dur: 140, ease: easeBeat });
}
elTlTrack.addEventListener('pointerup', endTlDrag);
elTlTrack.addEventListener('pointercancel', endTlDrag);
elTlTrack.addEventListener('keydown', e => {
  if (!S.loaded) return;
  /* chrome hidden by mode (descent/export/morph) must not keep keyboard
     operability — an invisible slider scrubbing the century is a lie */
  if (S.mode !== 'sky' || S.morph || S.exportMode) return;
  const T = S.time;
  const cur = Math.round(T.anim ? T.anim.to : T.playing ? timeYear(performance.now()) : T.y);
  let y = null;
  switch (e.key) {
    case 'ArrowLeft': case 'ArrowDown': y = cur - (e.shiftKey ? 10 : 1); break;
    case 'ArrowRight': case 'ArrowUp': y = cur + (e.shiftKey ? 10 : 1); break;
    case 'Home': y = T.min; break;
    case 'End': y = T.max; break;
    /* handled keys stop propagation, so the window's idle listeners never
       see them — anyInput() here, mirroring the pointerdown path, or a user
       scrubbing by keyboard gets the observatory dropped on their controls */
    case ' ': e.preventDefault(); e.stopPropagation(); anyInput(); togglePlay(); return;
    default: return;
  }
  e.preventDefault();
  e.stopPropagation();
  anyInput();
  stopPlay();
  setTimeYear(y, { dur: 140, ease: easeBeat });
});
elTlPlay.addEventListener('click', () => { anyInput(); togglePlay(); });
elTlNow.addEventListener('click', () => { anyInput(); returnToPresent(); });

/* ======================================================================
   9c · THE LENS — attribute lenses on the field
   Not a filter form: a lens. Matching watches hold full magnitude; the
   rest recede with the selection dim. The sky never empties — it focuses.
   OR within a group, AND across groups. Esc clears; counts stay honest.
   ====================================================================== */

const LENS_GROUPS = [
  { key: 'price', label: 'PRICE' },
  { key: 'era', label: 'YEAR' },
  { key: 'dial', label: 'DIAL' },
  { key: 'movement', label: 'MOVEMENT' },
  { key: 'size', label: 'CASE SIZE' },
  { key: 'material', label: 'CASE MATERIAL' },
  { key: 'origin', label: 'ORIGIN' },
];
const LENS_CHIPS = {
  dial: [['black', 'Black', '#14171b'], ['blue', 'Blue', '#2c4f7d'], ['green', 'Green', '#2e5a44'],
         ['warm', 'Orange & red', '#c2632e'], ['light', 'White & silver', '#c9ced4']],
  movement: [['automatic', 'Automatic'], ['manual', 'Hand-wound'], ['quartz', 'Quartz'],
             ['digital', 'Digital']],
  size: [['s1', '≤ 38 mm'], ['s39', '39 mm'], ['s40', '40 mm'], ['s41', '41 mm'], ['s42', '42 mm'], ['s3', '43 mm +']],
  material: [['steel', 'Stainless steel'], ['titanium', 'Titanium'], ['bronze', 'Bronze'], ['ceramic', 'Ceramic']],
  origin: [['CH', 'Switzerland'], ['DE', 'Germany'], ['JP', 'Japan'], ['FR', 'France'],
           ['GB', 'United Kingdom'], ['US', 'United States'], ['RU', 'Russia'], ['IT', 'Italy']],
  /* Year as ERA — the meaningful axis for a curated field is the decade, not the
     exact year; matches the Lens's chip grammar (not a 90-row checkbox wall) */
  era: [['pre', 'Pre-1950'], ['1950', '1950s'], ['1960', '1960s'],
        ['1970', '1970s'], ['1980', '1980s'], ['1990', '1990s'], ['2000', '2000s'],
        ['2010', '2010s'], ['2020', '2020s']],
};
const SET_KEYS = ['era', 'dial', 'movement', 'size', 'material', 'origin'];
const lensSel = { era: new Set(), dial: new Set(), movement: new Set(), size: new Set(), material: new Set(), origin: new Set() };
/* price is a continuous range on a log scale — min/max = data domain, lo/hi = handles */
const lensPrice = { min: 100, max: 1000000, lo: 100, hi: 1000000 };
let lensGhost = null;             /* outgoing selection, so the release fades rather than pops */
let lensAnim = { v: 0, from: 0, to: 0, t0: 0 };
let lensOpen = false;
const lensChipMeta = {};

function priceEngaged() {
  return lensPrice.lo > lensPrice.min + 0.5 || lensPrice.hi < lensPrice.max - 0.5;
}
function lensActive() {
  return priceEngaged() || SET_KEYS.some(k => lensSel[k].size > 0);
}
function lensSnapshot() {
  const s = { plo: priceEngaged() ? lensPrice.lo : null, phi: lensPrice.hi };
  for (const k of SET_KEYS) s[k] = new Set(lensSel[k]);
  return s;
}
function lensMatch(w, snap) {
  if (snap) {
    if (snap.plo != null && (w._price < snap.plo || w._price > snap.phi)) return false;
    for (const k of SET_KEYS) {
      const s = snap[k];
      if (s.size && !s.has((w._lens || {})[k])) return false;
    }
    return true;
  }
  if (priceEngaged() && (w._price < lensPrice.lo || w._price > lensPrice.hi)) return false;
  for (const k of SET_KEYS) {
    const s = lensSel[k];
    if (s.size && !s.has((w._lens || {})[k])) return false;
  }
  return true;
}
function lensProgress(now) {
  const p = clamp((now - lensAnim.t0) / 400, 0, 1);
  lensAnim.v = lerp(lensAnim.from, lensAnim.to, REDUCED ? 1 : easeOut(p));
  return lensAnim.v;
}
function lensFactorOf(w, now) {
  const p = lensProgress(now);
  if (p <= 0.001) return 1;
  const ghost = lensAnim.to === 0 && lensGhost ? lensGhost : null;
  return lensMatch(w, ghost) ? 1 : lerp(1, DIM_FIELD, p);
}
function lensSigStr() {
  return SET_KEYS.map(k => [...lensSel[k]].sort().join(',')).join('|') +
    '|' + Math.round(lensPrice.lo) + '-' + Math.round(lensPrice.hi);
}
function lensCount() {
  let n = 0;
  for (const w of S.watches) if (lensMatch(w, null)) n++;
  return n;
}
function fmtShortUsd(v) {
  if (v >= 1e6) return '$' + (Math.round(v / 1e5) / 10).toString().replace(/\.0$/, '') + 'M';
  if (v >= 1000) return '$' + (Math.round(v / 100) / 10).toString().replace(/\.0$/, '') + 'k';
  return '$' + Math.round(v);
}
function lensSummaryText() {
  const parts = [];
  if (priceEngaged()) {
    const atMin = lensPrice.lo <= lensPrice.min + 0.5;
    const atMax = lensPrice.hi >= lensPrice.max - 0.5;
    parts.push(atMin ? `Under ${fmtShortUsd(lensPrice.hi)}`
      : atMax ? `${fmtShortUsd(lensPrice.lo)} +`
      : `${fmtShortUsd(lensPrice.lo)}–${fmtShortUsd(lensPrice.hi)}`);
  }
  for (const k of SET_KEYS) {
    for (const v of lensSel[k]) parts.push(lensChipMeta[k + ':' + v] || v);
  }
  return parts.slice(0, 3).join(' · ') + (parts.length > 3 ? ' · …' : '');
}
function lensRetarget() {
  const now = performance.now();
  lensAnim = { v: lensAnim.v, from: lensProgress(now), to: lensActive() ? 1 : 0, t0: now };
  if (lensActive()) lensGhost = null;
  lastTlYear = null;              /* force the footer/cartouche to re-read */
  updateLensChrome();
  /* in the Descent the Lens NARROWS: rebuild the view and reflow. In the sky it
     dims (lensAnim above). Never mid-morph — the census flies whole. */
  if (S.mode === 'descent' && !S.morph) applyDescentNarrow(true);
  invalidate();
}
function updateLensChrome() {
  const n = SET_KEYS.reduce((a, k) => a + lensSel[k].size, 0) + (priceEngaged() ? 1 : 0);
  elLensChip.classList.toggle('active', n > 0);
  /* the gleam — a lume count badge on the filter button; Feedback (HIG): how
     many lenses are engaged, legible without opening the panel */
  const badge = elLensChip.querySelector('.lens-count');
  if (badge) {
    if (n > 0 && badge.textContent !== String(n)) {
      badge.textContent = String(n);
      badge.classList.remove('gleam');
      void badge.offsetWidth;                     /* reflow — re-arm the gleam pulse */
      badge.classList.add('gleam');
    } else if (n === 0) {
      badge.textContent = '';
    }
  }
  elLensChip.classList.toggle('has-count', n > 0);
  elLensChip.setAttribute('aria-label', n > 0 ? `Filter the field — ${n} active` : 'Filter the field');
  elLensClear.hidden = n === 0;
}
function lensToggle(groupKey, value, btn) {
  const before = lensSnapshot();
  const wasActive = lensActive();
  const s = lensSel[groupKey];
  if (s.has(value)) s.delete(value); else s.add(value);
  btn.classList.toggle('on', s.has(value));
  btn.setAttribute('aria-pressed', s.has(value) ? 'true' : 'false');
  if (!lensActive() && wasActive) lensGhost = before;   /* fade out what was, not what is */
  lensRetarget();
  elLive.textContent = lensActive()
    ? `Lens: ${lensCount()} of ${S.watches.length} watches.` : 'Lens cleared.';
}
function lensClear() {
  if (!lensActive()) return;
  lensGhost = lensSnapshot();
  for (const k of SET_KEYS) lensSel[k].clear();
  lensPrice.lo = lensPrice.min;
  lensPrice.hi = lensPrice.max;
  for (const b of elLensGroups.querySelectorAll('.lens-opt.on')) {
    b.classList.remove('on');
    b.setAttribute('aria-pressed', 'false');
  }
  syncPriceUI(false);
  lensRetarget();
  elLive.textContent = 'Lens cleared.';
}

/* --- the price range — log-scale dual slider + typed fields ------------ */

let lpEls = null;                 /* {hist, track, fill, lo, hi, fMin, fMax} */
let lpBuckets = null;
const LP_BUCKETS = 36;

const priceToT = p => (Math.log(p) - Math.log(lensPrice.min)) / (Math.log(lensPrice.max) - Math.log(lensPrice.min));
const tToPrice = t => Math.exp(lerp(Math.log(lensPrice.min), Math.log(lensPrice.max), clamp(t, 0, 1)));
function snapPrice(v) {
  if (!isFinite(v)) return lensPrice.min;
  const step = v < 1000 ? 50 : v < 10000 ? 100 : v < 100000 ? 1000 : 5000;
  return clamp(Math.round(v / step) * step, lensPrice.min, lensPrice.max);
}
function fmtUsd(v) { return '$' + fmtNum(Math.round(v)); }

function setPriceRange(lo, hi, announce) {
  const before = lensSnapshot();
  const wasActive = lensActive();
  lo = snapPrice(lo); hi = snapPrice(hi);
  if (lo > hi) { const t = lo; lo = hi; hi = t; }
  lensPrice.lo = lo;
  lensPrice.hi = hi;
  if (!lensActive() && wasActive) lensGhost = before;
  syncPriceUI(true);
  lensRetarget();
  if (announce) {
    elLive.textContent = priceEngaged()
      ? `Price ${fmtUsd(lensPrice.lo)} to ${fmtUsd(lensPrice.hi)} — ${lensCount()} of ${S.watches.length} watches.`
      : 'Price range cleared.';
  }
}

function syncPriceUI(fromInteraction) {
  if (!lpEls) return;
  const tLo = priceToT(lensPrice.lo), tHi = priceToT(lensPrice.hi);
  lpEls.lo.style.left = (tLo * 100) + '%';
  lpEls.hi.style.left = (tHi * 100) + '%';
  lpEls.fill.style.left = (tLo * 100) + '%';
  lpEls.fill.style.width = ((tHi - tLo) * 100) + '%';
  /* fields hold the live value unless the user is mid-typing in them */
  if (document.activeElement !== lpEls.fMin || !fromInteraction) lpEls.fMin.value = fmtUsd(lensPrice.lo);
  if (document.activeElement !== lpEls.fMax || !fromInteraction) lpEls.fMax.value = fmtUsd(lensPrice.hi);
  for (const [el, v, label] of [[lpEls.lo, lensPrice.lo, 'Minimum price'], [lpEls.hi, lensPrice.hi, 'Maximum price']]) {
    el.setAttribute('aria-valuemin', String(lensPrice.min));
    el.setAttribute('aria-valuemax', String(lensPrice.max));
    el.setAttribute('aria-valuenow', String(Math.round(v)));
    el.setAttribute('aria-valuetext', fmtUsd(v));
    el.setAttribute('aria-label', label);
  }
  drawPriceHist();
}

function drawPriceHist() {
  if (!lpEls || !lpBuckets) return;
  const cnv = lpEls.hist;
  const cw = cnv.clientWidth, ch = cnv.clientHeight || 28;
  if (cw <= 0) return;
  cnv.width = Math.max(1, Math.round(cw * dpr));
  cnv.height = Math.max(1, Math.round(ch * dpr));
  const g = cnv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const maxN = Math.max(...lpBuckets, 1);
  const bw = cw / LP_BUCKETS;
  const tLo = priceToT(lensPrice.lo), tHi = priceToT(lensPrice.hi);
  for (let i = 0; i < LP_BUCKETS; i++) {
    const n = lpBuckets[i];
    if (!n) continue;
    const tc = (i + 0.5) / LP_BUCKETS;
    const inRange = tc >= tLo - 1e-6 && tc <= tHi + 1e-6;
    const h = Math.max(2, Math.sqrt(n / maxN) * (ch - 4));
    g.fillStyle = inRange ? 'rgba(233,237,242,0.30)' : 'rgba(233,237,242,0.09)';
    g.fillRect(i * bw + 0.5, ch - h, Math.max(1, bw - 1), h);
  }
}

function parsePriceField(el, isMin) {
  const digits = (el.value.match(/[0-9]/g) || []).join('');
  const v = digits ? Number(digits) : (isMin ? lensPrice.min : lensPrice.max);
  if (isMin) setPriceRange(Math.min(v, lensPrice.hi), lensPrice.hi, true);
  else setPriceRange(lensPrice.lo, Math.max(v, lensPrice.lo), true);
}
function nice125(v, up) {
  const e = Math.pow(10, Math.floor(Math.log10(Math.max(v, 1))));
  const m = v / e;
  if (up) { for (const g of [1, 2, 5, 10]) if (m <= g + 1e-9) return g * e; return 10 * e; }
  for (const g of [10, 5, 2, 1]) if (m >= g - 1e-9) return g * e;
  return e;
}

function buildLens() {
  /* price domain + histogram buckets from the data */
  const prices = S.watches.map(w => w._price).filter(p => isFinite(p) && p > 0);
  lensPrice.min = nice125(Math.min(...prices), false);
  lensPrice.max = nice125(Math.max(...prices), true);
  lensPrice.lo = lensPrice.min;
  lensPrice.hi = lensPrice.max;
  lpBuckets = new Array(LP_BUCKETS).fill(0);
  for (const p of prices) {
    const i = clamp(Math.floor(priceToT(p) * LP_BUCKETS), 0, LP_BUCKETS - 1);
    lpBuckets[i]++;
  }

  elLensGroups.innerHTML = '';

  /* PRICE — histogram, log dual slider, typed fields */
  const psec = document.createElement('div');
  psec.className = 'lens-group';
  psec.innerHTML =
    `<p class="lens-label">PRICE</p>
     <div id="lens-price">
       <canvas id="lp-hist" aria-hidden="true"></canvas>
       <div id="lp-track">
         <div id="lp-fill"></div>
         <div class="lp-thumb" id="lp-lo" role="slider" tabindex="0"></div>
         <div class="lp-thumb" id="lp-hi" role="slider" tabindex="0"></div>
       </div>
       <div id="lp-fields">
         <input id="lp-min" type="text" inputmode="numeric" autocomplete="off" spellcheck="false" aria-label="Minimum price">
         <span class="lp-dash" aria-hidden="true">–</span>
         <input id="lp-max" type="text" inputmode="numeric" autocomplete="off" spellcheck="false" aria-label="Maximum price">
       </div>
     </div>`;
  elLensGroups.appendChild(psec);
  lpEls = {
    hist: psec.querySelector('#lp-hist'),
    track: psec.querySelector('#lp-track'),
    fill: psec.querySelector('#lp-fill'),
    lo: psec.querySelector('#lp-lo'),
    hi: psec.querySelector('#lp-hi'),
    fMin: psec.querySelector('#lp-min'),
    fMax: psec.querySelector('#lp-max'),
  };

  /* drag — nearest thumb takes the pointer; membership updates live */
  let lpDrag = null;   /* {side, ghost} */
  const trackT = e => {
    const r = lpEls.track.getBoundingClientRect();
    return r.width > 0 ? clamp((e.clientX - r.left) / r.width, 0, 1) : 0;
  };
  lpEls.track.addEventListener('pointerdown', e => {
    anyInput();
    const t = trackT(e);
    const dLo = Math.abs(t - priceToT(lensPrice.lo));
    const dHi = Math.abs(t - priceToT(lensPrice.hi));
    lpDrag = { side: dLo <= dHi ? 'lo' : 'hi', ghost: lensSnapshot() };
    lpEls.track.setPointerCapture(e.pointerId);
    lpApply(t);
    e.preventDefault();
  });
  lpEls.track.addEventListener('pointermove', e => { if (lpDrag) lpApply(trackT(e)); });
  const lpEnd = () => {
    if (!lpDrag) return;
    const wasEngagedGhost = lpDrag.ghost;
    lpDrag = null;
    if (!lensActive() && (wasEngagedGhost.plo != null || SET_KEYS.some(k => wasEngagedGhost[k].size))) {
      lensGhost = wasEngagedGhost;
      lensRetarget();
    }
    elLive.textContent = priceEngaged()
      ? `Price ${fmtUsd(lensPrice.lo)} to ${fmtUsd(lensPrice.hi)} — ${lensCount()} of ${S.watches.length} watches.`
      : 'Price range cleared.';
  };
  lpEls.track.addEventListener('pointerup', lpEnd);
  lpEls.track.addEventListener('pointercancel', lpEnd);
  function lpApply(t) {
    const v = snapPrice(tToPrice(t));
    if (lpDrag.side === 'lo') lensPrice.lo = Math.min(v, lensPrice.hi);
    else lensPrice.hi = Math.max(v, lensPrice.lo);
    /* dragging back to full range releases through the ghost, never a pop */
    if (!lensActive()) lensGhost = lpDrag.ghost;
    syncPriceUI(true);
    lensRetarget();
  }

  /* thumb keyboard — log-space steps */
  for (const side of ['lo', 'hi']) {
    lpEls[side].addEventListener('keydown', e => {
      let dt = 0;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') dt = -(e.shiftKey ? 0.08 : 0.02);
      else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') dt = e.shiftKey ? 0.08 : 0.02;
      else if (e.key === 'Home') dt = -2;
      else if (e.key === 'End') dt = 2;
      else return;
      e.preventDefault();
      e.stopPropagation();
      anyInput();   /* stopPropagation blinds the window idle listeners */
      const cur = priceToT(side === 'lo' ? lensPrice.lo : lensPrice.hi);
      const v = snapPrice(tToPrice(clamp(cur + dt, 0, 1)));
      if (side === 'lo') setPriceRange(Math.min(v, lensPrice.hi), lensPrice.hi, true);
      else setPriceRange(lensPrice.lo, Math.max(v, lensPrice.lo), true);
    });
  }

  lpEls.fMin.addEventListener('change', () => parsePriceField(lpEls.fMin, true));
  lpEls.fMax.addEventListener('change', () => parsePriceField(lpEls.fMax, false));
  for (const f of [lpEls.fMin, lpEls.fMax]) {
    f.addEventListener('keydown', e => {
      /* only the handled key stops propagation — typing must still reach the
         window listeners (⌘K while in a price field, idle-timer resets);
         the global handler's inInput guard already keeps single-letter
         shortcuts from firing out of a text field */
      if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); anyInput(); f.blur(); }
    });
  }
  syncPriceUI(false);

  /* the chip groups */
  const counts = {};
  for (const w of S.watches) {
    for (const k of SET_KEYS) {
      const v = (w._lens || {})[k];
      if (v) counts[k + ':' + v] = (counts[k + ':' + v] || 0) + 1;
    }
  }
  for (const g of LENS_GROUPS) {
    if (g.key === 'price') continue;
    const items = LENS_CHIPS[g.key].filter(([v]) => counts[g.key + ':' + v]);
    if (!items.length) continue;
    const sec = document.createElement('div');
    sec.className = 'lens-group';
    const h = document.createElement('p');
    h.className = 'lens-label';
    h.textContent = g.label;
    sec.appendChild(h);
    const row = document.createElement('div');
    row.className = 'lens-row';
    for (const [v, label, swatch] of items) {
      lensChipMeta[g.key + ':' + v] = label;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'lens-opt';
      b.setAttribute('aria-pressed', 'false');
      if (swatch) {
        const dot = document.createElement('i');
        dot.style.background = swatch;
        b.appendChild(dot);
      }
      b.appendChild(document.createTextNode(label));
      b.addEventListener('click', () => lensToggle(g.key, v, b));
      row.appendChild(b);
    }
    sec.appendChild(row);
    elLensGroups.appendChild(sec);
  }
}
function openLensPanel() {
  if (lensOpen || !S.loaded) return;
  lensOpen = true;
  elLensPanel.hidden = false;
  elLensChip.setAttribute('aria-expanded', 'true');
  requestAnimationFrame(() => {
    elLensPanel.classList.add('on');
    syncPriceUI(false);   /* histogram canvas has real width only once visible */
  });
  if (lpEls) lpEls.lo.focus({ preventScroll: true });
}
function closeLensPanel() {
  if (!lensOpen) return;
  lensOpen = false;
  elLensPanel.classList.remove('on');
  elLensChip.setAttribute('aria-expanded', 'false');
  setTimeout(() => { elLensPanel.hidden = true; }, REDUCED ? 90 : 250);
  if (elLensPanel.contains(document.activeElement)) elLensChip.focus({ preventScroll: true });
  updateNoMatch();   /* if the filters left the field empty, surface the empty-state now */
}
elLensChip.addEventListener('click', () => {
  /* the Lens is persistent across sky and descent — only a flight or export locks it */
  if (S.morph || S.exportMode) return;
  anyInput(); lensOpen ? closeLensPanel() : openLensPanel();
});
elLensClear.addEventListener('click', () => { anyInput(); lensClear(); });
document.addEventListener('pointerdown', e => {
  if (!lensOpen) return;
  if (elLensPanel.contains(e.target) || elLensChip.contains(e.target)) return;
  closeLensPanel();
}, true);

/* ======================================================================
   10 · HOVER
   ====================================================================== */

function hoverProgress(id, now) {
  const a = S.hoverAnims.get(id);
  if (!a) return id === S.hoverId ? 1 : 0;
  const p = clamp((now - a.t0) / a.dur, 0, 1);
  const v = lerp(a.from, a.to, easeOut(p));
  if (p >= 1 && a.to === 0) S.hoverAnims.delete(id);
  return v;
}
function setHover(id, viaCanvas) {
  if (id === S.hoverId) return;
  const now = performance.now();
  if (S.hoverId != null) {
    S.hoverAnims.set(S.hoverId, { from: hoverProgress(S.hoverId, now), to: 0, t0: now, dur: 220 });
  }
  if (id != null) {
    S.hoverAnims.set(id, { from: hoverProgress(id, now), to: 1, t0: now, dur: 160 });
  }
  S.hoverId = id;
  canvas.classList.toggle('pointing', id != null || S.famHoverId != null);
  /* the preview follows only map hover — panel-card hover already tells its story */
  if (viaCanvas && id != null) queueWatchPreview(id);
  else hideWatchPreview();
  invalidate();
}

/* family-label hover — the setHover pattern, 160ms in / 220ms out */
function famHoverProgress(id, now) {
  const a = S.famHoverAnims.get(id);
  if (!a) return id === S.famHoverId ? 1 : 0;
  const p = clamp((now - a.t0) / a.dur, 0, 1);
  const v = lerp(a.from, a.to, REDUCED ? p : easeOut(p));
  if (p >= 1 && a.to === 0) S.famHoverAnims.delete(id);
  return v;
}
function setFamHover(id) {
  if (id === S.famHoverId) return;
  const now = performance.now();
  if (S.famHoverId != null) {
    S.famHoverAnims.set(S.famHoverId, { from: famHoverProgress(S.famHoverId, now), to: 0, t0: now, dur: REDUCED ? 80 : 220 });
  }
  if (id != null) {
    S.famHoverAnims.set(id, { from: famHoverProgress(id, now), to: 1, t0: now, dur: REDUCED ? 80 : 160 });
  }
  S.famHoverId = id;
  canvas.classList.toggle('pointing', S.hoverId != null || id != null);
  if (id != null) queueFamPreview(id);
  else hideFamPreview();
  invalidate();
}

/* the open family's label is held bright — driven through the same 160/220ms
   vocabulary as hover so opening via search (label unhovered) never snaps,
   and closing the index never pops the label back to text-3 */
const famActiveAnims = new Map();   /* famId -> {from, to, t0, dur} */
function famActiveProgress(id, now) {
  const a = famActiveAnims.get(id);
  if (!a) return (S.familyView && S.familyView.id === id) ? 1 : 0;
  const p = clamp((now - a.t0) / a.dur, 0, 1);
  const v = lerp(a.from, a.to, REDUCED ? p : easeOut(p));
  if (p >= 1 && a.to === 0) famActiveAnims.delete(id);
  return v;
}
function holdFamActive(id) {
  const now = performance.now();
  famActiveAnims.set(id, {
    from: Math.max(famActiveProgress(id, now), famHoverProgress(id, now)),
    to: 1, t0: now, dur: REDUCED ? 80 : 160
  });
}
/* call BEFORE S.familyView is dropped or retargeted, wherever that happens */
function releaseFamActive() {
  if (!S.familyView) return;
  const now = performance.now();
  const id = S.familyView.id;
  famActiveAnims.set(id, { from: famActiveProgress(id, now), to: 0, t0: now, dur: REDUCED ? 80 : 220 });
}

function hitTest(sx, sy) {
  if (!S.loaded || S.morph) return null;
  /* descent: the front-most card under the point — rects are pushed rear→front
     by drawDescent (depth > 0.15 only), so the last containing rect wins */
  if (S.mode === 'descent') {
    for (let k = DS.rects.length - 1; k >= 0; k--) {
      const r = DS.rects[k];
      if (sx >= r.x && sx <= r.x + r.w && sy >= r.y && sy <= r.y + r.h) return S.byId.get(r.id);
    }
    return null;
  }
  let best = null, bd = Infinity;
  for (const w of S.watches) {
    /* the unborn cannot be pointed at */
    if (curTY < S.time.max - 1e-6 && bornAlphaOf(w, curTY) < 0.5) continue;
    const [x, y] = toScreen(w.x, w.y);
    if (x < -20 || x > W + 20 || y < -20 || y > H + 20) continue;
    const d = Math.hypot(x - sx, y - sy);
    /* hit geometry must agree with rendered geometry — selection-enlarged
       lineage glyphs included (glyphRadiusFor handles that case) */
    const pad = Math.max(S.cam.z < TIER_2 ? 8 : 12, glyphRadiusFor(w) + 4);
    if (d < pad && d < bd) { bd = d; best = w; }
  }
  return best;
}

/* life-ladder hit test — the engraved marks are doors to their stories (§18e) */
function annHitTest(sx, sy) {
  if (!S.loaded || S.morph || S.mode !== 'descent') return null;
  for (let i = 0; i < DS.annRectN; i++) {
    const r = dAnnPool[i];
    if (sx >= r.x && sx <= r.x + r.w && sy >= r.y && sy <= r.y + r.h) return r;
  }
  return null;
}

/* family-label hit test — winning pass-4 rects only; a culled label is not a door */
function famHitTest(sx, sy) {
  if (!S.loaded || S.morph || S.mode !== 'sky') return null;   /* families are a sky concept */
  /* visibility gate — must mirror the paint gate exactly */
  if (tierAlphas(S.cam.z).fam * revealFamAlpha(performance.now()) <= 0.01) return null;
  for (const r of S.famLabelRects) {
    /* a family mid-birth or unborn cannot be pointed at (same 0.5 rule as watches) */
    if (r.fA < 0.5) continue;
    if (sx >= r.x && sx <= r.x + r.w && sy >= r.y && sy <= r.y + r.h) return r;
  }
  return null;
}

/* ======================================================================
   10b · FAMILY PREVIEW — hover card with media carousel
   Pure preview: pointer-events none, aria-hidden. The label remains the
   control; the family index remains the accessible content. Photographs
   where they exist; the five most influential members, drawn, where none do.
   ====================================================================== */

let fpShowTimer = null, fpHideTimer = null, fpCycleTimer = null;

function familyMedia(famId) {
  /* rows demand uniformity: when the family has ≥2 catalog renders, the row
     is catalog-only — one visual language per surface, never a mixed shelf */
  const members = S.watches.filter(w => w.designFamily === famId);
  const lead = FAMILY_FLAGSHIP[famId];
  const cats = members.filter(w => CATALOG[w.id] && CATALOG[w.id].file)
    .sort((a, b) => (b.id === lead) - (a.id === lead) || b._desc - a._desc);
  if (cats.length >= 2) {
    return cats.slice(0, 5).map(w => ({ w, ...CATALOG[w.id], isCatalog: true }));
  }
  const eds = members.filter(w => IMAGES[w.id] && IMAGES[w.id].file && frontalOk(IMAGES[w.id]));
  eds.sort((a, b) => {
    const ca = IMAGES[a.id].confidence === 'high' ? 0 : 1;
    const cb = IMAGES[b.id].confidence === 'high' ? 0 : 1;
    return (b.id === lead) - (a.id === lead) || ca - cb || b._desc - a._desc;
  });
  const out = eds.slice(0, 5).map(w => ({ w, ...IMAGES[w.id], isCatalog: false }));
  if (!out.length && cats.length) out.push({ w: cats[0], ...CATALOG[cats[0].id], isCatalog: true });
  return out;
}

function drawFamilyStrip(cnv, famId) {
  const members = S.watches.filter(w => w.designFamily === famId)
    .sort((a, b) => b._desc - a._desc).slice(0, 5);
  if (!members.length) return;
  const cw = cnv.clientWidth || 224, ch = cnv.clientHeight || 96;
  cnv.width = Math.max(1, Math.round(cw * dpr));
  cnv.height = Math.max(1, Math.round(ch * dpr));
  const g = cnv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const now = performance.now();
  const D = Math.min(44, ch - 32);
  const step = cw / members.length;
  /* frozen like the cards — a plate entry, not a live instrument */
  members.forEach((w, i) => drawGlyph(g, w, step * (i + 0.5), ch / 2, D, 0, now));
}

function fpStopCycle() { clearInterval(fpCycleTimer); fpCycleTimer = null; }

/* the hover carousel is the strictest surface: catalog renders only, or the
   drawn strip — editorial photography never rides here (mixed slides in
   sequence is where inconsistency reads worst) */
function catalogMedia(famId) {
  const lead = FAMILY_FLAGSHIP[famId];
  return S.watches
    .filter(w => w.designFamily === famId && CATALOG[w.id] && CATALOG[w.id].file)
    .sort((a, b) => (b.id === lead) - (a.id === lead) || b._desc - a._desc)
    .slice(0, 5)
    .map(w => ({ w, ...CATALOG[w.id], isCatalog: true }));
}

function fpPopulate(famId) {
  const fam = S.families.find(f => f.id === famId);
  const members = S.watches.filter(w => w.designFamily === famId);
  const years = members.map(w => w.year).filter(y => isFinite(y));
  const media = catalogMedia(famId);
  elFpOverline.textContent = years.length
    ? `${members.length} WATCHES · ${Math.min(...years)}—${Math.max(...years)}`
    : `${members.length} WATCHES`;
  elFpName.textContent = (fam && fam.label) || familyLabel(famId);
  elFpLine.textContent = FAMILY_CHARACTER[famId] || '';
  fpStopCycle();
  elFpMedia.innerHTML = '';
  elFpMedia.classList.toggle('fp-drawn', media.length === 0);
  if (media.length === 0) {
    const cnv = document.createElement('canvas');
    cnv.setAttribute('aria-hidden', 'true');
    elFpMedia.appendChild(cnv);
    requestAnimationFrame(() => drawFamilyStrip(cnv, famId));
    return;
  }
  media.forEach((m, i) => {
    const img = document.createElement('img');
    img.className = 'fp-slide' + (i === 0 ? ' on' : '');
    img.src = './data/' + m.file;
    img.alt = '';
    img.addEventListener('error', () => img.remove());
    elFpMedia.appendChild(img);
  });
  if (media.length > 1) {
    const dots = document.createElement('div');
    dots.id = 'fp-dots';
    media.forEach((_, i) => {
      const d = document.createElement('i');
      if (i === 0) d.className = 'on';
      dots.appendChild(d);
    });
    elFpMedia.appendChild(dots);
    if (!REDUCED) {
      let idx = 0;
      fpCycleTimer = setInterval(() => {
        const slides = elFpMedia.querySelectorAll('img.fp-slide');
        const dotEls = elFpMedia.querySelectorAll('#fp-dots i');
        if (slides.length < 2) { fpStopCycle(); return; }
        idx = (idx + 1) % slides.length;
        slides.forEach((s, i) => s.classList.toggle('on', i === idx));
        dotEls.forEach((d, i) => d.classList.toggle('on', i === idx));
      }, 1800);
    }
  }
}

function fpPosition(famId) {
  const r = S.famLabelRects.find(x => x.id === famId);
  if (!r) return false;
  elFamPreview.style.visibility = 'hidden';
  elFamPreview.hidden = false;
  const cw = elFamPreview.offsetWidth, chh = elFamPreview.offsetHeight;
  let px = clamp(r.x + r.w / 2 - cw / 2, 16, W - cw - 16);
  let py = r.y - chh - 14;                 /* above the label, else below */
  if (py < 16) py = r.y + r.h + 14;
  py = clamp(py, 16, H - chh - 16);
  elFamPreview.style.left = px + 'px';
  elFamPreview.style.top = py + 'px';
  elFamPreview.style.visibility = '';
  return true;
}

function queueFamPreview(famId) {
  clearTimeout(fpShowTimer);
  /* the open family's preview is redundant — its index is already on screen */
  if (S.familyView && S.familyView.id === famId && !elPanel.hidden) return;
  if (S.exportMode || body.classList.contains('observatory')) return;
  fpShowTimer = setTimeout(() => {
    if (S.famHoverId !== famId) return;
    clearTimeout(fpHideTimer);
    fpPopulate(famId);
    if (!fpPosition(famId)) { elFamPreview.hidden = true; return; }
    requestAnimationFrame(() => elFamPreview.classList.add('on'));
  }, REDUCED ? 80 : 220);
}

function hideFamPreview() {
  clearTimeout(fpShowTimer);
  fpShowTimer = null;
  fpStopCycle();
  if (elFamPreview.hidden) return;
  elFamPreview.classList.remove('on');
  clearTimeout(fpHideTimer);
  fpHideTimer = setTimeout(() => {
    elFamPreview.hidden = true;
    elFpMedia.innerHTML = '';
  }, REDUCED ? 90 : 250);
}

/* ======================================================================
   10c · WATCH PREVIEW — every star answers hover the same way
   Same contract as the family card: pointer-events none, aria-hidden.
   Media rule matches the carousels: catalog render, else editorial,
   else the drawn glyph — never an empty state.
   ====================================================================== */

const elWatchPreview = $('watch-preview'), elWpMedia = $('wp-media'),
      elWpOverline = $('wp-overline'), elWpName = $('wp-name'), elWpMeta = $('wp-meta');
let wpShowTimer = null, wpHideTimer = null;

function wpGlyphFallback(w) {
  const cnv = document.createElement('canvas');
  cnv.setAttribute('aria-hidden', 'true');
  elWpMedia.appendChild(cnv);
  requestAnimationFrame(() => {
    const cw = cnv.clientWidth || 208, ch = cnv.clientHeight || 120;
    cnv.width = Math.max(1, Math.round(cw * dpr));
    cnv.height = Math.max(1, Math.round(ch * dpr));
    const g = cnv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawGlyph(g, w, cw / 2, ch / 2, 72, 0, performance.now());
  });
}

function queueWatchPreview(id) {
  clearTimeout(wpShowTimer);
  if (S.selection && S.selection.id === id) return;   /* the panel already tells this story */
  if (S.exportMode || S.morph || body.classList.contains('observatory')) return;
  wpShowTimer = setTimeout(() => {
    if (S.hoverId !== id || S.dragging) return;
    const w = S.byId.get(id);
    if (!w) return;
    clearTimeout(wpHideTimer);
    elWpMedia.innerHTML = '';
    /* card surfaces render the plated specimen layer only — never raw editorial
       (a lifestyle/auction shot on stone or wrist can't be knocked out and
       breaks the one-material rule; the glyph plate is the honest fallback) */
    const pick = (CATALOG[id] && CATALOG[id].file) ? CATALOG[id] : null;
    if (pick) {
      const img = document.createElement('img');
      img.src = './data/' + pick.file;
      img.alt = '';
      img.addEventListener('error', () => { img.remove(); wpGlyphFallback(w); });
      elWpMedia.appendChild(img);
    } else {
      wpGlyphFallback(w);
    }
    elWpOverline.textContent = String(w.brand || '').toUpperCase();
    elWpName.textContent = w.model || '';
    const price = Array.isArray(w.priceBandUsd) && w.priceBandUsd.length === 2
      ? `${fmtShortUsd(w.priceBandUsd[0])}–${fmtShortUsd(w.priceBandUsd[1])}` : '';
    elWpMeta.textContent = [w.reference ? `Ref. ${w.reference}` : null, w.year,
      isFinite(w.diameterMm) ? `Ø ${w.diameterMm} mm` : null, price]
      .filter(Boolean).join(' · ');
    /* above the star (or the helix card), clamped; below when cramped —
       one card, one contract, mode decides only the anchor geometry */
    let sx, aTop, aBottom;
    if (S.mode === 'descent') {
      let rect = null;
      for (const r of DS.rects) if (r.id === id) { rect = r; break; }
      if (!rect) return;
      sx = rect.x + rect.w / 2;
      aTop = rect.y; aBottom = rect.y + rect.h;
    } else {
      const [wx, wy] = toScreen(w.x, w.y);
      const r = glyphRadiusFor(w);
      sx = wx; aTop = wy - r; aBottom = wy + r;
    }
    elWatchPreview.style.visibility = 'hidden';
    elWatchPreview.hidden = false;
    const cw = elWatchPreview.offsetWidth, chh = elWatchPreview.offsetHeight;
    const px = clamp(sx - cw / 2, 16, W - cw - 16);
    let py = aTop - chh - 14;
    if (py < 16) py = aBottom + 14;
    py = clamp(py, 16, H - chh - 16);
    elWatchPreview.style.left = px + 'px';
    elWatchPreview.style.top = py + 'px';
    elWatchPreview.style.visibility = '';
    requestAnimationFrame(() => elWatchPreview.classList.add('on'));
  }, REDUCED ? 80 : 220);
}

function hideWatchPreview() {
  clearTimeout(wpShowTimer);
  wpShowTimer = null;
  if (elWatchPreview.hidden) return;
  elWatchPreview.classList.remove('on');
  clearTimeout(wpHideTimer);
  wpHideTimer = setTimeout(() => {
    elWatchPreview.hidden = true;
    elWpMedia.innerHTML = '';
  }, REDUCED ? 90 : 250);
}

/* ======================================================================
   11 · SELECTION + LINEAGE
   ====================================================================== */

function buildLineage(id) {
  /* {a, b, gen, sib, fan, kind} — sib is per-parent (stagger, capped at 4),
     fan is centered per-parent (symmetric sibling spread) */
  const edges = [];
  const related = new Set([id]);
  const ancIds = new Set();

  /* ancestors — BFS up the parents chain, radiating backward in time */
  let frontier = [id], gen = 0;
  const seenUp = new Set([id]);
  while (frontier.length && gen < 24) {
    const next = [];
    for (const nid of frontier) {
      const node = S.byId.get(nid);
      const parents = (node?.parents || []).filter(p => S.byId.has(p));
      parents.forEach((p, i) => {
        edges.push({ a: nid, b: p, gen, sib: Math.min(i, 4), fan: i - (parents.length - 1) / 2, kind: 'anc' });
        if (!seenUp.has(p)) { seenUp.add(p); next.push(p); }
        ancIds.add(p); related.add(p);
      });
    }
    frontier = next; gen++;
  }
  const ancGens = gen;

  /* descendants — BFS down, forward in time (transitive) */
  frontier = [id]; gen = 0;
  const seenDown = new Set([id]);
  while (frontier.length && gen < 24) {
    const next = [];
    for (const nid of frontier) {
      const kids = (S.children.get(nid) || []).filter(c => !seenDown.has(c));
      kids.forEach((c, i) => {
        seenDown.add(c);
        edges.push({ a: nid, b: c, gen: ancGens + gen, sib: Math.min(i, 4), fan: i - (kids.length - 1) / 2, kind: 'desc' });
        related.add(c);
        next.push(c);
      });
    }
    frontier = next; gen++;
  }

  const genSpan = ancGens + gen;
  const panelAnc = [...ancIds].map(i => S.byId.get(i)).sort((a, b) => (a.year || 0) - (b.year || 0));
  const panelDesc = (S.children.get(id) || []).map(i => S.byId.get(i));
  return { edges, related, panelAnc, panelDesc, genSpan };
}

function selectWatch(id, opts = {}) {
  const w = S.byId.get(id) ?? S.byId.get(Number(id));
  if (!w) return;
  id = w.id;
  /* choosing a watch not yet born advances time to its moment */
  if (curTY < S.time.max - 1e-6 && bornAlphaOf(w, curTY) < 1) {
    stopPlay();
    setTimeYear(clamp(w.year || S.time.max, S.time.min, S.time.max), { dur: 700 });
  }
  /* the panel crossfades whether it held a watch or a family index */
  const wasOpen = !!S.selection || (!!S.familyView && !elPanel.hidden);
  /* the field was possibly already dimmed (family view, prior selection,
     mid-release) — read the level BEFORE mutating state, and seed the new
     selection with it so the handoff never flashes the field bright */
  const dimFrom = currentDimT(performance.now());
  /* the chain holds only while the selection came through the family index */
  if (opts.viaChain && S.familyView) S.familyView.chained = true;
  else { releaseFamActive(); S.familyView = null; }
  const lin = buildLineage(id);
  S.releasing = null;
  S.selection = {
    id, ...lin, dimFrom,
    t0: performance.now(),
    /* ring completes (240ms) before curves; stagger capped at 4·80ms per generation */
    animLen: 240 + lin.genSpan * 230 + 320 + 600
  };
  S.panelHoverId = null;
  S.panelHoverAnims.clear();
  /* a hover owned by soon-to-be-removed panel cards (fi-card mouseenter/focus)
     must not outlive them — innerHTML replacement never fires mouseleave/blur.
     Harmless for map clicks: the selection halo takes over from the hover glow. */
  setHover(null);
  showPanel(w, lin, wasOpen);
  announce(w, lin);
  /* in descent the camera is parked — the helix flies instead. Mid-morph
     (panel lineage rows and the search blur window stay reachable) both
     camera and helix belong to the showpiece: defer the travel and decide
     by where the morph actually lands — S.mode still names the OLD mode,
     and a sky camera flight under a descending morph would corrupt the
     surfacing endpoints. */
  if (opts.fly !== false) {
    if (S.morph) morphFlyW = w;
    else if (S.mode === 'descent') descentFlyToWatch(w);
    else flyToWatch(w);
  }
  scheduleURLWrite();
  invalidate();
}

function deselect() {
  if (!S.selection) return;
  morphFlyW = null;   /* a deferred morph-landing flight dies with its selection */
  S.releasing = { edges: S.selection.edges, related: S.selection.related, t0: performance.now() };
  S.selection = null;
  S.panelHoverId = null;
  S.panelHoverAnims.clear();
  hidePanel();
  scheduleURLWrite();
  invalidate();
}

/* ======================================================================
   11b · FAMILY VIEW — a selection of many
   ====================================================================== */

function openFamily(id) {
  const fam = S.families.find(f => f.id === id);
  if (!fam) return;
  hideFamPreview();
  /* re-clicking the open family's label changes nothing — re-fitting the camera
     is the only honest response; no panel re-inject, no t0 reset, no re-announce */
  if (S.familyView && S.familyView.id === id && !S.familyView.chained &&
      !S.selection && !elPanel.hidden && !elPanel.classList.contains('closing')) {
    fitFamily(fam);
    return;
  }
  const memberList = S.watches.filter(w => w.designFamily === id)
    .sort((a, b) => (a.year || 0) - (b.year || 0) || b._desc - a._desc);
  if (!memberList.length) return;
  const members = new Set(memberList.map(w => w.id));
  const years = memberList.map(w => w.year).filter(y => isFinite(y));
  const now = performance.now();
  /* dim continuity across the handoff — read before releasing the selection */
  const dimFrom = currentDimT(now);
  /* a selected watch releases its edges; the family dim takes over on the same frame */
  if (S.selection) {
    S.releasing = { edges: S.selection.edges, related: members, t0: now };
    S.selection = null;
    S.panelHoverId = null;
    S.panelHoverAnims.clear();
  }
  /* switching families: the outgoing label lets go before the incoming holds */
  if (S.familyView && S.familyView.id !== id) releaseFamActive();
  holdFamActive(id);
  S.familyView = {
    id, members, memberList,
    label: fam.label || familyLabel(id),
    minYear: years.length ? Math.min(...years) : S.yearMin,
    maxYear: years.length ? Math.max(...years) : S.yearMax,
    t0: now, dimFrom, chained: false
  };
  showFamilyPanel();
  announceFamily();
  fitFamily(fam);
  invalidate();
}

function closeFamily() {
  if (!S.familyView) return;
  releaseFamActive();
  /* an empty edge list is a no-op in drawLineage — this rides the release-dim path */
  S.releasing = { edges: [], related: S.familyView.members, t0: performance.now() };
  S.familyView = null;
  hidePanel();
  invalidate();
}

/* back from a chained watch detail — no camera move; the user parked it */
function returnToFamily() {
  const fv = S.familyView;
  if (!fv) { deselect(); return; }
  /* dim continuity — the field is already dimmed under the watch selection */
  const dimFrom = currentDimT(performance.now());
  let returnId = null;
  if (S.selection) {
    returnId = S.selection.id;
    S.releasing = { edges: S.selection.edges, related: fv.members, t0: performance.now() };
    S.selection = null;
    S.panelHoverId = null;
    S.panelHoverAnims.clear();
  }
  fv.chained = false;
  fv.dimFrom = dimFrom;
  fv.t0 = performance.now();
  showFamilyPanel(returnId);
  announceFamily();
  invalidate();
}

function announceFamily() {
  const fv = S.familyView;
  if (!fv) return;
  const total = fv.memberList.length;
  if (S.loaded && curTY < S.time.max - 1e-6) {
    const yr = Math.round(curTY);
    const born = fv.memberList.filter(w => (w.year || 0) <= yr).length;
    elLive.textContent = `${fv.label} — ${born} of ${total} watches as of ${yr}, ${fv.minYear} to ${fv.maxYear}.`;
  } else {
    elLive.textContent = `${fv.label} — ${total} watches, ${fv.minYear} to ${fv.maxYear}.`;
  }
}

/* lineage-row hover — brighten that curve over 120ms (same pattern as hoverAnims) */
function panelHotProgress(id, now) {
  const a = S.panelHoverAnims.get(id);
  if (!a) return id === S.panelHoverId ? 1 : 0;
  const p = clamp((now - a.t0) / 120, 0, 1);
  const v = lerp(a.from, a.to, easeOut(p));
  if (p >= 1 && a.to === 0) S.panelHoverAnims.delete(id);
  return v;
}
function setPanelHover(id) {
  id = id != null ? String(id) : null;
  if (id === S.panelHoverId) return;
  const now = performance.now();
  if (S.panelHoverId != null) {
    S.panelHoverAnims.set(S.panelHoverId, { from: panelHotProgress(S.panelHoverId, now), to: 0, t0: now });
  }
  if (id != null) {
    S.panelHoverAnims.set(id, { from: panelHotProgress(id, now), to: 1, t0: now });
  }
  S.panelHoverId = id;
  invalidate();
}

function announce(w, lin) {
  elLive.textContent =
    `${w.brand} ${w.model}, ${w.year}. ${lin.panelAnc.length} ancestors, ${lin.panelDesc.length} descendants.`;
}

/* ======================================================================
   12 · DETAIL PANEL
   ====================================================================== */

function specValue(w, key) {
  const f = w.features || {};
  switch (key) {
    case 'Case': return w.caseShape ? sentence(w.caseShape) : null;
    case 'Diameter': return isFinite(w.diameterMm) ? `${w.diameterMm} mm` : null;
    case 'Bezel': {
      if (!w.bezelType) return null;
      if (w.bezelType === 'none') return 'None';
      const cn = colorName(w.bezelColor);
      return cn ? `${sentence(w.bezelType)} · ${cn}` : sentence(w.bezelType);
    }
    case 'Movement': return w.movement ? sentence(w.movement) : null;
    case 'Water resistance': return isFinite(w.waterResistanceM) ? `${w.waterResistanceM} m` : null;
    case 'Hands': return f.handsStyle ? sentence(f.handsStyle) : null;
    case 'Lume': return f.lumePlots && f.lumePlots !== 'none' ? sentence(f.lumePlots) : null;
    case 'Price today': return Array.isArray(w.priceBandUsd) && w.priceBandUsd.length === 2
      ? `$${fmtNum(w.priceBandUsd[0])} – $${fmtNum(w.priceBandUsd[1])}` : null;
    default: return null;
  }
}

function panelHtml(w, lin) {
  const specKeys = ['Case', 'Diameter', 'Bezel', 'Movement', 'Water resistance', 'Hands', 'Lume', 'Price today'];
  const rows = specKeys
    .map(k => [k, specValue(w, k)])
    .filter(([, v]) => v != null)
    .map(([k, v]) => `<div class="p-spec-row"><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd></div>`)
    .join('');

  const linRow = x =>
    `<li><button type="button" data-goto="${escapeHtml(String(x.id))}">` +
    `<span>${escapeHtml(x.brand)} ${escapeHtml(x.model)}</span>` +
    `<span class="yr">${escapeHtml(String(x.year ?? ''))}</span></button></li>`;

  let lineage = '';
  if (lin.panelAnc.length === 0 && lin.panelDesc.length === 0) {
    lineage = `<p class="p-lin-one">A lineage of one.</p>`;
  } else {
    if (lin.panelAnc.length) {
      lineage += `<h3 class="p-lin-head">ANCESTRY</h3><ul class="p-lin-list">${lin.panelAnc.map(linRow).join('')}</ul>`;
    }
    if (lin.panelDesc.length) {
      lineage += `<h3 class="p-lin-head">DESCENDANTS</h3><ul class="p-lin-list">${lin.panelDesc.map(linRow).join('')}</ul>`;
    }
  }

  /* editorial hero when it exists; the catalog specimen stands in when not.
     The glyph is never apologised for. */
  const ph = (IMAGES[w.id] && IMAGES[w.id].file) ? IMAGES[w.id] : CATALOG[w.id];
  const photo = ph && ph.file ? `
    <div class="sec p-photo">
      <img src="./data/${escapeHtml(ph.file)}" alt="${escapeHtml(w.brand + ' ' + w.model)}"
           loading="lazy" onerror="this.parentElement.style.display='none'">
      <p class="p-credit">Photo ${escapeHtml(ph.credit || 'Wikimedia Commons')}${ph.license ? ' · ' + escapeHtml(ph.license) : ''}</p>
    </div>` : '';

  /* breadcrumb chip — only while the path genuinely came from a family index */
  const crumb = S.familyView && S.familyView.chained
    ? `<button type="button" class="p-crumb" data-crumb aria-label="Back to ${escapeHtml(S.familyView.label)}">← ${escapeHtml(S.familyView.label)}</button>`
    : '';

  return `
    <div class="sec">${crumb}
      <p class="p-overline">${escapeHtml(w.brand)}</p>
      <h2 class="p-title">${escapeHtml(w.model)}</h2>
      <p class="p-ref">${w.reference ? `Ref. ${escapeHtml(w.reference)} · ` : ''}${escapeHtml(String(w.year ?? ''))}</p>
    </div>${photo}
    <div class="sec"><p class="p-significance">${escapeHtml(w.significance || '')}</p></div>
    <div class="sec"><dl class="p-specs">${rows}</dl></div>
    ${loreHtml(w.id)}
    <div class="sec">${lineage}</div>`;
}

/* ---- Heritage: sourced narrative for the field's legends -------------------
   One '.sec' block. Silent when a watch has no entry. Every passage keeps its
   attribution; external links open in a new tab. */
function loreHtml(id) {
  const L = LORE[id];
  /* Images used to be gated behind a written history: no lede, no section, and
     therefore no filmstrip — a watch could carry media that nothing would ever
     render. A gallery does not need prose to justify itself, so it gets its own
     section and its own honest heading ("Heritage" promises a story). */
  if (!L || !L.lede) {
    const only = mediaHtml(id);
    return only
      ? `<div class="sec lore lore-media-only" data-lore>
    <h3 class="lore-head">Gallery</h3>
    ${only}
  </div>`
      : '';
  }
  const cite = (label, url) => url
    ? `<a class="lore-cite" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}<span class="lore-arrow" aria-hidden="true">↗</span></a>`
    : `<span class="lore-cite lore-cite-plain">${escapeHtml(label)}</span>`;

  const passages = (L.passages || []).map(p =>
    `<div class="lore-passage"><p class="lore-text">${escapeHtml(p.text)}</p>${cite(p.source, p.url)}</div>`
  ).join('');

  const quote = L.quote && L.quote.text
    ? `<figure class="lore-quote"><blockquote>${escapeHtml(L.quote.text)}</blockquote>` +
      `${L.quote.who ? `<figcaption>${escapeHtml(L.quote.who)}</figcaption>` : ''}</figure>`
    : '';

  /* sources ride a horizontal rail — publication name only, height preserved */
  const seen = new Set();
  const chips = (L.sources || []).filter(s => s && s.url && !seen.has(s.url) && seen.add(s.url)).map(s => {
    const short = (s.label || '').split('—')[0].trim() || s.label;
    return `<a class="lore-src-chip" href="${escapeHtml(s.url)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(s.label)}">${escapeHtml(short)}</a>`;
  }).join('');
  const sources = chips
    ? `<div class="lore-sources"><span class="lore-sources-label">Sources</span><div class="lore-sources-rail">${chips}</div></div>`
    : '';

  /* collapsed by default — lede + filmstrip are the at-a-glance; the full
     narrative expands on demand so the panel's IA stays scannable */
  const hasBody = !!(passages || quote || sources);
  const chevron = `<svg class="lore-chev" width="9" height="6" viewBox="0 0 9 6" aria-hidden="true"><path d="M1 1 L4.5 4.5 L8 1" stroke="currentColor" stroke-width="1.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const expand = hasBody
    ? `<button type="button" class="lore-expand" data-lore-toggle aria-expanded="false"><span class="lore-expand-label">Read the full history</span>${chevron}</button>`
    : '';
  const body = hasBody
    ? `<div class="lore-body"><div class="lore-body-inner">${passages}${quote}${sources}</div></div>`
    : '';

  return `<div class="sec lore" data-lore>
    <h3 class="lore-head">Heritage</h3>
    <p class="lore-lede">${escapeHtml(L.lede)}</p>
    ${mediaHtml(id)}
    ${expand}${body}
  </div>`;
}

/* the lightbox items for a watch's heritage gallery — the story caption is the
   title, provenance is the credit. Consistent with the specimen lightbox. */
function mediaItems(id) {
  return (MEDIA[id] || []).filter(m => m && m.file).map(m => ({
    src: './data/' + m.file,
    title: m.caption || '',
    credit: [m.credit, m.source && (() => { try { return new URL(m.source).hostname.replace(/^www\./, ''); } catch { return ''; } })()]
      .filter(Boolean).join(' · ')
  }));
}

/* a horizontal filmstrip — Apple's Photos gesture language: momentum scroll,
   snap, quiet chrome. The images are the content; tap opens the lightbox. */
function mediaHtml(id) {
  const items = MEDIA[id] || [];
  if (!items.length) return '';
  const thumbs = items.filter(m => m && m.file).map((m, i) =>
    `<button type="button" class="lm-thumb" data-media="${i}" aria-label="${escapeHtml(m.caption || 'Heritage image')}">` +
    `<img src="./data/${escapeHtml(m.file)}" alt="${escapeHtml(m.caption || '')}" loading="lazy" draggable="false" onerror="this.closest('.lm-thumb').remove()">` +
    `</button>`
  ).join('');
  return `<div class="lore-media" role="group" aria-label="Heritage gallery">${thumbs}</div>`;
}

/* tap a filmstrip thumb → the heritage gallery opens in the shared lightbox */
function wireMediaThumbs(id) {
  const items = mediaItems(id);
  for (const b of elPanelContent.querySelectorAll('.lm-thumb[data-media]')) {
    b.addEventListener('click', () => lightboxOpen(items, +b.dataset.media));
  }
}

/* wire the heritage section — the expand/collapse toggle and the filmstrip */
function wireLore(id) {
  const sec = elPanelContent.querySelector('[data-lore]');
  if (sec) {
    const btn = sec.querySelector('[data-lore-toggle]');
    if (btn) btn.addEventListener('click', () => {
      const open = sec.classList.toggle('expanded');
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      const lbl = btn.querySelector('.lore-expand-label');
      if (lbl) lbl.textContent = open ? 'Show less' : 'Read the full history';
    });
  }
  wireMediaThumbs(id);
}

/* if the heritage/media layers arrive after a panel is already open, slot them in.
   Handles either layer landing first: rebuild the section, re-wire the strip. */
function refreshPanelLore() {
  if (elPanel.hidden || !S.selection) return;
  const id = S.selection.id;
  const html = loreHtml(id);
  if (!html) return;
  const existing = elPanelContent.querySelector('[data-lore]');
  if (existing) {
    /* media may have arrived after lore — refresh only if the strip is now richer */
    const hasStrip = existing.querySelector('.lore-media');
    if (hasStrip || !(MEDIA[id] && MEDIA[id].length)) return;
    existing.outerHTML = html;
  } else {
    /* heritage sits after the specs block in the IA */
    const specs = elPanelContent.querySelector('.p-specs');
    const anchor = specs ? specs.closest('.sec') : null;
    if (!anchor) return;
    anchor.insertAdjacentHTML('afterend', html);
  }
  wireLore(id);
}

let panelHideTimer = null;
let panelPrevFocus = null;       /* focus returns here on close (dialog contract) */

/* shared open/swap scaffolding — watch detail and family index speak one dialect */
function openPanelWith(ariaLabel, inject, crossfade) {
  clearTimeout(panelHideTimer);
  elPanel.setAttribute('aria-label', ariaLabel);
  if (crossfade && !elPanel.hidden) {
    /* a mid-close shell is resurrected — hidePanel leaves hidden=false for 250ms
       while '.closing' animates; without this the panel would stay at opacity 0 */
    elPanel.classList.remove('closing');
    elPanel.classList.add('open');
    elPanelContent.classList.add('swap');
    setTimeout(() => {
      /* the clicked row is about to be replaced — keep focus in the dialog */
      const keepFocus = elPanel.contains(document.activeElement) || document.activeElement === body;
      inject();
      elPanelContent.classList.remove('swap');
      elPanel.scrollTop = 0;
      if (keepFocus) elPanel.focus({ preventScroll: true });
    }, 130);
  } else {
    panelPrevFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    inject();
    elPanel.hidden = false;
    elPanel.classList.remove('closing');
    elPanel.scrollTop = 0;
    elPanel.focus({ preventScroll: true });
    /* two frames so the enter transition runs */
    requestAnimationFrame(() => requestAnimationFrame(() => elPanel.classList.add('open')));
  }
}

function showPanel(w, lin, crossfade) {
  openPanelWith(`${w.brand} ${w.model}`, () => {
    elPanelContent.innerHTML = panelHtml(w, lin);
    for (const b of elPanelContent.querySelectorAll('[data-goto]')) {
      /* the chain propagates down lineage rows — the breadcrumb persists */
      b.addEventListener('click', () => selectWatch(b.dataset.goto,
        S.familyView && S.familyView.chained ? { viaChain: true } : {}));
      b.addEventListener('mouseenter', () => setPanelHover(b.dataset.goto));
      b.addEventListener('mouseleave', () => setPanelHover(null));
    }
    const crumb = elPanelContent.querySelector('[data-crumb]');
    if (crumb) crumb.addEventListener('click', returnToFamily);
    wireLore(w.id);
    const photo = elPanelContent.querySelector('.p-photo img');
    if (photo) {
      photo.addEventListener('click', () => {
        /* the life shot first, the specimen second, the gallery after.
           DEDUPED BY SRC: the editorial and catalog layers frequently hold the
           same file, and pushing both put the identical photograph in twice —
           which is what "this watch has two of the same variant" actually was. */
        const items = [], seen = new Set();
        const push = it => { if (it && it.src && !seen.has(it.src)) { seen.add(it.src); items.push(it); } };
        const ed = IMAGES[w.id], cat = CATALOG[w.id];
        if (ed && ed.file) push({
          src: './data/' + ed.file,
          title: `${w.brand} ${w.model} · ${w.year}`,
          credit: photoCredit(ed)
        });
        if (cat && cat.file) push({
          src: './data/' + cat.file,
          title: `${w.brand} ${w.model} · ${w.year} — specimen`,
          credit: (cat && cat.credit) || 'WatchBase catalog render'
        });
        /* variants and heritage ride the same carousel — opening the hero and
           arrowing across is how you compare the black dial against the white */
        for (const m of mediaItems(w.id)) push(m);
        if (items.length) lightboxOpen(items, 0);
      });
    }
  }, crossfade);
}

/* --- the family index — a chronology in the panel shell ---------------- */

function familyMetaLine(w) {
  return [
    w.reference ? `Ref. ${w.reference}` : null,
    isFinite(w.diameterMm) ? `Ø ${w.diameterMm} mm` : null,
    isFinite(w.waterResistanceM) ? `${w.waterResistanceM} m` : null,
    w.movement ? sentence(w.movement) : null
  ].filter(Boolean).join(' · ');            /* omit missing fields — never a blank slot */
}

function familyHtml(fv) {
  const total = fv.memberList.length;
  const yr = Math.round(curTY);
  const engaged = curTY < S.time.max - 1e-6;
  const born = engaged ? fv.memberList.filter(w => (w.year || 0) <= yr).length : total;
  const overline = engaged ? `FAMILY · ${born} OF ${total}` : `FAMILY · ${total} WATCHES`;
  const cards = fv.memberList.map(w => {
    const meta = familyMetaLine(w);
    /* both bounds signed — one convention with the detail panel's Price today */
    const price = Array.isArray(w.priceBandUsd) && w.priceBandUsd.length === 2
      ? `$${fmtNum(w.priceBandUsd[0])} – $${fmtNum(w.priceBandUsd[1])}` : '';
    const unborn = engaged && (w.year || 0) > yr;
    return `<li><button type="button" class="fi-card${unborn ? ' fi-unborn' : ''}" data-id="${escapeHtml(String(w.id))}">` +
      `<canvas class="fi-glyph" aria-hidden="true"></canvas>` +
      `<span class="fi-main">` +
      `<span class="fi-brand">${escapeHtml(String(w.brand || '').toUpperCase())}</span>` +
      `<span class="fi-model">${escapeHtml(w.model || '')}</span>` +
      (meta ? `<span class="fi-meta">${escapeHtml(meta)}</span>` : '') +
      `</span><span class="fi-side">` +
      `<span class="fi-year">${escapeHtml(String(w.year ?? ''))}</span>` +
      (price ? `<span class="fi-price">${escapeHtml(price)}</span>` : '') +
      `</span></button></li>`;
  }).join('');
  /* the family hero — its most influential photographed member on the specimen
     plate; where no free photography exists, its five brightest members, drawn */
  const media = familyMedia(fv.id);
  let hero;
  if (media.length) {
    const m = media[0];
    const creditLine = m.isCatalog
      ? `${m.w.brand} ${m.w.model} · Photo ${(CATALOG[m.w.id] && CATALOG[m.w.id].credit) || 'WatchBase catalog render'}`
      : `${m.w.brand} ${m.w.model} · Photo ${m.credit || 'Wikimedia Commons'}${m.license ? ' · ' + m.license : ''}`;
    hero = `<div class="sec fi-hero">` +
      `<img src="./data/${escapeHtml(m.file)}" alt="${escapeHtml(m.w.brand + ' ' + m.w.model)}"` +
      ` loading="lazy" onerror="this.parentElement.style.display='none'">` +
      `<p class="p-credit">${escapeHtml(creditLine)}</p>` +
      `</div>`;
  } else {
    hero = `<div class="sec fi-hero"><canvas class="fi-strip" data-fam="${escapeHtml(fv.id)}" aria-hidden="true"></canvas></div>`;
  }
  return `
    <div class="sec">
      <p class="p-overline">${escapeHtml(overline)}</p>
      <h2 class="p-title">${escapeHtml(fv.label)}</h2>
      <p class="p-ref">${escapeHtml(String(fv.minYear))} — ${escapeHtml(String(fv.maxYear))}</p>
    </div>${hero}
    <div class="sec"><p class="p-significance">${escapeHtml(FAMILY_CHARACTER[fv.id] || '')}</p></div>
    <div class="sec"><ul class="fi-list">${cards}</ul></div>`;
}

/* card glyphs drawn once after layout settles — the map's own language, frozen:
   t3Alpha = 0, deliberately. A card is a chronology entry, not a live instrument. */
function drawCardGlyphs() {
  requestAnimationFrame(() => {
    const now = performance.now();
    for (const cnv of elPanelContent.querySelectorAll('canvas.fi-glyph')) {
      const card = cnv.closest('.fi-card');
      const w = card && S.byId.get(card.dataset.id);
      if (!w) continue;
      cnv.width = Math.max(1, Math.round(28 * dpr));
      cnv.height = Math.max(1, Math.round(28 * dpr));
      const g = cnv.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawGlyph(g, w, 14, 14, 22, 0, now);
    }
    for (const cnv of elPanelContent.querySelectorAll('canvas.fi-strip')) {
      drawFamilyStrip(cnv, cnv.dataset.fam);
    }
  });
}

function showFamilyPanel(focusId) {
  const fv = S.familyView;
  if (!fv) return;
  openPanelWith(fv.label, () => {
    elPanelContent.innerHTML = familyHtml(fv);
    for (const b of elPanelContent.querySelectorAll('.fi-card')) {
      b.addEventListener('click', () => selectWatch(b.dataset.id, { viaChain: true }));
      /* card hover/focus lights the watch on the map, exactly as map-hover does */
      b.addEventListener('mouseenter', () => setHover(b.dataset.id));
      b.addEventListener('mouseleave', () => setHover(null));
      b.addEventListener('focus', () => setHover(b.dataset.id));
      b.addEventListener('blur', () => setHover(null));
    }
    /* the family hero opens the whole family gallery in the print room */
    const hero = elPanelContent.querySelector('.fi-hero img');
    if (hero) {
      hero.addEventListener('click', () => {
        const gallery = familyMedia(fv.id).map(m => ({
          src: './data/' + m.file,
          title: `${m.w.brand} ${m.w.model} · ${m.w.year}`,
          credit: m.isCatalog ? ((CATALOG[m.w.id] && CATALOG[m.w.id].credit) || 'WatchBase catalog render') : photoCredit(m)
        }));
        lightboxOpen(gallery, 0);
      });
    }
    drawCardGlyphs();
    /* returning from a watch detail resumes at that watch's card */
    if (focusId != null) {
      const btn = elPanelContent.querySelector(`.fi-card[data-id="${CSS.escape(String(focusId))}"]`);
      if (btn) requestAnimationFrame(() => btn.focus());
    }
  }, !elPanel.hidden);
}

/* live time updates while the index is open — count + unborn class flips only */
function updateFamilyPanelTime(yr, engaged) {
  const fv = S.familyView;
  if (!fv) return;
  /* during the 130ms crossfade the panel still holds the outgoing watch detail —
     its .p-overline is the brand line and must not be rewritten to family copy */
  if (!elPanelContent.querySelector('.fi-list')) return;
  const total = fv.memberList.length;
  const ov = elPanelContent.querySelector('.p-overline');
  if (ov) {
    const born = engaged ? fv.memberList.filter(w => (w.year || 0) <= yr).length : total;
    ov.textContent = engaged ? `FAMILY · ${born} OF ${total}` : `FAMILY · ${total} WATCHES`;
  }
  for (const b of elPanelContent.querySelectorAll('.fi-card')) {
    const w = S.byId.get(b.dataset.id);
    if (w) b.classList.toggle('fi-unborn', engaged && (w.year || 0) > yr);
  }
}
function hidePanel() {
  if (elPanel.hidden) return;
  elPanel.classList.remove('open');
  elPanel.classList.add('closing');
  clearTimeout(panelHideTimer);
  const focusWasInside = elPanel.contains(document.activeElement) || document.activeElement === elPanel;
  panelHideTimer = setTimeout(() => {
    elPanel.hidden = true;
    elPanel.classList.remove('closing');
    elPanelContent.innerHTML = '';
  }, REDUCED ? 90 : 250);
  if (focusWasInside && panelPrevFocus && document.contains(panelPrevFocus)) {
    panelPrevFocus.focus({ preventScroll: true });
  }
  panelPrevFocus = null;
}

/* ======================================================================
   13 · SEARCH
   ====================================================================== */

let searchOpen = false, searchResults = [], searchActive = -1;
let searchRestW = null, searchWidthTimer = null;

/* pin current width → retarget → clear the inline width once the 240ms
   transition lands, so the stylesheet (incl. the <760px calc) owns the box */
function animateSearchWidth(targetPx) {
  elSearch.style.width = elSearch.offsetWidth + 'px';
  void elSearch.offsetWidth;                      /* commit the start width */
  elSearch.style.width = targetPx;
  clearTimeout(searchWidthTimer);
  searchWidthTimer = setTimeout(() => { elSearch.style.width = ''; }, 300);
}

function openSearch() {
  if (searchOpen || S.failed) return;
  skipReveal();
  searchOpen = true;
  if (searchRestW == null) searchRestW = elSearch.offsetWidth;
  /* mobile: CSS anchors the open bar by both edges (left+right) — never set an
     inline width, which would fight the anchoring and overflow the viewport */
  if (window.innerWidth <= 760) elSearch.style.width = '';
  else animateSearchWidth('320px');
  elSearch.classList.add('open');
  elSearchInput.hidden = false;
  elSearchInput.value = '';
  elSearchInput.setAttribute('aria-expanded', 'true');
  elSearchInput.focus();
  renderResults([]);
}
function closeSearch() {
  if (!searchOpen) return;
  searchOpen = false;
  if (window.innerWidth <= 760) elSearch.style.width = '';   /* CSS owns the collapse back to the circle */
  else animateSearchWidth(searchRestW != null ? searchRestW + 'px' : '');
  elSearch.classList.remove('open');
  elSearchInput.hidden = true;
  elSearchInput.value = '';
  elSearchInput.setAttribute('aria-expanded', 'false');
  elSearchInput.removeAttribute('aria-activedescendant');
  elSearchResults.hidden = true;
  elSearchResults.innerHTML = '';
  searchResults = []; searchActive = -1;
}

function rankMatches(q) {
  q = q.trim().toLowerCase();
  if (!q) return [];
  const scored = [];
  for (const w of S.watches) {
    const brand = String(w.brand || '').toLowerCase();
    const model = String(w.model || '').toLowerCase();
    const ref = String(w.reference || '').toLowerCase();
    const year = String(w.year || '');
    const combo = brand + ' ' + model;
    let score = Infinity;
    if (brand.startsWith(q) || model.startsWith(q) || combo.startsWith(q) || ref.startsWith(q) || year.startsWith(q)) score = 0;
    else if (model.split(/\s+/).some(t => t.startsWith(q)) || brand.split(/\s+/).some(t => t.startsWith(q))) score = 1;
    else if (combo.includes(q) || ref.includes(q)) score = 2;
    if (score < Infinity) scored.push([score, w]);
  }
  scored.sort((a, b) => a[0] - b[0] || b[1]._desc - a[1]._desc || (a[1].year || 0) - (b[1].year || 0));
  /* families join after watches — same three tiers, scored on BOTH the display
     label and the id-derived name ('vintage' must find the Skin Divers) */
  const famScored = [];
  for (const fam of S.families) {
    const names = [String(fam.label || ''), familyLabel(fam.id)]
      .filter(Boolean).map(s => s.toLowerCase());
    let score = Infinity;
    for (const label of names) {
      if (label.startsWith(q)) score = Math.min(score, 0);
      else if (label.split(/\s+/).some(t => t.startsWith(q))) score = Math.min(score, 1);
      else if (label.includes(q)) score = Math.min(score, 2);
    }
    if (score < Infinity) famScored.push([score, fam]);
  }
  famScored.sort((a, b) => a[0] - b[0] || (b[1].count || 0) - (a[1].count || 0));
  /* families reserve at most 2 rows, then watches fill to capacity — models
     never drown under lineages, and no slot ever sits empty */
  const fams = famScored.slice(0, scored.length ? 2 : 8).map(s => ({ type: 'family', item: s[1] }));
  const watches = scored.slice(0, 8 - fams.length).map(s => ({ type: 'watch', item: s[1] }));
  return watches.concat(fams);
}

function renderResults(list) {
  searchResults = list;
  searchActive = list.length ? 0 : -1;
  const q = elSearchInput.value.trim();
  if (!q) {
    elSearchResults.hidden = true;
    elSearchResults.innerHTML = '';
    elSearchInput.removeAttribute('aria-activedescendant');
    return;
  }
  elSearchResults.hidden = false;
  if (!list.length) {
    elSearchResults.innerHTML = `<li class="sr-empty" role="presentation">Nothing by that name — yet.</li>`;
    elSearchInput.removeAttribute('aria-activedescendant');
    return;
  }
  elSearchResults.innerHTML = list.map((r, i) => {
    const model = r.type === 'family'
      ? escapeHtml(r.item.label || familyLabel(r.item.id))
      : `${escapeHtml(r.item.brand)} ${escapeHtml(r.item.model)}`;
    const meta = r.type === 'family'
      ? `FAMILY · ${r.item.count || 0}`
      : escapeHtml(String(r.item.year ?? ''));
    return `<li id="sr-${i}" role="option" aria-selected="${i === searchActive}" class="${i === searchActive ? 'active' : ''}" data-i="${i}">` +
      `<span class="sr-model">${model}</span>` +
      `<span class="sr-meta">${meta}</span></li>`;
  }).join('');
  elSearchInput.setAttribute('aria-activedescendant', 'sr-0');
  for (const li of elSearchResults.querySelectorAll('li[data-i]')) {
    li.addEventListener('mousedown', e => e.preventDefault());
    li.addEventListener('click', () => { commitSearch(Number(li.dataset.i)); });
  }
}
function moveActive(d) {
  if (!searchResults.length) return;
  searchActive = (searchActive + d + searchResults.length) % searchResults.length;
  const items = elSearchResults.querySelectorAll('li[data-i]');
  items.forEach((li, i) => {
    li.classList.toggle('active', i === searchActive);
    li.setAttribute('aria-selected', String(i === searchActive));
  });
  elSearchInput.setAttribute('aria-activedescendant', 'sr-' + searchActive);
}
function commitSearch(i) {
  const r = searchResults[i];
  if (!r) return;
  closeSearch();
  if (r.type === 'family') {
    /* a family is a sky concept — in descent, surface first, then open (§18b).
       Queue ownership is explicit: reversing a descending morph (new dir −1)
       never clears the queue, so set-then-reverse is safe; a morph already
       surfacing is simply joined, never reversed back onto itself. */
    if (S.morph) {
      morphQueued = () => openFamily(r.item.id);
      if (S.morph.dir === 1) reverseMorph();
    } else if (S.mode === 'descent') {
      morphQueued = () => openFamily(r.item.id);
      startMorph(-1);
    } else {
      openFamily(r.item.id);
    }
  } else selectWatch(r.item.id);
}

elSearchToggle.addEventListener('click', openSearch);
$('search-close').addEventListener('click', closeSearch);
elSearchInput.addEventListener('input', () => renderResults(rankMatches(elSearchInput.value)));
elSearchInput.addEventListener('keydown', e => {
  if (e.key === 'ArrowDown') { e.preventDefault(); moveActive(1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); moveActive(-1); }
  else if (e.key === 'Enter') { e.preventDefault(); commitSearch(searchActive); }
  else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeSearch(); }
});
elSearchInput.addEventListener('blur', () => setTimeout(() => { if (searchOpen && !elSearch.contains(document.activeElement)) closeSearch(); }, 120));

/* ======================================================================
   13b · THE THREADS — ambient lineage
   Every parent→child edge drawn as a faint curved thread across the sky,
   always present at far zoom. Not decoration: real lineage, the same data
   drawLineage brightens for a selection — here at whisper alpha, so the
   unprompted first frame states the thesis. A century of design as one
   connected structure. Precomputed once; zero per-frame allocation.
   ====================================================================== */

function buildThreads() {
  /* one edge per (parent, child) pair where both ids resolve — multi-parent
     children enumerate per pair. S.children is already year-sorted, so the
     child's index is its fan position (same centered fan as drawLineage). */
  const list = [];
  for (const [pid, kids] of S.children) {
    const wp = S.byId.get(pid);
    for (let i = 0; i < kids.length; i++) {
      list.push({ wp, wc: S.byId.get(kids[i]), fan: i - (kids.length - 1) / 2 });
    }
  }
  /* weave order = array order: oldest child first — Radiomir outward */
  list.sort((a, b) =>
    (a.wc.year || 0) - (b.wc.year || 0) ||
    (a.wp.year || 0) - (b.wp.year || 0) ||
    String(a.wc.id).localeCompare(String(b.wc.id)));

  const n = list.length;
  const idx = new Map(S.watches.map((w, i) => [w.id, i]));
  let descMax = 1;
  for (const w of S.watches) if (w._desc > descMax) descMax = w._desc;

  const T = {
    n,
    pts: new Float32Array(n * 8),    /* WORLD-space cubic: x0,y0,c1x,c1y,c2x,c2y,x1,y1 */
    base: new Float32Array(n),       /* influence-weighted ink alpha, 0.04–0.10 */
    ia: new Uint16Array(n),          /* index into S.watches — parent */
    ib: new Uint16Array(n),          /* index into S.watches — child */
    wlen: new Float32Array(n),       /* world chord length after trim (dash reveal) */
    start: new Float32Array(n),      /* weave start offset ms from reveal t0 */
    bulge: new Float32Array(n),      /* peak curve deviation off the chord, world units */
  };
  for (let k = 0; k < n; k++) {
    const { wp, wc, fan } = list[k];
    const dx = wc.x - wp.x, dy = wc.y - wp.y;
    const d = Math.hypot(dx, dy) || 1;
    const ux = dx / d, uy = dy / d;
    /* threads gesture at watches, never touch them — trim 12 world units
       (≈7px at fit zoom, the drawLineage r+6 gap spoken in world space) */
    const x0 = wp.x + ux * 12, y0 = wp.y + uy * 12;
    const x1 = wc.x - ux * 12, y1 = wc.y - uy * 12;
    const clen = Math.hypot(x1 - x0, y1 - y0);
    /* same centered fan as drawLineage; flatter curvature — a quieter register */
    const spread = fan === 0 ? 1 : Math.sign(fan) * clamp(1 + Math.abs(fan) * 0.9, 1, 2.5);
    const kk = 0.14 * spread * clen;
    const px = -uy, py = ux;
    const o = k * 8;
    T.pts[o] = x0;
    T.pts[o + 1] = y0;
    T.pts[o + 2] = x0 + (x1 - x0) * 0.3 + px * kk;
    T.pts[o + 3] = y0 + (y1 - y0) * 0.3 + py * kk;
    T.pts[o + 4] = x0 + (x1 - x0) * 0.7 + px * kk;
    T.pts[o + 5] = y0 + (y1 - y0) * 0.7 + py * kk;
    T.pts[o + 6] = x1;
    T.pts[o + 7] = y1;
    /* edges from high-influence parents read as the strongest currents,
       without ever leaving whisper territory */
    T.base[k] = 0.04 + 0.06 * Math.sqrt(wp._desc / descMax);
    T.ia[k] = idx.get(wp.id);
    T.ib[k] = idx.get(wc.id);
    T.wlen[k] = clen;
    /* a symmetric cubic with both controls offset k⊥ peaks at 0.75·k off the
       chord — cached so the cull can widen its margin per edge (a fanned
       thread must not pop out mid-pan while its bulge is still on-screen) */
    T.bulge[k] = 0.75 * Math.abs(kk);
    T.start[k] = 1500 + (n > 1 ? k / (n - 1) : 0) * 900;
  }
  S.threads = T;
}

/* the pass — behind the stars, in front of the vignette. Runs in the export
   path too (the poster IS the export): no isExport branch, no cached state. */
function drawThreads(c, w_, h_, now, z, dimT, TY, timeOn) {
  const T = S.threads;
  if (!T || T.n === 0) return;
  /* zoom fade — same z-space and terminus as the family labels:
     full at/below TIER_2, gone by z = 4 (detail takes over) */
  const Z = 1 - clamp((z - TIER_2) / 1.8, 0, 1);
  if (Z <= 0.004) return;
  /* the whole ambient layer recedes as one under selection/family/release —
     ambient ink can never sit at full strength beneath the lume lineage */
  const G = lerp(1, DIM_FIELD, dimT);
  const weaving = S.weave && !S.weaveDone;
  const reducedWeave = weaving && (S.weave.reduced || REDUCED);
  const wt0 = weaving ? S.weave.t0 : 0;

  /* toScreen allocates — hoist the affine once: screen = world·zc + (ox,oy) */
  const zc = S.cam.z;
  const ox = w_ / 2 - (S.cam.x + S.drift.x / zc) * zc;
  const oy = h_ / 2 - (S.cam.y + S.drift.y / zc) * zc;

  const watches = S.watches, pts = T.pts;
  c.save();
  c.lineWidth = 1;
  c.strokeStyle = THREAD_INK;
  for (let k = 0; k < T.n; k++) {
    const wa = watches[T.ia[k]], wb = watches[T.ib[k]];
    /* an edge to the unborn does not exist yet */
    let B = 1;
    if (timeOn) {
      B = Math.min(bornAlphaOf(wa, TY), bornAlphaOf(wb, TY));
      if (B <= 0) continue;
    }
    /* reveal weave — dash-draw 600ms per thread, oldest first; the alpha
       ramps over the first 120ms so the dash tip never pops */
    let p = 1, R = 1;
    if (weaving) {
      if (reducedWeave) {
        R = clamp((now - wt0) / 400, 0, 1);
      } else {
        const dt = now - wt0 - T.start[k];
        if (dt <= 0) continue;
        p = easeGlide(clamp(dt / 600, 0, 1));
        R = clamp(dt / 120, 0, 1);
      }
    }
    const o = k * 8;
    const x0 = pts[o] * zc + ox, y0 = pts[o + 1] * zc + oy;
    const x1 = pts[o + 6] * zc + ox, y1 = pts[o + 7] * zc + oy;
    /* conservative viewport cull on the two anchors, margin widened by the
       edge's own bulge — a fanned thread's bow can be on-screen while both
       anchors sit past the flat 80px margin */
    const cm = 80 + T.bulge[k] * zc;
    if ((x0 < -cm && x1 < -cm) || (x0 > w_ + cm && x1 > w_ + cm) ||
        (y0 < -cm && y1 < -cm) || (y0 > h_ + cm && y1 > h_ + cm)) continue;
    const Lscr = T.wlen[k] * zc;
    /* a thread never pops; it resolves. Window 8→16px (not the drafted
       12→24): min world spacing is 40 → wlen ≥ 16, so every edge registers
       whenever z ≥ 0.5 — §4.1 "all 93 threads visible at fit" holds at real
       fit zooms, still pop-free */
    const edgeA = clamp((Lscr - 8) / 8, 0, 1);
    /* lens — endpoint min; Ephemeris B above; selection G is global */
    const L = Math.min(lensFactorOf(wa, now), lensFactorOf(wb, now));
    const a = T.base[k] * Z * G * L * B * edgeA * R;
    if (a <= 0.004) continue;
    c.globalAlpha = a;
    if (p < 1) {
      const approx = Lscr * 1.06;
      c.setLineDash([approx, approx]);
      c.lineDashOffset = approx * (1 - p);
    }
    c.beginPath();
    c.moveTo(x0, y0);
    c.bezierCurveTo(
      pts[o + 2] * zc + ox, pts[o + 3] * zc + oy,
      pts[o + 4] * zc + ox, pts[o + 5] * zc + oy,
      x1, y1);
    c.stroke();
    if (p < 1) { c.setLineDash([]); c.lineDashOffset = 0; }
  }
  c.restore();
}

/* ======================================================================
   14 · RENDERING
   ====================================================================== */

const trackable = 'letterSpacing' in ctx;

function setType(c, sizePx, weight, mono, trackingEm) {
  c.font = `${weight} ${sizePx}px ${mono ? FONT_MONO : FONT_UI}`;
  if (trackable) c.letterSpacing = (trackingEm ? trackingEm * sizePx : 0) + 'px';
}

const snap = v => Math.round(v * dpr) / dpr;

function glyphDiameter(z) {
  const d2 = clamp(14 + 8 * (z - TIER_2) / (TIER_3 - TIER_2), 14, 22);
  const d3 = clamp(28 + 2 * (z - TIER_3), 28, 44);
  const t = clamp((z - TIER_3 * (1 - XFADE)) / (TIER_3 * 2 * XFADE), 0, 1);
  return lerp(d2, d3, t);
}
function tierAlphas(z) {
  const star = 1 - clamp((z - TIER_2 * (1 - XFADE)) / (TIER_2 * 2 * XFADE), 0, 1);
  const glyph = 1 - star;
  const t3 = clamp((z - TIER_3 * (1 - XFADE)) / (TIER_3 * 2 * XFADE), 0, 1);
  const label = clamp((z - 6) / 1, 0, 1);
  const fam = 1 - clamp((z - 3) / 1, 0, 1);
  return { star, glyph, t3, label, fam };
}

/* cached radial glow sprite per watch (no shadowBlur per frame) */
function glowSprite(w) {
  if (w._glow && w._glow.dpr === dpr) return w._glow;
  const R = 3 * w._r;
  const s = Math.max(2, Math.ceil(R * 2 * dpr));
  const c = document.createElement('canvas');
  c.width = s; c.height = s;
  const g = c.getContext('2d');
  const dial = hexRgb(w.dialColor);
  const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grad.addColorStop(0, rgbaStr(dial, 0.10));
  grad.addColorStop(1, rgbaStr(dial, 0));
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);
  w._glow = { c, R, dpr };
  return w._glow;
}

/* --- case paths ------------------------------------------------------ */
function traceCase(c, shape, R) {
  c.beginPath();
  if (shape === 'cushion') {
    const n = 3.5, e = 2 / n, steps = 40;
    for (let i = 0; i <= steps; i++) {
      const t = (i / steps) * Math.PI * 2;
      const ct = Math.cos(t), st = Math.sin(t);
      const x = Math.sign(ct) * Math.pow(Math.abs(ct), e) * R;
      const y = Math.sign(st) * Math.pow(Math.abs(st), e) * R;
      i === 0 ? c.moveTo(x, y) : c.lineTo(x, y);
    }
    c.closePath();
  } else if (shape === 'tonneau') {
    c.moveTo(-0.6 * R, -0.85 * R);
    c.quadraticCurveTo(0, -1.0 * R, 0.6 * R, -0.85 * R);
    c.bezierCurveTo(0.95 * R, -0.45 * R, 0.95 * R, 0.45 * R, 0.6 * R, 0.85 * R);
    c.quadraticCurveTo(0, 1.0 * R, -0.6 * R, 0.85 * R);
    c.bezierCurveTo(-0.95 * R, 0.45 * R, -0.95 * R, -0.45 * R, -0.6 * R, -0.85 * R);
    c.closePath();
  } else if (shape === 'asymmetric') {
    /* circle with the 30°–90° (clock) arc offset +1.5px — the Seawolf shoulder */
    const a0 = -Math.PI / 3, a1 = 0;   /* canvas radians for clock 30°→90° */
    c.arc(0, 0, R, a1, a0, false);     /* long way round */
    c.arc(0, 0, R + 1.5, a0, a1, false);
    c.closePath();
  } else {
    c.arc(0, 0, R, 0, Math.PI * 2);
  }
}

/* --- hands ------------------------------------------------------------ */
function drawHand(c, style, angle, len, isMinute, stroke) {
  const dx = Math.sin(angle), dy = -Math.cos(angle);
  const tx = dx * len, ty = dy * len;
  c.strokeStyle = stroke;
  c.fillStyle = stroke;
  let wPx = 1;
  switch (style) {
    case 'sword': wPx = 1.25; break;
    case 'plongeur': wPx = isMinute ? 2 : 1; break;
    case 'pencil': wPx = 1.25; break;
    case 'cathedral': wPx = 1.5; break;
    default: wPx = 1;
  }
  c.lineWidth = wPx;
  c.beginPath();
  c.moveTo(0, 0);
  c.lineTo(tx, ty);
  c.stroke();
  c.lineWidth = 1;
  if (style === 'mercedes' && !isMinute) {
    c.beginPath(); c.arc(dx * len * 0.72, dy * len * 0.72, 2, 0, Math.PI * 2); c.stroke();
  } else if (style === 'snowflake' && !isMinute) {
    const px = dx * len * 0.72, py = dy * len * 0.72, s = 2.5;
    c.beginPath();
    c.moveTo(px + dx * s, py + dy * s);
    c.lineTo(px - dy * s, py + dx * s);
    c.lineTo(px - dx * s, py - dy * s);
    c.lineTo(px + dy * s, py - dx * s);
    c.closePath(); c.stroke();
  } else if (style === 'broad-arrow') {
    const bx = dx * len * 0.8, by = dy * len * 0.8, s = 2.2;
    c.beginPath();
    c.moveTo(bx - dy * s - dx * s, by + dx * s - dy * s);
    c.lineTo(tx, ty);
    c.lineTo(bx + dy * s - dx * s, by - dx * s - dy * s);
    c.stroke();
  }
}

/* --- the glyph — a patent drawing, ≤3 primitives per element ---------- */
function drawGlyph(c, w, x, y, D, t3Alpha, now) {
  const R = D / 2;
  const f = w.features || {};
  const stroke = mixed('stroke', w.dialColor);
  const dialFill = mixed('fill', w.dialColor);

  c.save();
  c.translate(snap(x), snap(y));
  c.lineWidth = 1;

  /* case + dial */
  traceCase(c, w.caseShape, R);
  c.fillStyle = dialFill;
  c.fill();
  c.strokeStyle = stroke;
  c.stroke();

  /* bezel — concentric ring 2px inside case edge */
  if (w.bezelType && w.bezelType !== 'none') {
    const rb = (w.caseShape === 'tonneau' ? R * 0.72 : R - 2);
    if (rb > 3) {
      c.save();
      if (w.bezelType === 'internal') c.globalAlpha *= 0.55;
      c.strokeStyle = w.bezelType === 'rotating' ? mixed('stroke', w.bezelColor) : stroke;
      c.beginPath(); c.arc(0, 0, rb, 0, Math.PI * 2); c.stroke();
      if (w.bezelType === 'rotating') {
        c.beginPath(); c.moveTo(0, -rb); c.lineTo(0, -rb + 2); c.stroke();
      }
      c.restore();
    }
  }
  const rDial = (w.caseShape === 'tonneau' ? R * 0.72 : R - 2) - 2.5;

  /* accent — exactly once: 1.5px pip at 12 */
  c.fillStyle = mixed('stroke', w.accentColor);
  c.beginPath(); c.arc(0, -Math.max(rDial, 2), 0.75, 0, Math.PI * 2); c.fill();

  /* crown at 3; crown guard flanks */
  c.strokeStyle = stroke;
  c.beginPath(); c.moveTo(R, -1); c.lineTo(R + 1.5, -1); c.moveTo(R, 1); c.lineTo(R + 1.5, 1); c.stroke();
  if (f.crownGuard) {
    c.beginPath();
    c.moveTo(R - 0.5, -3); c.lineTo(R + 2, -2.2);
    c.moveTo(R - 0.5, 3); c.lineTo(R + 2, 2.2);
    c.stroke();
  }

  /* TIER 3 — lume, date, live hands */
  if (t3Alpha > 0.01 && rDial > 5) {
    c.save();
    c.globalAlpha *= t3Alpha;
    const lumeStroke = mixed('stroke', w.accentColor);

    if (f.lumePlots && f.lumePlots !== 'none') {
      c.fillStyle = lumeStroke;
      c.strokeStyle = lumeStroke;
      for (let h = 0; h < 12; h++) {
        if (h === 3 && f.dateWindow) continue;
        const a = h / 12 * Math.PI * 2;
        const px = Math.sin(a) * rDial, py = -Math.cos(a) * rDial;
        const kind = f.lumePlots === 'mixed' ? (h % 3 === 0 ? 'rect' : 'dot') :
                     f.lumePlots === 'rectangular' ? 'rect' : 'dot';
        c.save();
        if (f.lumePlots === 'sandwich') c.globalAlpha *= 0.55;
        if (kind === 'rect') {
          c.save();
          c.translate(px, py); c.rotate(a);
          c.fillRect(-0.5, -1, 1, 2);
          c.restore();
        } else {
          c.beginPath(); c.arc(px, py, 0.75, 0, Math.PI * 2); c.fill();
        }
        c.restore();
      }
    }

    if (f.dateWindow) {
      c.strokeStyle = stroke;
      c.strokeRect(rDial - 1, -1.25, 2, 2.5);
    }

    /* live time — hour + minute, no seconds hands anywhere */
    const mod = currentMinuteOfDay(now);
    const mAngle = (mod % 60) / 60 * Math.PI * 2;
    const hAngle = ((mod / 60) % 12) / 12 * Math.PI * 2;
    const style = f.handsStyle || 'baton';
    drawHand(c, style, hAngle, rDial * 0.52, false, stroke);
    drawHand(c, style, mAngle, rDial * 0.78, true, stroke);
    c.restore();
  }
  c.restore();
}

/* --- labels ----------------------------------------------------------- */
function labelLines(w) {
  let model = String(w.model || '');
  if (model.length > 22) model = model.slice(0, 21) + '…';
  return [String(w.brand || '').toUpperCase(), model];
}
function drawWatchLabel(c, w, x, y, R, alpha, withYear) {
  if (alpha <= 0.01) return;
  const [brand, model] = labelLines(w);
  c.save();
  c.globalAlpha *= alpha;
  c.textAlign = 'center';
  c.textBaseline = 'top';
  let ty = snap(y + R + 8);
  setType(c, 9, 500, false, 0.14);
  c.fillStyle = TEXT_3;
  c.fillText(brand, snap(x), ty);
  ty += 13;
  setType(c, 11, 450, false, 0.02);
  c.fillStyle = TEXT_2;
  c.fillText(model, snap(x), ty);
  if (withYear && w.year) {
    ty += 15;
    setType(c, 8, 400, true, 0);
    c.fillStyle = TEXT_3;
    c.fillText(String(w.year), snap(x), ty);
  }
  c.restore();
}

function wrapFamily(label) {
  const words = String(label || '').toUpperCase().split(/\s+/);
  const lines = [];
  let cur = '';
  for (const wd of words) {
    if (cur && (cur + ' ' + wd).length > 14) { lines.push(cur); cur = wd; }
    else cur = cur ? cur + ' ' + wd : wd;
  }
  if (cur) lines.push(cur);
  return lines;
}

/* --- lineage curves ---------------------------------------------------- */
function edgeHot(e, now) {
  if (S.panelHoverId == null && S.panelHoverAnims.size === 0) return 0;
  return Math.max(panelHotProgress(String(e.a), now), panelHotProgress(String(e.b), now));
}

function drawLineage(c, edges, now, t0, animLen, fading) {
  const baseA = c.globalAlpha;
  /* reduced motion: lineage appears fully drawn in one 200ms fade */
  const reducedRamp = (REDUCED && !fading) ? clamp((now - t0) / 200, 0, 1) : 1;
  c.lineWidth = 1;
  c.strokeStyle = LUME;
  for (const e of edges) {
    const wa = S.byId.get(e.a), wb = S.byId.get(e.b);
    if (!wa || !wb) continue;
    /* an edge to the unborn does not exist yet */
    let bornEdge = 1;
    if (curTY < S.time.max - 1e-6) {
      bornEdge = Math.min(bornAlphaOf(wa, curTY), bornAlphaOf(wb, curTY));
      if (bornEdge <= 0) continue;
    }
    let [x0, y0] = toScreen(wa.x, wa.y);
    let [x1, y1] = toScreen(wb.x, wb.y);
    const dx = x1 - x0, dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    if (len < 17) continue;
    /* short edges fade, never pop — a point never pops, it resolves */
    const edgeA = clamp((len - 16) / 16, 0, 1);
    const ux = dx / len, uy = dy / len;
    const rA = glyphRadiusFor(wa), rB = glyphRadiusFor(wb);
    /* lines gesture at watches, never touch them — stop 6px short */
    x0 += ux * (rA + 6); y0 += uy * (rA + 6);
    x1 -= ux * (rB + 6); y1 -= uy * (rB + 6);
    const clen = Math.hypot(x1 - x0, y1 - y0);
    if (clen < 8) continue;
    /* control points perpendicular to the chord at 18%; per-parent fans
       spread symmetrically about the chord (fan is centered at 0) */
    const spread = e.fan === 0 ? 1 : Math.sign(e.fan) * clamp(1 + Math.abs(e.fan) * 0.9, 1, 2.5);
    const k = 0.18 * spread * clen;
    const px = -uy, py = ux;
    const c1x = x0 + (x1 - x0) * 0.3 + px * k, c1y = y0 + (y1 - y0) * 0.3 + py * k;
    const c2x = x0 + (x1 - x0) * 0.7 + px * k, c2y = y0 + (y1 - y0) * 0.7 + py * k;

    let p = 1;
    if (!fading && !REDUCED) {
      /* ring (240ms) first, then curves — ancestors backward, descendants forward */
      const start = 240 + e.gen * 230 + e.sib * 80;
      p = clamp((now - t0 - start) / 600, 0, 1);
      p = easeGlide(p);
    }
    if (p <= 0) continue;

    const hot = edgeHot(e, now);
    const kindA = e.kind === 'anc' ? 1 : lerp(0.55, 1, hot);
    c.globalAlpha = baseA * edgeA * kindA * reducedRamp * bornEdge;
    if (c.globalAlpha <= 0.004) continue;
    if (p < 1) {
      const approx = clen * 1.06;
      c.setLineDash([approx, approx]);
      c.lineDashOffset = approx * (1 - p);
    }
    c.beginPath();
    c.moveTo(x0, y0);
    c.bezierCurveTo(c1x, c1y, c2x, c2y, x1, y1);
    c.stroke();
    if (p < 1) { c.setLineDash([]); c.lineDashOffset = 0; }
  }
  c.globalAlpha = baseA;
}

function glyphRadiusFor(w) {
  const z = S.cam.z;
  const sel = S.selection;
  if (sel && sel.related.has(w.id)) return Math.max(glyphDiameter(z), 28) / 2;
  if (z < TIER_2 * (1 - XFADE)) return w._r;
  return glyphDiameter(z) / 2;
}

/* the field-dim level this frame — ONE source of truth. Selections and
   family views are seeded with dimFrom (the dim level at the moment they
   were created), so a handoff while the field is already dimmed — family
   card → watch, lineage row → watch, watch → family — never flashes every
   unrelated star back to full brightness for a frame: the field never pops,
   it resolves; only the membership of the related set crossfades. */
function currentDimT(now) {
  const ramp = t0 => REDUCED
    ? clamp((now - t0) / 200, 0, 1)
    : easeOut(clamp((now - t0) / 400, 0, 1));
  if (S.selection) return lerp(S.selection.dimFrom || 0, 1, ramp(S.selection.t0));
  if (S.familyView) return lerp(S.familyView.dimFrom || 0, 1, ramp(S.familyView.t0));
  if (S.releasing) return 1 - ramp(S.releasing.t0);
  return 0;
}

/* --- the frame --------------------------------------------------------- */
function draw(c, w_, h_, now, isExport) {
  c.clearRect(0, 0, w_, h_);
  /* §18c — the water column's master gate, once per frame. In the sky
     waterT is 0 and GROUND_HEX_NOW is the exact FIELD_HEX string: this
     path is bit-identical to pre-water-column frames. */
  const waterT = wcUpdateGround(now);
  c.fillStyle = GROUND_HEX_NOW;
  c.fillRect(0, 0, w_, h_);

  /* vignette — tinted live while any water is on the frame (incl. export) */
  if (waterT > 0) {
    paintVignetteWater(c, w_, h_);
  } else if (!isExport && vignetteCanvas) {
    c.drawImage(vignetteCanvas, 0, 0, w_, h_);
  } else {
    paintVignette(c, w_, h_);
  }
  if (!S.loaded) return;

  /* §18 — one world, two projections; field + vignette are shared above.
     The morph owns the frame while it runs; descent owns it while engaged.
     Reduced motion: the mode has already flipped — the incoming scene draws
     below at full strength and the snapshot veil fades over it. */
  if (S.morph && !morphFinished(now) && !S.morph.reduced) { drawMorph(c, w_, h_, now, isExport); return; }
  if (S.mode === 'descent') {
    drawDescent(c, w_, h_, now, isExport);
    drawReducedMorphVeil(c, w_, h_, now, isExport);
    return;
  }

  /* winning label rects are re-earned every frame — nothing painted, nothing hittable */
  if (!isExport) S.famLabelRects = [];

  const z = S.cam.z;
  const A = tierAlphas(z);
  const sel = S.selection;
  const rel = sel ? sel.related : null;

  /* selection dim: dimFrom→1 over 400ms; release: back over 400ms
     (reduced motion: a plain 200ms fade — never an instant snap).
     A family view is a selection of many — same ramp, members as the set. */
  const dimT = currentDimT(now);
  const dimVal = lerp(1, DIM_FIELD, dimT);
  const relSetForDim = sel ? rel
    : S.familyView ? S.familyView.members
    : (S.releasing ? S.releasing.related : null);

  const famA = A.fam * revealFamAlpha(now);
  const mod = currentMinuteOfDay(now); /* touch to keep beat anim ticking */
  const TY = curTY;
  const timeOn = TY < S.time.max - 1e-6;

  /* ---- pass 0: the threads — ambient lineage behind the stars (§13b) ---- */
  drawThreads(c, w_, h_, now, z, dimT, TY, timeOn);

  /* ---- pass 1: points/glyphs ---- */
  const labelJobs = [];
  for (const w of S.watches) {
    const [x, y] = toScreen(w.x, w.y);
    if (x < -80 || x > w_ + 80 || y < -80 || y > h_ + 80) continue;

    const isRel = relSetForDim ? relSetForDim.has(w.id) : false;
    const isSel = sel && w.id === sel.id;
    const rv = revealState(w, now);
    if (rv.a <= 0) continue;
    /* the Ephemeris: unborn watches don't render; magnitude re-derives per year */
    let bornA = 1, glint = 0, magScale = 1;
    if (timeOn) {
      bornA = bornAlphaOf(w, TY);
      if (bornA <= 0) continue;
      glint = clamp(1 - (TY - w.year) / 1.2, 0, 1) * bornA;
      const dY = descAt(w, TY);
      if (dY < w._desc) magScale = magR(dY) / w._r;
    }
    const hov = hoverProgress(w.id, now);
    /* selection dim and lens dim never stack — the deeper one wins */
    const selFactor = isRel || !relSetForDim ? 1 : dimVal;
    const baseAlpha = rv.a * bornA * Math.min(selFactor, lensFactorOf(w, now));
    if (baseAlpha <= 0.005) continue;

    const relFull = sel && rel && rel.has(w.id);   /* related render at full tier detail */
    /* reduced motion: no scale transforms anywhere — glow ×2 + label carry the hover */
    const scale = (REDUCED ? 1 : 1 + 0.06 * hov) * rv.s;

    c.save();
    c.globalAlpha = baseAlpha;

    if (relFull) {
      const D = Math.max(glyphDiameter(z), 28) * scale;
      drawGlyph(c, w, x, y, D, 1, now);
      labelJobs.push({ w, x, y, R: D / 2, a: 1, yr: true, pri: Infinity });
    } else {
      /* star tier */
      if (A.star > 0.005) {
        c.save();
        c.globalAlpha *= A.star;
        const sM = scale * magScale;                 /* magnitude as of the chosen year */
        const g = glowSprite(w);
        const glowA = 1 + hov;                       /* hover: glow ×2 */
        c.globalAlpha *= Math.min(1, glowA);
        c.drawImage(g.c, x - g.R * sM, y - g.R * sM, g.R * 2 * sM, g.R * 2 * sM);
        if (hov > 0) {
          /* hover: glow alpha ×2 — a second pass scaled by hover progress */
          c.globalAlpha = baseAlpha * A.star * hov;
          c.drawImage(g.c, x - g.R * sM, y - g.R * sM, g.R * 2 * sM, g.R * 2 * sM);
          c.globalAlpha = baseAlpha * A.star;
        }
        c.fillStyle = mixed('star', w.dialColor);
        c.beginPath();
        c.arc(snap(x), snap(y), w._r * sM, 0, Math.PI * 2);
        c.fill();
        if (glint > 0.02) {
          /* ignition — a watch is new to the field for ~14 months */
          c.globalAlpha = baseAlpha * A.star * glint * 0.7;
          c.strokeStyle = LUME;
          c.lineWidth = 1;
          c.beginPath();
          c.arc(snap(x), snap(y), w._r * sM + 2.5, 0, Math.PI * 2);
          c.stroke();
        }
        c.restore();
      }
      /* glyph tier */
      if (A.glyph > 0.005) {
        c.save();
        c.globalAlpha *= A.glyph;
        const g = glowSprite(w);
        c.save();
        c.globalAlpha *= 0.5 * (1 + hov);
        c.drawImage(g.c, x - g.R, y - g.R, g.R * 2, g.R * 2);
        c.restore();
        const D = glyphDiameter(z) * scale;
        drawGlyph(c, w, x, y, D, A.t3, now);
        c.restore();
      }
      /* labels: tier 3 fade, or hover reveal below tier; hidden for unrelated during selection */
      const labelBase = Math.max(A.label, hov);
      const labA = labelBase * (relSetForDim && !isRel ? 0 : 1) * rv.a;
      if (labA > 0.01) {
        labelJobs.push({
          w, x, y,
          R: (A.glyph > 0.5 ? glyphDiameter(z) / 2 : w._r) * scale,
          a: labA, yr: hov > 0.5 && A.label < 0.5,
          pri: w._desc + (hov > 0 ? 1e6 : 0)
        });
      }
    }
    c.restore();
  }

  /* ---- pass 2: lineage curves ---- */
  if (sel) {
    drawLineage(c, sel.edges, now, sel.t0, sel.animLen, false);
  } else if (S.releasing) {
    const fadeP = clamp((now - S.releasing.t0) / (REDUCED ? 200 : 300), 0, 1);
    if (fadeP < 1) {
      c.save();
      c.globalAlpha = REDUCED ? 1 - fadeP : 1 - easeExit(fadeP);
      drawLineage(c, S.releasing.edges, now, 0, 0, true);
      c.restore();
    } else {
      S.releasing = null;
    }
  }

  /* ---- pass 3: selected ring + halo ---- */
  if (sel) {
    const w = S.byId.get(sel.id);
    if (w) {
      const [x, y] = toScreen(w.x, w.y);
      const R = glyphRadiusFor(w);
      const ringP = REDUCED ? clamp((now - sel.t0) / 200, 0, 1) : easeOut(clamp((now - sel.t0) / 240, 0, 1));
      const rr = (R + 6) * (REDUCED ? 1 : lerp(0.8, 1, ringP));
      c.save();
      c.globalAlpha = ringP;
      /* halo gradient cached on (x,y,R) — not rebuilt while the camera rests */
      let halo;
      if (!isExport && haloCache && haloCache.x === x && haloCache.y === y && haloCache.R === R) {
        halo = haloCache.grad;
      } else {
        halo = c.createRadialGradient(x, y, R, x, y, R + 20);
        halo.addColorStop(0, LUME_GLOW_0);
        halo.addColorStop(1, LUME_GLOW_1);
        if (!isExport) haloCache = { x, y, R, grad: halo };
      }
      c.fillStyle = halo;
      c.beginPath(); c.arc(x, y, R + 20, 0, Math.PI * 2); c.fill();
      c.strokeStyle = LUME;
      c.lineWidth = 1;
      c.beginPath(); c.arc(snap(x), snap(y), rr, 0, Math.PI * 2); c.stroke();
      c.restore();
    }
  }

  /* ---- pass 4: family labels, collision-culled by population ---- */
  if (famA > 0.01) {
    c.save();
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    setType(c, 11, 500, false, 0.18);
    const activeFamId = S.familyView ? S.familyView.id : null;
    const famJobs = [];
    for (const fam of S.families) {
      const [x, y] = toScreen(fam.x, fam.y);
      if (x < -160 || x > w_ + 160 || y < -60 || y > h_ + 60) continue;
      /* a family exists only once its first member does */
      let fA = 1;
      if (timeOn) {
        fA = clamp((TY - ((fam._minYear ?? S.yearMin) - 0.6)) / 0.6, 0, 1);
        if (fA <= 0.01) continue;
      }
      const lines = wrapFamily(fam.label || familyLabel(fam.id));
      let lw = 0;
      for (const ln of lines) lw = Math.max(lw, c.measureText(ln).width);
      famJobs.push({ fam, x, y, lines, fA, count: fam.count || 0, w: lw + 20, h: lines.length * 15 + 10 });
    }
    /* larger families win the space — a culled label returns as you zoom */
    famJobs.sort((a, b) => b.count - a.count);
    const famPlaced = [];
    for (const j of famJobs) {
      const rect = { x: j.x - j.w / 2, y: j.y - j.h / 2, w: j.w, h: j.h };
      let clash = false;
      for (const p of famPlaced) {
        if (rect.x < p.x + p.w && rect.x + rect.w > p.x && rect.y < p.y + p.h && rect.y + rect.h > p.y) { clash = true; break; }
      }
      if (clash) continue;
      famPlaced.push(rect);
      /* winners are the only doors — persist for hit-testing */
      if (!isExport) S.famLabelRects.push({ id: j.fam.id, label: j.fam.label, x: rect.x, y: rect.y, w: rect.w, h: rect.h, fA: j.fA });
      /* hover wakes the label text-3 → text-2; the open family's holds text-2
         (through the same 160/220ms ramp — no snap when opened via search)
         and stays exempt from the field dim — everyone else's recedes */
      const isActive = j.fam.id === activeFamId;
      const hp = Math.max(famHoverProgress(j.fam.id, now), famActiveProgress(j.fam.id, now));
      c.fillStyle = hp <= 0 ? TEXT_3 : hp >= 1 ? TEXT_2 : rgbStr([
        lerp(TEXT_3_RGB[0], TEXT_2_RGB[0], hp),
        lerp(TEXT_3_RGB[1], TEXT_2_RGB[1], hp),
        lerp(TEXT_3_RGB[2], TEXT_2_RGB[2], hp)
      ]);
      c.globalAlpha = famA * j.fA * (isActive ? 1 : dimVal);
      let ty = snap(j.y - (j.lines.length - 1) * 7.5);
      for (const ln of j.lines) { c.fillText(ln, snap(j.x), ty); ty += 15; }
    }
    c.restore();
  }

  /* label hover cannot outlive its label — wheel zoom past the tier, a scrub
     that unbirths the family, a collision cull, or a flight sliding the label
     out from under a stationary pointer all land here for re-validation */
  if (!isExport && S.famHoverId != null) {
    let still = false;
    for (const r of S.famLabelRects) {
      if (r.id === S.famHoverId && r.fA >= 0.5 &&
          lastPtrX >= r.x && lastPtrX <= r.x + r.w &&
          lastPtrY >= r.y && lastPtrY <= r.y + r.h) { still = true; break; }
    }
    if (!still) setFamHover(null);
  }

  /* ---- pass 5: watch labels, collision-culled by influence ---- */
  labelJobs.sort((a, b) => b.pri - a.pri);
  const placed = [];
  for (const j of labelJobs) {
    const bw = 120, bh = j.yr ? 46 : 32;
    const rect = { x: j.x - bw / 2, y: j.y + j.R + 6, w: bw, h: bh };
    let clash = false;
    for (const p of placed) {
      if (rect.x < p.x + p.w && rect.x + rect.w > p.x && rect.y < p.y + p.h && rect.y + rect.h > p.y) { clash = true; break; }
    }
    if (clash) continue;   /* loser keeps glyph, drops label */
    placed.push(rect);
    drawWatchLabel(c, j.w, j.x, j.y, j.R, j.a, j.yr);
  }

  drawReducedMorphVeil(c, w_, h_, now, isExport);
}

function paintVignette(c, w_, h_) {
  const R = Math.hypot(w_, h_) / 2;
  const r0 = Math.min(w_, h_) * 0.325;   /* outer 35% of min(w,h) */
  const g = c.createRadialGradient(w_ / 2, h_ / 2, r0, w_ / 2, h_ / 2, R);
  g.addColorStop(0, rgbaStr(VIGNETTE_RGB, 0));
  g.addColorStop(1, rgbaStr(VIGNETTE_RGB, 1));
  c.fillStyle = g;
  c.fillRect(0, 0, w_, h_);
}
function rebuildVignette() {
  vignetteCanvas = document.createElement('canvas');
  vignetteCanvas.width = Math.max(1, Math.round(W * dpr));
  vignetteCanvas.height = Math.max(1, Math.round(H * dpr));
  const vc = vignetteCanvas.getContext('2d');
  vc.scale(dpr, dpr);
  paintVignette(vc, W, H);
}

/* ======================================================================
   15 · EXPORT — the Plate
   ====================================================================== */

function doExport() {
  if (!S.loaded) return;
  closeLensPanel();
  S.exportMode = true;
  body.classList.add('export');
  elCartouche.hidden = false;

  const scale = 2;
  const oc = document.createElement('canvas');
  oc.width = W * scale; oc.height = H * scale;
  const octx = oc.getContext('2d');
  octx.scale(scale, scale);
  const savedDpr = dpr; dpr = scale;
  /* the plate composes about the true center — the on-screen panel offset
     is screen furniture, not part of the print */
  const savedCx = DS.cx, savedCy = DS.cy;
  if (S.mode === 'descent') { DS.cx = W / 2; DS.cy = H / 2; }
  draw(octx, W, H, performance.now(), true);
  if (S.mode === 'descent') { DS.cx = savedCx; DS.cy = savedCy; }
  dpr = savedDpr;

  /* cartouche, bottom-right, 24px inset, 12px padding, 1px keyline */
  octx.save();
  octx.textAlign = 'left';
  octx.textBaseline = 'alphabetic';
  setType(octx, 10, 500, false, 0.22);
  const l1 = 'THE HOROLOGICAL ATLAS';
  const l2 = elCart2.textContent;
  const w1 = octx.measureText(l1).width;
  setType(octx, 9, 400, true, 0);
  const w2 = octx.measureText(l2).width;
  const cw = Math.max(w1, w2) + 24, ch = 12 + 10 + 8 + 9 + 12;
  const cx = W - 24 - cw, cy = H - 24 - ch;
  octx.strokeStyle = 'rgba(233,237,242,0.08)';
  octx.lineWidth = 1;
  octx.strokeRect(cx + 0.5, cy + 0.5, cw, ch);
  octx.fillStyle = rgbaStr(INK_RGB, 0.92);
  setType(octx, 10, 500, false, 0.22);
  octx.fillText(l1, cx + 12, cy + 12 + 9);
  octx.fillStyle = TEXT_3;
  setType(octx, 9, 400, true, 0);
  octx.fillText(l2, cx + 12, cy + 12 + 10 + 8 + 8);
  octx.restore();

  oc.toBlob(blob => {
    if (!blob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const fname = S.mode === 'descent'
      ? 'horological-atlas-descent.png'
      : curTY < S.time.max - 1e-6
        ? `horological-atlas-${Math.round(curTY)}.png`
        : 'horological-atlas.png';
    a.download = fname;
    a.click();
    elLive.textContent = `Plate exported — ${fname}`;
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }, 'image/png');
}
function exitExport() {
  S.exportMode = false;
  elCartouche.hidden = true;
  body.classList.remove('export');
  invalidate();
}

/* ======================================================================
   15c · LIGHTBOX — the print room
   One image at full size on the dark field. Owns the keyboard while open;
   sits above every other layer and above the Esc ladder.
   ====================================================================== */

let lbItems = [], lbIdx = 0, lbPrevFocus = null, lbHideTimer = null;

function photoCredit(ph) {
  return `Photo ${ph.credit || 'Wikimedia Commons'}${ph.license ? ' · ' + ph.license : ''}`;
}

function lightboxOpen(items, idx) {
  if (!items || !items.length) return;
  hideFamPreview();
  lbItems = items;
  lbIdx = clamp(idx || 0, 0, items.length - 1);
  lbPrevFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  clearTimeout(lbHideTimer);
  elLightbox.hidden = false;
  lbRender(false);
  requestAnimationFrame(() => requestAnimationFrame(() => elLightbox.classList.add('on')));
  elLbClose.focus({ preventScroll: true });
}
function lbRender(swap) {
  const it = lbItems[lbIdx];
  if (!it) return;
  const apply = () => {
    elLbImg.src = it.src;
    elLbImg.alt = it.title || '';
    elLbTitle.textContent = it.title || '';
    elLbCredit.textContent = '';   /* credit/license recorded in catalog.json, not shown on-site */
    const many = lbItems.length > 1;
    elLbCount.textContent = many ? `${lbIdx + 1} / ${lbItems.length}` : '';
    elLbPrev.hidden = !many;
    elLbNext.hidden = !many;
  };
  if (swap && !REDUCED) {
    elLbImg.classList.add('swap');
    setTimeout(() => { apply(); elLbImg.classList.remove('swap'); }, 120);
  } else apply();
}
function lbStep(d) {
  if (lbItems.length < 2) return;
  lbIdx = (lbIdx + d + lbItems.length) % lbItems.length;
  lbRender(true);
}
function lightboxClose() {
  if (elLightbox.hidden) return;
  elLightbox.classList.remove('on');
  clearTimeout(lbHideTimer);
  lbHideTimer = setTimeout(() => {
    elLightbox.hidden = true;
    elLbImg.removeAttribute('src');
    lbItems = [];
  }, REDUCED ? 90 : 250);
  if (lbPrevFocus && document.contains(lbPrevFocus)) lbPrevFocus.focus({ preventScroll: true });
  lbPrevFocus = null;
}
elLbClose.addEventListener('click', lightboxClose);
elLbPrev.addEventListener('click', () => lbStep(-1));
elLbNext.addEventListener('click', () => lbStep(1));
elLightbox.addEventListener('click', e => { if (e.target === elLightbox) lightboxClose(); });

/* Direct manipulation — swipe the image to move through the gallery (touch/trackpad).
   A horizontal throw steps; anything else is left to tap-to-close. */
let lbSwipe = null;
elLbImg.addEventListener('pointerdown', e => {
  lbSwipe = { x: e.clientX, y: e.clientY };
  elLbImg.setPointerCapture?.(e.pointerId);
});
elLbImg.addEventListener('pointerup', e => {
  if (!lbSwipe) return;
  const dx = e.clientX - lbSwipe.x, dy = e.clientY - lbSwipe.y;
  lbSwipe = null;
  if (Math.abs(dx) > 44 && Math.abs(dx) > Math.abs(dy) * 1.4) lbStep(dx < 0 ? 1 : -1);
});
elLbImg.addEventListener('pointercancel', () => { lbSwipe = null; });

/* ======================================================================
   16 · INPUT
   ====================================================================== */

function anyInput() {
  skipReveal();
  hideFamPreview();    /* a preview never outlives the gesture that raised it */
  hideWatchPreview();
  resetIdleTimer();
}

const pointers = new Map();
let dragState = null;      /* {sx, sy, camX, camY, moved} */
let pinchState = null;     /* {d0, z0, mx, my} */
let lastPtrX = -1, lastPtrY = -1;   /* last known pointer position over the canvas —
                                       lets draw() re-validate label hover when zoom,
                                       scrub, cull, or a flight moves the label away */

canvas.addEventListener('pointerdown', e => {
  if (S.morph) return;                 /* input locked mid-morph — Esc and D reverse */
  anyInput();
  if (S.mode === 'descent') {
    /* grab the flywheel — the gesture owns s until release */
    canvas.setPointerCapture(e.pointerId);
    descDrag = { sy: e.clientY, lastY: e.clientY, lastT: performance.now(), moved: false };
    DS.phase = 'gesture';
    DS.v = 0;
    invalidate();
    return;
  }
  cancelFlight();
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 1) {
    dragState = { sx: e.clientX, sy: e.clientY, camX: S.cam.x, camY: S.cam.y, moved: false };
  } else if (pointers.size === 2) {
    dragState = null;
    const pts = [...pointers.values()];
    pinchState = {
      d0: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y),
      z0: S.cam.z,
      px: (pts[0].x + pts[1].x) / 2,
      py: (pts[0].y + pts[1].y) / 2
    };
  }
});
canvas.addEventListener('pointermove', e => {
  lastPtrX = e.clientX; lastPtrY = e.clientY;
  if (S.morph) return;
  if (S.mode === 'descent') {
    if (descDrag) {
      const now2 = performance.now();
      const dy = e.clientY - descDrag.lastY;
      descDrag.lastY = e.clientY;
      if (!descDrag.moved && Math.abs(e.clientY - descDrag.sy) > 4) {
        descDrag.moved = true;
        S.dragging = true;
        canvas.classList.add('grabbing');
        setHover(null);
      }
      if (descDrag.moved) {
        const dt = Math.max((now2 - descDrag.lastT) / 1000, 0.001);
        const ds = -dy / 64;                       /* 1 card per 64px — the vertical pitch, 1:1 */
        if (heroPullCheck(ds)) { descDrag = null; S.dragging = false; canvas.classList.remove('grabbing'); return; }
        const s0 = DS.s;
        DS.s = clamp(s0 + ds, 0, DS.n - 1);
        /* the EMA reads what actually moved — at the clamp the effective ds
           is 0, so no phantom velocity (and no ghost blur) builds at the stops */
        DS.v += 0.25 * ((DS.s - s0) / dt - DS.v);  /* EMA velocity, α = 0.25 per event */
        dismissDescentHint(now2);
        refreshFocus();
        invalidate();
      }
      descDrag.lastT = now2;
      return;
    }
    if (!S.dragging && S.loaded) {
      const hit = hitTest(e.clientX, e.clientY);
      setHover(hit ? hit.id : null, true);
      const ann = hit ? null : annHitTest(e.clientX, e.clientY);
      const ak = ann ? ann.k : -1;
      if (ak !== DS.annHover) {
        DS.annHover = ak;
        canvas.style.cursor = ann ? 'pointer' : '';
        invalidate();
      }
    }
    return;
  }
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

  if (pinchState && pointers.size === 2) {
    const pts = [...pointers.values()];
    const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    const mx = (pts[0].x + pts[1].x) / 2, my = (pts[0].y + pts[1].y) / 2;
    /* two-finger pan: translate with the midpoint, then zoom about it (map convention) */
    S.cam.x -= (mx - pinchState.px) / S.cam.z;
    S.cam.y -= (my - pinchState.py) / S.cam.z;
    pinchState.px = mx; pinchState.py = my;
    zoomAt(mx, my, (pinchState.z0 * (d / Math.max(pinchState.d0, 1))) / S.cam.z);
    return;
  }
  if (dragState && pointers.size === 1) {
    const dx = e.clientX - dragState.sx, dy = e.clientY - dragState.sy;
    if (!dragState.moved && Math.hypot(dx, dy) > 4) {
      dragState.moved = true;
      S.dragging = true;
      canvas.classList.add('grabbing');
      chromeDim(true);
    }
    if (dragState.moved) {
      S.cam.x = dragState.camX - dx / S.cam.z;
      S.cam.y = dragState.camY - dy / S.cam.z;
      clampCam();
      invalidate();
    }
    return;
  }
  /* hover — a star is smaller and more specific than a label; the specific wins */
  if (!S.dragging && S.loaded) {
    const hit = hitTest(e.clientX, e.clientY);
    setHover(hit ? hit.id : null, true);
    const famHit = hit ? null : famHitTest(e.clientX, e.clientY);
    setFamHover(famHit ? famHit.id : null);
  }
});
function endPointer(e) {
  if (S.mode === 'descent') {
    pointers.delete(e.pointerId);
    const dd = descDrag;
    descDrag = null;
    if (S.dragging) {
      S.dragging = false;
      canvas.classList.remove('grabbing');
    }
    if (!dd) return;
    if (!dd.moved && e.type === 'pointerup') {
      const hit = hitTest(e.clientX, e.clientY);
      const ann = hit ? null : annHitTest(e.clientX, e.clientY);
      if (hit) selectWatch(hit.id);
      /* a life-ladder mark opens its story — the one door out of the column */
      else if (ann) window.open(ann.url, '_blank', 'noopener');
      /* empty field keeps its meaning: let go of whatever you're holding */
      else if (S.selection) deselect();
      /* a tap on a card just started a helix glide (selectWatch →
         descentFlyToWatch) — never clobber it with settle/rest */
      if (DS.phase !== 'glide') {
        DS.glide = null;
        DS.phase = Math.abs(DS.s - Math.round(DS.s)) > 1e-6 ? 'settle' : 'rest';
      }
    } else {
      /* velocity carries — but only if the finger was still moving. A drag,
         a hold, then a release must settle in place, not fling off on the
         EMA frozen at the last movement: decay it by the pointer silence. */
      const idle = performance.now() - dd.lastT;
      if (idle > 90) DS.v = 0;
      else DS.v *= Math.exp(-idle / (dTau(dM(DS.s)) * 1000));   /* same water as the coast (§18c) */
      DS.glide = null;
      DS.phase = 'coast';
    }
    DS.lastT = performance.now();
    invalidate();
    return;
  }
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinchState = null;
  if (pointers.size === 0) {
    const wasDrag = dragState && dragState.moved;
    if (S.dragging) {
      S.dragging = false;
      canvas.classList.remove('grabbing');
      chromeDim(false);
    }
    if (!wasDrag && dragState && e.type === 'pointerup') {
      const hit = hitTest(e.clientX, e.clientY);
      const famHit = hit ? null : famHitTest(e.clientX, e.clientY);
      if (hit) selectWatch(hit.id);
      else if (famHit) openFamily(famHit.id);
      /* empty field keeps its meaning: let go of whatever you're holding */
      else if (S.selection) { releaseFamActive(); S.familyView = null; deselect(); }
      else closeFamily();
    }
    dragState = null;
  }
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('pointerleave', () => {
  lastPtrX = -1; lastPtrY = -1;
  if (!S.dragging) { setHover(null); setFamHover(null); }
  if (DS.annHover !== -1) { DS.annHover = -1; canvas.style.cursor = ''; invalidate(); }
});

canvas.addEventListener('dblclick', e => {
  if (S.mode !== 'sky' || S.morph) return;   /* fit is a sky gesture */
  anyInput();
  /* a double-click on a family label already opened the family — no zoom-reset */
  if (!hitTest(e.clientX, e.clientY) && !famHitTest(e.clientX, e.clientY)) fitAll();
});

canvas.addEventListener('wheel', e => {
  e.preventDefault();
  if (S.morph) return;
  anyInput();
  if (S.mode === 'descent') {             /* wheel is the descent line, not a zoom */
    descentWheel(e.deltaY);
    return;
  }
  cancelFlight();
  const k = e.ctrlKey ? 0.011 : 0.0024;   /* trackpad pinch arrives as ctrl+wheel */
  const factor = Math.exp(-e.deltaY * k);
  zoomAt(e.clientX, e.clientY, factor);
  chromeDim(true); chromeDim(false);
}, { passive: false });

function zoomAt(sx, sy, factor) {
  const [wx, wy] = toWorld(sx, sy);
  S.cam.z = clamp(S.cam.z * factor, S.fitZ, Z_MAX);
  /* keep the world point under the pointer fixed */
  S.cam.x = wx - (sx - W / 2) / S.cam.z - S.drift.x / S.cam.z;
  S.cam.y = wy - (sy - H / 2) / S.cam.z - S.drift.y / S.cam.z;
  clampCam();
  invalidate();
}

function zoomStep(dir) {
  /* compound from any pending reduced-motion cut, not the stale camera */
  const b = pendingCam || S.cam;
  const target = clamp(b.z * (dir > 0 ? 1.6 : 1 / 1.6), S.fitZ, Z_MAX);
  flyTo(b.x, b.y, target, 240, easeOut);
}
function panStep(dx, dy) {
  const b = pendingCam || S.cam;
  flyTo(b.x + dx / b.z, b.y + dy / b.z, b.z, 240, easeOut);
}

elFitChip.addEventListener('click', () => {
  /* a hidden chip stays inert — Enter on stale focus must not fly the sky camera under descent/export */
  if (S.mode !== 'sky' || S.morph || S.exportMode) return;
  anyInput(); fitAll();
});
elPanelClose.addEventListener('click', () => {
  anyInput();
  /* the close button closes the panel outright — chain and all */
  if (S.selection) { releaseFamActive(); S.familyView = null; deselect(); }
  else closeFamily();
});

window.addEventListener('keydown', e => {
  const t = e.target;
  const inInput = t === elSearchInput || /^(input|textarea|select)$/i.test((t && t.tagName) || '');
  /* single-letter shortcuts never fire from a focused control — no surprise
     mode changes while tabbed onto the fit chip, panel close, lineage rows,
     or the div-based sliders (year track, price thumbs: role="slider") */
  const inControl = t instanceof Element &&
    (t.isContentEditable || /^(input|textarea|select|button)$/i.test(t.tagName || '') ||
     t.getAttribute('role') === 'slider');
  /* arrows belong to the panel's scroll/focus when focus is inside chrome */
  const inChrome = t instanceof Element &&
    (elPanel.contains(t) || elSearch.contains(t) || elTimeline.contains(t) || elLensPanel.contains(t));
  anyInput();

  /* the lightbox owns the keyboard while open — above the whole ladder */
  if (!elLightbox.hidden) {
    if (e.key === 'Escape') { e.preventDefault(); lightboxClose(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); lbStep(-1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); lbStep(1); }
    return;
  }

  /* mid-morph the keyboard holds its breath — Esc and D retrace the flight */
  if (S.morph) {
    if (e.key === 'Escape') { e.preventDefault(); reverseMorph(); }
    else if ((e.key === 'd' || e.key === 'D') && !inInput && !inControl) reverseMorph();
    return;
  }

  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    /* search chrome is hidden in export and manual observatory — never open
       it blind (anyInput above already woke an idle observatory) */
    if (S.exportMode || body.classList.contains('observatory')) return;
    searchOpen ? closeSearch() : openSearch();
    return;
  }
  if (inInput) return;   /* search input handles its own keys */
  if (e.metaKey || e.ctrlKey || e.altKey) return;   /* never shadow browser shortcuts */

  switch (e.key) {
    case '/':
      if (inControl || S.exportMode || body.classList.contains('observatory')) break;
      e.preventDefault(); openSearch(); break;
    case 'Escape':
      /* descent ladder: (lightbox above) → export → search → watch panel → surface */
      if (S.mode === 'descent') {
        if (S.exportMode) exitExport();
        else if (searchOpen) closeSearch();
        else if (S.selection) deselect();
        else toggleDescent();                    /* Esc surfaces — the reverse morph */
        break;
      }
      /* sky ladder: export → lens panel → search → watch (→ family if chained) → family → lens → time */
      if (S.exportMode) exitExport();
      else if (lensOpen) closeLensPanel();
      else if (searchOpen) closeSearch();
      else if (S.selection) (S.familyView && S.familyView.chained) ? returnToFamily() : deselect();
      else if (S.familyView) closeFamily();
      else if (lensActive()) lensClear();
      else if (S.loaded && timeEngaged()) returnToPresent();
      break;
    case ' ':
      if (inControl || inChrome || S.mode !== 'sky') break;
      e.preventDefault();
      togglePlay();
      break;
    case 'f': case 'F': case '0':
      if (inControl || S.mode !== 'sky') break;
      fitAll(); break;
    case '+': case '=':
      if (inControl || S.mode !== 'sky') break;
      zoomStep(1); break;
    case '-': case '_':
      if (inControl || S.mode !== 'sky') break;
      zoomStep(-1); break;
    case 'h': case 'H':
      if (inControl || S.mode !== 'sky') break;
      toggleObservatory(); break;
    case 'e': case 'E':
      if (inControl) break;
      S.exportMode ? exitExport() : doExport(); break;
    case 'd': case 'D':
      if (inControl) break;
      toggleDescent(); break;
    case 'ArrowLeft':
      if (inControl || inChrome || S.mode !== 'sky') break;
      e.preventDefault(); panStep(-64, 0); break;
    case 'ArrowRight':
      if (inControl || inChrome || S.mode !== 'sky') break;
      e.preventDefault(); panStep(64, 0); break;
    case 'ArrowUp':
      if (inControl || inChrome) break;
      e.preventDefault();
      S.mode === 'descent' ? descentStep(-1) : panStep(0, -64); break;
    case 'ArrowDown':
      if (inControl || inChrome) break;
      e.preventDefault();
      S.mode === 'descent' ? descentStep(1) : panStep(0, 64); break;
    case 'PageUp':
      if (inControl || inChrome || S.mode !== 'descent') break;
      e.preventDefault(); descentStratumStep(-1); break;
    case 'PageDown':
      if (inControl || inChrome || S.mode !== 'descent') break;
      e.preventDefault(); descentStratumStep(1); break;
    case 'Home':
      if (inControl || inChrome || S.mode !== 'descent') break;
      e.preventDefault(); descentFlyToIndex(0); break;
    case 'End':
      if (inControl || inChrome || S.mode !== 'descent') break;
      e.preventDefault(); descentFlyToIndex(DS.n - 1); break;
  }
});

for (const evt of ['pointerdown', 'wheel', 'keydown', 'touchstart']) {
  window.addEventListener(evt, resetIdleTimer, { passive: true });
}

/* ======================================================================
   18 · THE DESCENT — the same watches, ranked by depth
   A second projection of the one dataset: a vertical helix ordered by
   water resistance, shallow first. Scrolling descends through strata the
   way a dive does; the wheel coasts and settles dead-beat on a card —
   the Ephemeris detent is the house physics. Cards are specimen plates:
   catalog render → editorial → drawn glyph, all on one shared ground.
   ====================================================================== */

const elMtSky = $('mt-sky'), elMtDescent = $('mt-descent');
const elTagline = $('tagline');
/* the masthead is honest to the projection you're standing in (§design-review) */
const TAGLINE_SKY = 'A map of dive-watch design, arranged by kinship — brightness is influence.';
const TAGLINE_DESCENT = 'Every dive watch ranked by the depth it survives — the surface to the Mariana floor.';

const CARD_W = 244, CARD_H = 163;              /* 3:2 plate at scale 1 — sized so the focused hero fills the frame like a magazine spread (pacomepertant-scale) */
/* the focus bloom — the detent's reward. The card nearest the fractional
   scroll swells so the watch can actually be enjoyed; prox² concentrates
   the swell at the landing, so scrolling never pops, it breathes. */
const FOCUS_BLOOM = 0.55;                      /* +55% at perfect center */
const bloomOf = t => 1 + FOCUS_BLOOM * t * t;  /* t = clamp(1 − |i−s|, 0..1) */
const SPRS_IMG = 3;  /* photography sprites at 3× — the bloomed hero stays sharp on retina;
                        glyph plates keep SPRS (linework survives modest upscale, memory doesn't) */
const SPRS = 2;   /* sprite resolution — fixed at 2× logical (spec §3: 336×224). The spec's
                     dpr cap bounds the ceiling, not the floor: flanking cards minify from
                     0.40–0.90, so a 1× source softens every plate on 1× displays; and a
                     fixed value never goes stale when the window crosses to another dpr. */
const HELIX_DTH = Math.PI * 2 / 9;             /* 9 cards per turn */
const PITCH = 93, SHELF = 80;                  /* vertical pitch; extra shelf at band boundaries — scaled with the larger plates */
/* inertia decay time-constant is depth-keyed since the water column (§18c):
   τ = 150 + 30·(1 − (d/11000)^0.35) ms — 174ms at the shallowest card,
   150ms at the hadal floor. See dTau(). The settle spring is untouched. */
const D_OMEGA = 12;                            /* settle spring, rad/s, ζ = 1 — zero overshoot */
const BLUR_V = 1.5;                            /* cards/s — blur exists only above this */

const DS = {
  order: [], n: 0,
  sh: null,                      /* shelves-before per depth index */
  shelfIdx: [], shelfLabel: [],  /* band boundaries + their ruler copy */
  wrCount: new Map(),            /* exact-WR population, for the depth gauge */
  s: 0, v: 0,                    /* scroll position (card units) + velocity (cards/s) */
  phase: 'rest',                 /* rest | gesture | coast | settle | glide */
  glide: null,                   /* {from,to,t0,dur,ease} — keyboard/search flights */
  lastT: 0, emaT: 0, wheelTimer: null,
  sprites: new Map(),            /* id -> {base, img, imgT0, pending, fail} — LRU */
  loading: new Set(),
  built: 0,                      /* morph prebuild cursor */
  lastFocus: -1,
  pillText: '', gaugeText: '',
  rects: [],                     /* hit rects this frame — pooled objects, rear→front */
  annRectN: 0, annHover: -1,     /* life-ladder marks — clickable engravings (§18e) */
  cx: 0, cxA: null, cy: 0, cyA: null,   /* 400ms panel-offset glides */
  rampUntil: 0,                  /* image alpha-ramp horizon for the scheduler */
  hintSeen: false, hintT0: 0,    /* wheel affordance — whispers until the first dive gesture */
  full: null, reflow: null,      /* full census (Lens narrows a view of it) + FLIP reflow state */
  /* §18c — the water column */
  wrM: null,                     /* Float32Array — metres per depth index, for dM() */
  annY: null, annLabel: [],      /* depth annotations — world y + copy, placed once */
  annW: null, shelfW: null,      /* label widths, measured once — no per-frame TextMetrics */
  snow: null,                    /* Float32Array(28×4) — xFrac, yFrac, alpha, fall px/s */
  snowClock: 0,                  /* seconds of accumulated drift — never wall-clock */
  bubClock: 0,                   /* §18c — monotonic px of bubble RISE; only ever grows,
                                    so the wake is always up regardless of scroll direction */
  snowUntil: 0,                  /* the 4s post-settle tail the scheduler honors */
  snowWrap: 0,                   /* world wrap height — H + 240, kept by resize() */
  bub: null,                     /* Float32Array(18×5) — xFrac, yFrac, alpha, rise px/s, diameter */
  bio: null                      /* Float32Array(8×6) — xFrac, yFrac, period, pulsePh, driftPh, peakA */
};
S.descent = DS;

let descDrag = null;             /* {sy, lastY, lastT, moved} — touch/drag scrub */

/* preallocated draw + hit pools — a scroll frame allocates nothing */
const dSlots = Array.from({ length: 21 }, () => ({ i: 0, phi: 0, d: 0, sc: 0, al: 0, x: 0, y: 0 }));
const dRectPool = Array.from({ length: 21 }, () => ({ id: null, x: 0, y: 0, w: 0, h: 0 }));
/* life-ladder marks — at most one rect per silhouette entry per frame */
const dAnnPool = Array.from({ length: 8 }, () => ({ k: -1, url: '', x: 0, y: 0, w: 0, h: 0 }));

/* one grouping convention product-wide — 4+ digit metres take the comma, so
   the shelf ruler, the gauge, the pill, and the annotations all agree */
const fmtM = m => (m || 0).toLocaleString('en-US');

function initDescent() {
  /* depth order: WR ascending, year within ties, id for stability. The full
     census is kept; the Lens can narrow the active view to a subset of it. */
  DS.full = [...S.watches].sort((a, b) =>
    (a.waterResistanceM || 0) - (b.waterResistanceM || 0) ||
    (a.year || 0) - (b.year || 0) ||
    String(a.id).localeCompare(String(b.id)));
  initMarineSnow();                 /* seeded once — view-independent drift */
  initBubbles();                    /* §18c amendment — the wake, seeded once */
  initBiolum();                     /* §18c amendment — the deep's own light, seeded once */
  /* §18d — the sounding line must be measurable BEFORE descentDerive sizes it:
     a display:none rail reads 0×0 and the canvas/labels build empty (v35 bug) */
  elSounding.hidden = false;
  descentDerive(DS.full);
}

/* rebuild every index-keyed structure for a given order — the full census or a
   lens-narrowed subset. The Descent's whole geometry keys off this. */
function descentDerive(order) {
  DS.order = order;
  DS.n = order.length;
  DS.sh = new Uint8Array(DS.n);
  DS.shelfIdx.length = 0;
  DS.shelfLabel.length = 0;
  DS.wrCount.clear();
  /* strata from the actual distribution: ≤135 · 150–220 · 300 · 500–610 · 1000–1300 · 2000+ */
  const bandOf = wr => wr <= 135 ? 0 : wr <= 220 ? 1 : wr <= 300 ? 2 : wr <= 610 ? 3 : wr <= 1300 ? 4 : 5;
  const bandM = [0, 150, 300, 500, 1000, 2000];
  let prev = 0, shelves = 0;
  order.forEach((w, i) => {
    w._di = i;
    const b = bandOf(w.waterResistanceM || 0);
    if (i > 0 && b !== prev) {
      shelves++;
      DS.shelfIdx.push(i);
      DS.shelfLabel.push(`— ${fmtM(bandM[b])} M —`);
    }
    prev = b;
    DS.sh[i] = shelves;
    DS.wrCount.set(w.waterResistanceM, (DS.wrCount.get(w.waterResistanceM) || 0) + 1);
  });
  /* §18c — the water column depth table + the depth annotations, per view */
  DS.wrM = new Float32Array(DS.n);
  for (let i = 0; i < DS.n; i++) DS.wrM[i] = order[i].waterResistanceM || 0;
  initDepthAnnotations();
  elSounding.setAttribute('aria-valuemax', String(Math.max(0, DS.n - 1)));
  sizeSounding();
}

/* the active Descent view — full census, or the Lens-matching subset */
function descentView() {
  return lensActive() ? DS.full.filter(w => lensMatch(w, null)) : DS.full;
}

/* the Lens NARROWS the Descent: non-matching watches are removed and the
   survivors close ranks. A FLIP reflow carries every surviving card from its
   old berth to its new one; the departed sink away and fade. Apple's continuity
   — objects that persist move, they don't pop. */
function applyDescentNarrow(animated) {
  if (!DS.full || !DS.full.length) return;
  const now = performance.now();
  const hadN = DS.n;
  const oldY0 = hadN ? dYs(DS.s) : 0;
  const focusW = hadN ? DS.order[clamp(Math.round(DS.s), 0, hadN - 1)] : null;
  const oldFocusId = focusW ? focusW.id : null;
  const oldPos = new Map(), oldIds = new Set();
  for (const w of DS.order) {
    oldPos.set(w.id, { y: dYof(w._di), phi: (w._di - DS.s) * HELIX_DTH });
    oldIds.add(w.id);
  }

  const view = descentView();
  const newIds = new Set();
  for (const w of view) newIds.add(w.id);
  descentDerive(view);

  /* keep the focused watch centred; else the kept watch nearest the old gaze */
  let ns = 0;
  if (oldFocusId != null && newIds.has(oldFocusId)) {
    ns = S.byId.get(oldFocusId)._di;
  } else if (DS.n) {
    let best = 0, bestD = Infinity;
    for (const w of view) {
      const op = oldPos.get(w.id);
      const oy = op ? op.y : dYof(w._di);
      const d = Math.abs(oy - oldY0);
      if (d < bestD) { bestD = d; best = w._di; }
    }
    ns = best;
  }
  DS.s = clamp(ns, 0, Math.max(0, DS.n - 1));
  DS.v = 0; DS.phase = 'rest'; DS.glide = null; DS.lastFocus = -1;
  refreshFocus();

  if (animated && !REDUCED && (oldIds.size || newIds.size)) {
    DS.reflow = { t0: now, dur: 640, oldY0, oldPos,
      exit: DS.full.filter(w => oldIds.has(w.id) && !newIds.has(w.id)) };
  } else {
    DS.reflow = null;
  }
  if (descentChromeOn) elFooterGauge.textContent = DS.gaugeText;
  updateNoMatch();
  invalidate();
}

/* --- vertical metric — pitch plus shelves, continuous in s ------------- */
const dYof = i => i * PITCH + DS.sh[i] * SHELF;
function dYs(x) {
  if (DS.n <= 0) return 0;
  x = clamp(x, 0, DS.n - 1);
  const i0 = Math.floor(x);
  const i1 = Math.min(i0 + 1, DS.n - 1);
  return lerp(dYof(i0), dYof(i1), x - i0);
}

/* --- layout centers — the panel shifts the helix, 400ms ease-glide ----- */
function descTargetCX() {
  return (!elPanel.hidden && window.innerWidth > 760) ? (W - 360) / 2 : W / 2;
}
function descTargetCY() {
  return (!elPanel.hidden && window.innerWidth <= 760) ? H * 0.34 : H / 2;
}
function axisTick(key, target, now) {
  const ak = key + 'A';
  let a = DS[ak];
  if (!a) {
    if (Math.abs(DS[key] - target) < 0.5) { DS[key] = target; return target; }
    a = DS[ak] = { from: DS[key], to: target, t0: now };
  } else if (Math.abs(a.to - target) > 0.5) {
    a.from = DS[key]; a.to = target; a.t0 = now;
  }
  const p = clamp((now - a.t0) / 400, 0, 1);
  DS[key] = lerp(a.from, a.to, REDUCED ? 1 : easeGlide(p));
  if (p >= 1) { DS[key] = a.to; DS[ak] = null; }
  return DS[key];
}

/* --- specimen plates — one material for the whole census ---------------- */
function roundRectPath(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
function plateBorder(g) {
  roundRectPath(g, 0.5, 0.5, CARD_W - 1, CARD_H - 1, 7.5);
  g.strokeStyle = 'rgba(233,237,242,0.08)';
  g.lineWidth = 1;
  g.stroke();
}
function buildBaseSprite(w) {
  /* the glyph plate — never an empty state */
  const c = document.createElement('canvas');
  c.width = CARD_W * SPRS; c.height = CARD_H * SPRS;
  const g = c.getContext('2d');
  g.scale(SPRS, SPRS);
  roundRectPath(g, 0, 0, CARD_W, CARD_H, 8);
  g.save();
  g.clip();
  g.fillStyle = '#0D1117';                     /* the img-catalog plating tone (--surface-1) */
  g.fillRect(0, 0, CARD_W, CARD_H);
  drawGlyph(g, w, CARD_W / 2, CARD_H / 2, 72, 0, performance.now());
  g.restore();
  plateBorder(g);
  return c;
}
function buildImgSprite(img, isCatalog) {
  const c = document.createElement('canvas');
  c.width = CARD_W * SPRS_IMG; c.height = CARD_H * SPRS_IMG;
  const g = c.getContext('2d');
  g.scale(SPRS_IMG, SPRS_IMG);
  roundRectPath(g, 0, 0, CARD_W, CARD_H, 8);
  g.save();
  g.clip();
  g.fillStyle = '#0D1117';
  g.fillRect(0, 0, CARD_W, CARD_H);
  const iw = img.naturalWidth || 1, ih = img.naturalHeight || 1;
  const k = Math.max(CARD_W / iw, CARD_H / ih);   /* cover-fit */
  g.drawImage(img, (CARD_W - iw * k) / 2, (CARD_H - ih * k) / 2, iw * k, ih * k);
  /* editorial photography gets a 12% field scrim to pull it onto the plate;
     catalog renders arrive already dark-plated */
  if (!isCatalog) {
    g.fillStyle = 'rgba(6,8,11,0.12)';
    g.fillRect(0, 0, CARD_W, CARD_H);
  }
  g.restore();
  plateBorder(g);
  return c;
}
function getSprite(w) {
  let rec = DS.sprites.get(w.id);
  if (rec) {
    /* LRU touch */
    DS.sprites.delete(w.id);
    DS.sprites.set(w.id, rec);
    return rec;
  }
  rec = { base: buildBaseSprite(w), img: null, imgT0: 0, pending: false, fail: false };
  DS.sprites.set(w.id, rec);
  /* cap 160: the morph draws every plate in its final frames, so the whole
     set must stay resident — a 96 cap would thrash rebuilds mid-showpiece */
  if (DS.sprites.size > 160) {
    DS.sprites.delete(DS.sprites.keys().next().value);
  }
  return rec;
}
let imgSweep = 0;
function maybeLoadImages() {
  /* img layers live only near the line — the |i−s| ≤ 24 load window plus
     hysteresis. Bases stay resident (the morph draws every plate); the
     photography is evicted once it falls ~2 strata behind, restoring the
     spirit of the spec's 96-cap without thrashing the showpiece. */
  if (++imgSweep >= 90) {
    imgSweep = 0;
    for (const [id, rec] of DS.sprites) {
      if (!rec.img) continue;
      const w = S.byId.get(id);
      if (w && Math.abs(w._di - DS.s) > 40) { rec.img = null; rec.imgT0 = 0; }
    }
  }
  if (DS.loading.size >= 6) return;             /* max 6 concurrent decodes */
  const c0 = Math.max(0, Math.round(DS.s) - 24);
  const c1 = Math.min(DS.n - 1, Math.round(DS.s) + 24);   /* ~2 strata of viewport */
  for (let i = c0; i <= c1; i++) {
    if (DS.loading.size >= 6) break;
    const w = DS.order[i];
    const rec = getSprite(w);
    if (rec.img || rec.fail || rec.pending) continue;
    /* specimen layer only — raw editorial never rides a card (one material) */
    const cat = CATALOG[w.id] && CATALOG[w.id].file;
    if (!cat) { rec.fail = true; continue; }
    rec.pending = true;
    DS.loading.add(w.id);
    const img = new Image();
    img.src = './data/' + cat;
    img.decode().then(() => {
      rec.img = buildImgSprite(img, !!cat);
      rec.imgT0 = performance.now();            /* 240ms alpha-ramp over the glyph plate */
      DS.rampUntil = Math.max(DS.rampUntil, rec.imgT0 + 240);
    }).catch(() => { rec.fail = true; })
      .finally(() => {
        rec.pending = false;
        DS.loading.delete(w.id);
        invalidate();
      });
  }
}
function drawCardSprite(c, w, x, y, wd, ht, alpha, now) {
  if (alpha <= 0.004) return;
  const rec = getSprite(w);
  if (rec.img) {
    const t = REDUCED ? 1 : clamp((now - rec.imgT0) / 240, 0, 1);
    if (t >= 1) {
      c.globalAlpha = alpha;
      c.drawImage(rec.img, x, y, wd, ht);
      return;
    }
    c.globalAlpha = alpha;
    c.drawImage(rec.base, x, y, wd, ht);
    c.globalAlpha = alpha * t;
    c.drawImage(rec.img, x, y, wd, ht);
    return;
  }
  c.globalAlpha = alpha;
  c.drawImage(rec.base, x, y, wd, ht);
}

/* --- physics — gesture → coast → dead-beat settle ---------------------- */
function descentWheel(dy) {
  const now = performance.now();
  const dt = clamp((now - (DS.emaT || now - 16)) / 1000, 0.008, 0.2);
  DS.emaT = now;
  const ds = dy / 480;                          /* 1/480 cards per px, ctrl+wheel identical */
  if (heroPullCheck(ds)) return;                /* pulling up at the top resurfaces the hero */
  const s0 = DS.s;
  DS.s = clamp(s0 + ds, 0, DS.n - 1);
  /* feed the EMA the effective (post-clamp) motion — wheeling against the
     top/bottom stop must not build phantom velocity and streak static cards */
  DS.v += 0.25 * ((DS.s - s0) / dt - DS.v);     /* EMA velocity, α = 0.25 */
  dismissDescentHint(now);
  DS.phase = 'gesture';
  DS.glide = null;
  DS.lastT = now;
  setHover(null);
  clearTimeout(DS.wheelTimer);
  DS.wheelTimer = setTimeout(() => {
    if (DS.phase === 'gesture' && S.mode === 'descent' && !S.morph) {
      DS.phase = 'coast';
      DS.lastT = performance.now();
      invalidate();
    }
  }, 120);                                       /* 120ms wheel silence hands off to inertia */
  refreshFocus();
  invalidate();
}
function stepDescent(now) {
  if (S.mode !== 'descent' || S.morph) return;
  const rawDt = (now - (DS.lastT || now)) / 1000;
  const dt = Math.min(rawDt, 0.05);                /* the physics clamp */
  DS.lastT = now;
  /* §18c — marine snow drifts on accumulated dt only (jump-free freeze and
     resume, no wall-clock in the position formula). Its clamp is looser
     than the physics one: the 4s tail frames at ~10fps (100ms gaps), and
     clamping those to 50ms would halve the fall rate exactly when the eye
     is parked. Reduced motion: static. */
  if (!REDUCED && DS.snow && (DS.phase !== 'rest' || DS.reflow || now < DS.snowUntil)) {
    const dtc = Math.min(rawDt, 0.15);
    DS.snowClock += dtc;
    /* the wake rises faster the harder you move through the water — |v|, rectified */
    DS.bubClock += (BUB_RISE_BASE + BUB_RISE_GUST * Math.min(Math.abs(DS.v), BUB_VCAP)) * dtc;
  }
  if (DS.phase === 'rest' || DS.phase === 'gesture') return;
  if (DS.phase === 'glide') {
    const g = DS.glide;
    const p = clamp((now - g.t0) / g.dur, 0, 1);
    const prev = DS.s;
    DS.s = lerp(g.from, g.to, g.ease(p));
    DS.v = dt > 0 ? (DS.s - prev) / dt : 0;      /* blur reads real velocity, even scripted */
    if (p >= 1) {
      DS.s = g.to;
      const asc = g.ascent;          /* read before descentSettled() nulls the glide */
      descentSettled();
      /* only a completed ascent breaks the surface. Any interruption clears
         DS.glide, so an ascent the user cut short can never fire this later. */
      if (asc && Math.round(DS.s) === 0) surfaceBreak();
    }
  } else if (DS.phase === 'coast') {
    /* §18c pressure in the hand — τ thickens 174→150ms with depth; felt,
       not seen. Applies under reduced motion too: it is state, not motion. */
    DS.v *= Math.exp(-dt / dTau(dM(DS.s)));
    DS.s += DS.v * dt;
    if (DS.s <= 0 || DS.s >= DS.n - 1) {
      DS.s = clamp(DS.s, 0, DS.n - 1);
      DS.v = 0;
    }
    if (Math.abs(DS.v) < 0.5) DS.phase = 'settle';   /* the detent engages */
  } else if (DS.phase === 'settle') {
    /* critically damped to the nearest card — lands ~400ms, zero overshoot */
    const nT = clamp(Math.round(DS.s), 0, DS.n - 1);
    DS.v += (-D_OMEGA * D_OMEGA * (DS.s - nT) - 2 * D_OMEGA * DS.v) * dt;
    DS.s += DS.v * dt;
    if (Math.abs(DS.s - nT) < 0.002 && Math.abs(DS.v) < 0.02) {
      DS.s = nT;
      descentSettled();
    }
  }
  refreshFocus();
}
function descentSettled() {
  DS.v = 0;
  DS.phase = 'rest';
  DS.glide = null;
  /* §18c — the water keeps living for 4s after the detent lands, at 10fps,
     then freezes in place: idle CPU is exactly pre-water-column. The tail
     is scheduled only where something would show: snow above ~2500m
     (wcSnowK), bioluminescence below 1000m (wcBioK) — the amendment gave
     the hadal dark its own 4s of life before it, too, goes still. */
  scheduleWaterTail(performance.now());
  refreshFocus();
  const w = DS.order[clamp(Math.round(DS.s), 0, DS.n - 1)];
  if (w) elLive.textContent = `${w.brand} ${w.model}, ${w.waterResistanceM} metres.`;
}
function refreshFocus() {
  if (!DS.n) {                                   /* the Lens filtered everything out */
    DS.pillText = '';
    DS.gaugeText = 'No watches match — clear a filter';
    DS.lastFocus = -1;
    if (descentChromeOn) elFooterGauge.textContent = DS.gaugeText;
    return;
  }
  const n = clamp(Math.round(DS.s), 0, DS.n - 1);
  if (n === DS.lastFocus) return;               /* strings rebuilt only on focus change */
  DS.lastFocus = n;
  /* the wordmark stops advertising a trip you have already taken (n changes
     exactly when this guard falls through, so this costs nothing per frame) */
  { const wm = $('wordmark');
    if (wm) { wm.classList.toggle('at-surface', n === 0);
              wm.setAttribute('aria-disabled', n === 0 ? 'true' : 'false'); } }
  const w = DS.order[n];
  const pillRef = w.reference ? ` · REF. ${String(w.reference).toUpperCase()}` : '';
  DS.pillText = `${String(w.brand || '').toUpperCase()} ${String(w.model || '').toUpperCase()}${pillRef} · ${fmtM(w.waterResistanceM)} M`;
  const cnt = DS.wrCount.get(w.waterResistanceM) || 1;
  DS.gaugeText = `−${fmtM(w.waterResistanceM)} M · ${cnt} ${cnt === 1 ? 'watch' : 'watches'} at this depth`;
  if (descentChromeOn) elFooterGauge.textContent = DS.gaugeText;
}

/* --- scripted flights — keyboard steps, strata jumps, search ------------ */
function descentGlideTo(i, dur, ease) {
  i = clamp(i, 0, DS.n - 1);
  dismissDescentHint(performance.now());   /* any navigation retires the whisper */
  if (REDUCED) {
    DS.s = i;
    descentSettled();
    invalidate();
    return;
  }
  DS.glide = { from: DS.s, to: i, t0: performance.now(), dur: Math.max(dur, 1), ease: ease || easeGlide };
  DS.phase = 'glide';
  DS.lastT = performance.now();
  invalidate();
}
function descentStep(d) {
  const base = DS.phase === 'glide' && DS.glide ? DS.glide.to : DS.s;
  descentGlideTo(Math.round(base) + d, 240, easeOut);
}
function descentStratumStep(d) {
  const n = clamp(Math.round(DS.s), 0, DS.n - 1);
  const k = clamp(DS.sh[n] + d, 0, DS.shelfIdx.length);
  const target = k <= 0 ? 0 : DS.shelfIdx[k - 1];
  descentFlyToIndex(target);
}
function descentFlyToIndex(i) {
  descentGlideTo(i, Math.min(600 + 40 * Math.abs(i - DS.s), 1400), easeGlide);
}
/* ---- THE ASCENT — the wordmark returns you to the surface ---------------
   HIG, in order of what it cost to get right:

   Agency      the rise is interruptible at any instant. Every gesture path
               (pointer 3890, wheel 4596, sounding 4861) already clears
               DS.glide and claims phase='gesture', so a wheel tick mid-ascent
               hands control back on the same frame. Nothing to add — but it
               is the reason this is a glide and not a bespoke animator.
   Craft       duration scales with the SQUARE ROOT of distance, not linearly.
               Linear makes a 5-card hop feel sluggish and a 143-card haul feel
               interminable; sqrt keeps the near trip snappy (~700ms) and the
               full climb from the hadal floor a journey you can watch (~1.45s)
               without ever crossing into waiting.
   Familiarity the wake is real: the glide writes true per-frame velocity into
               DS.v (stepDescent 4633), which the bubble column already reads
               (BUB_RISE_GUST) — so a fast ascent blows a heavier stream of
               bubbles, and bubbles only ever rise. The metaphor holds for free.
   Purpose     it goes to the surface, the one landmark the axis actually has.
   Flexibility it is a <button>: click, Enter and Space all work, focus-visible
               draws the standard ring, and reduced motion cuts to 0 M at once
               (descentGlideTo handles that branch).
   Responsibility  inert when you are already at 0 M or in the sky projection —
               it stops advertising itself rather than lying about what it does.
   Delight     the mark takes a lume breath when the surface is reached, once,
               and only when the trip was long enough to have been a journey.
   Simplicity  ~20 lines on top of machinery that already existed. */
function ascendToSurface() {
  if (S.mode !== 'descent' || S.morph || !DS.n) return;
  const from = DS.s;
  const delta = Math.abs(from - 0);
  if (delta < 0.5 && DS.phase === 'rest') return;   /* already there — say nothing */
  /* sqrt-scaled: 520ms floor for the short hop, ~1.45s from the Mariana floor */
  const dur = Math.min(520 + 78 * Math.sqrt(delta), 1600);
  descentGlideTo(0, dur, easeAscent);
  /* mark the flight itself — a flourish on a two-card nudge is noise */
  if (DS.glide && delta >= 3) DS.glide.ascent = true;
  elLive.textContent = 'Ascending to the surface.';
}

/* the arrival — one lume breath on the mark that was pressed, so the gesture
   closes where it started. Skipped on short hops: a flourish that fires on a
   two-card nudge is noise, and skipped under reduced motion. */
function surfaceBreak() {
  elLive.textContent = 'Surface. 0 metres.';
  const el = $('wordmark');
  if (!el || REDUCED) return;
  el.classList.remove('surfaced');
  void el.offsetWidth;                               /* restart the animation */
  el.classList.add('surfaced');
  setTimeout(() => el.classList.remove('surfaced'), 1200);
}

function descentFlyToWatch(w) {
  /* a watch reached via search may be filtered out of the narrowed view — the
     search intent wins: clear the Lens and expand so the flight lands true */
  if (DS.full && DS.order[w._di] !== w) {
    if (lensActive()) lensClear();
    descentDerive(DS.full);
    DS.reflow = null; DS.lastFocus = -1;
  }
  if (isFinite(w._di)) descentFlyToIndex(w._di);
}

/* ======================================================================
   18d · THE SOUNDING LINE — the Descent's depth instrument
   The Ephemeris's vertical sibling: the whole column in miniature. Strata
   as labeled ticks, the annotation depths as unlabeled knots, position as
   a lume mark. Click dives, drag scrubs, wheel passes through. The long
   scroll stays for savoring; the line exists for going.
   ====================================================================== */

const elSounding = $('sounding'), elSndCanvas = $('snd-canvas'),
      elSndThumb = $('snd-thumb'), elSndReadout = $('snd-readout');
const sndCtx = elSndCanvas.getContext('2d');
const SND_X = 10.5;                    /* the line's x within the rail */
let sndH = 0, sndDrag = null, sndLastAria = -1;

function sndIdxForMetres(m) {
  const a = DS.wrM;
  if (!a || !DS.n) return 0;
  let lo = 0, hi = DS.n - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (a[mid] < m) lo = mid + 1; else hi = mid; }
  return lo;
}
const sndYFor = i => (i / Math.max(DS.n - 1, 1)) * sndH;
const sndIdxFor = y => clamp(y / Math.max(sndH, 1), 0, 1) * (DS.n - 1);

function sizeSounding() {
  if (!DS.n || elSounding.hidden) return;
  sndH = elSounding.clientHeight || 1;
  const w = elSounding.clientWidth || 76;
  elSndCanvas.width = Math.max(1, Math.round(w * dpr));
  elSndCanvas.height = Math.max(1, Math.round(sndH * dpr));
  sndCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawSoundingLine();
  buildSoundingLabels();
}
function drawSoundingLine() {
  if (!DS.n || sndH <= 0) return;
  const c = sndCtx;
  c.clearRect(0, 0, elSounding.clientWidth || 76, sndH);
  c.lineWidth = 1;
  /* the line itself */
  c.strokeStyle = 'rgba(233,237,242,0.10)';
  c.beginPath(); c.moveTo(SND_X, 0.5); c.lineTo(SND_X, sndH - 0.5); c.stroke();
  /* knots — the annotation depths, felt more than read */
  c.strokeStyle = 'rgba(233,237,242,0.14)';
  for (const [m] of WC_FACTS) {
    if (!isFinite(m) || m <= 0) continue;
    const y = Math.round(sndYFor(sndIdxForMetres(m))) + 0.5;
    c.beginPath(); c.moveTo(SND_X - 2, y); c.lineTo(SND_X + 2, y); c.stroke();
  }
  /* strata — longer ticks; the labels themselves are DOM buttons (buildSoundingLabels) */
  c.strokeStyle = 'rgba(233,237,242,0.22)';
  for (let k = 0; k < DS.shelfIdx.length; k++) {
    const y = Math.round(sndYFor(DS.shelfIdx[k])) + 0.5;
    c.beginPath(); c.moveTo(SND_X - 5, y); c.lineTo(SND_X + 5, y); c.stroke();
  }
  /* the floor — a final tick for the deepest watch */
  const fy = Math.round(sndYFor(DS.n - 1)) - 0.5;
  c.beginPath(); c.moveTo(SND_X - 5, fy); c.lineTo(SND_X + 5, fy); c.stroke();
}

/* the strata labels as real buttons — hover/focus/click, each glides to its
   depth grade; rebuilt on size change (positions are absolute in px) */
function buildSoundingLabels() {
  for (const el of elSounding.querySelectorAll('.snd-label')) el.remove();
  /* gather the strata bands + the floor (deepest watch, 11,000 m) */
  const specs = [];
  for (let k = 0; k < DS.shelfIdx.length; k++) {
    const text = String(DS.shelfLabel[k] || '').replace(/—/g, '').trim();
    if (text) specs.push({ idx: DS.shelfIdx[k], text, y: clamp(sndYFor(DS.shelfIdx[k]), 6, sndH - 6) });
  }
  const deep = DS.n - 1;
  const deepM = DS.wrM && DS.wrM[deep] ? Math.round(DS.wrM[deep]) : 0;
  if (deepM > 0) specs.push({ idx: deep, text: `${fmtM(deepM)} M`, y: clamp(sndYFor(deep), 6, sndH - 6),
    floor: true, aria: `Dive to the deepest — ${fmtM(deepM)} M` });
  /* place bottom-up: the floor keeps its slot at the foot; sparse deep watches
     crowd the rail's end, so a band label within the min gap of a deeper one yields */
  const GAP = 15;
  specs.sort((a, b) => b.y - a.y);
  let lastY = Infinity;
  for (const s of specs) {
    if (!s.floor && lastY - s.y < GAP) continue;
    lastY = s.y;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'snd-label';
    b.textContent = s.text;
    b.style.top = s.y + 'px';
    b.setAttribute('aria-label', s.aria || `Dive to ${s.text}`);
    b.addEventListener('pointerdown', e => e.stopPropagation());   /* not a track scrub */
    b.addEventListener('click', e => { e.stopPropagation(); anyInput(); descentFlyToIndex(s.idx); });
    elSounding.appendChild(b);
  }
}
function syncSounding() {
  if (!DS.n || elSounding.hidden) return;
  elSndThumb.style.top = (sndYFor(DS.s) - 0.5) + 'px';
  const v = clamp(Math.round(DS.s), 0, DS.n - 1);
  if (v !== sndLastAria) {
    sndLastAria = v;
    elSounding.setAttribute('aria-valuenow', String(v));
    elSounding.setAttribute('aria-valuetext', `−${fmtM(Math.round(dM(v)))} M`);
  }
}
function sndShowReadout(y) {
  elSndReadout.textContent = `−${fmtM(Math.round(dM(sndIdxFor(y))))} M`;
  elSndReadout.style.top = clamp(y, 6, sndH - 6) + 'px';
  elSndReadout.classList.add('on');
}
function sndHideReadout() { elSndReadout.classList.remove('on'); }

elSounding.addEventListener('pointerdown', e => {
  if (S.mode !== 'descent' || S.morph || !DS.n) return;
  anyInput();
  sndDrag = { moved: false, y0: e.clientY };
  elSounding.setPointerCapture(e.pointerId);
  sndShowReadout(e.clientY - elSounding.getBoundingClientRect().top);
  e.preventDefault();
});
elSounding.addEventListener('pointermove', e => {
  if (elSounding.hidden) return;
  const y = e.clientY - elSounding.getBoundingClientRect().top;
  /* over a label button, the label IS the readout — don't double up */
  if (!sndDrag) {
    if (!(e.target instanceof Element && e.target.classList.contains('snd-label'))) sndShowReadout(y);
    else sndHideReadout();
    return;
  }
  if (!sndDrag.moved && Math.abs(e.clientY - sndDrag.y0) > 4) sndDrag.moved = true;
  if (sndDrag.moved) {
    /* live scrub — the drag owns the column; the detent takes it back on release */
    DS.s = sndIdxFor(y);
    DS.v = 0;
    DS.phase = 'gesture';
    DS.glide = null;
    DS.lastT = performance.now();
    setHover(null);
    sndShowReadout(y);
    invalidate();
  }
});
function sndEnd(e) {
  if (!sndDrag) return;
  const moved = sndDrag.moved;
  sndDrag = null;
  sndHideReadout();
  if (moved) {
    DS.phase = 'coast';                     /* v = 0 → the detent settles it */
    DS.lastT = performance.now();
    invalidate();
  } else {
    const y = e.clientY - elSounding.getBoundingClientRect().top;
    descentFlyToIndex(Math.round(sndIdxFor(y)));
  }
}
elSounding.addEventListener('pointerup', sndEnd);
elSounding.addEventListener('pointercancel', () => { sndDrag = null; sndHideReadout(); });
elSounding.addEventListener('pointerleave', () => { if (!sndDrag) sndHideReadout(); });
elSounding.addEventListener('wheel', e => {
  if (S.mode !== 'descent' || S.morph) return;
  e.preventDefault();
  descentWheel(e.deltaY);
}, { passive: false });
elSounding.addEventListener('keydown', e => {
  if (S.mode !== 'descent' || S.morph || !DS.n) return;
  let handled = true;
  if (e.key === 'ArrowDown') descentStep(1);
  else if (e.key === 'ArrowUp') descentStep(-1);
  else if (e.key === 'PageDown') descentStratumStep(1);
  else if (e.key === 'PageUp') descentStratumStep(-1);
  else if (e.key === 'Home') descentGlideTo(0, 600, easeGlide);
  else if (e.key === 'End') descentGlideTo(DS.n - 1, 900, easeGlide);
  else handled = false;
  if (handled) { e.preventDefault(); e.stopPropagation(); }
});

/* --- the strata rulers — the Ephemeris ruler's language, laid on its side */
function drawDescentRulers(c, w_, h_, cy, Y0, alpha) {
  if (alpha <= 0.01 || !DS.shelfIdx.length) return;
  c.save();
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  setType(c, 10, 500, false, 0.18);
  for (let k = 0; k < DS.shelfIdx.length; k++) {
    const b = DS.shelfIdx[k];
    const ry = snap(cy + (dYof(b - 1) + dYof(b)) / 2 - Y0);
    if (ry < -30 || ry > h_ + 30) continue;
    const label = DS.shelfLabel[k];
    const tw = DS.shelfW ? DS.shelfW[k] : c.measureText(label).width;
    c.globalAlpha = alpha;
    c.strokeStyle = 'rgba(233,237,242,0.08)';
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(0, ry + 0.5);
    c.lineTo(w_, ry + 0.5);
    c.stroke();
    /* knockout — the depth reads as engraved in the line, not laid over it.
       GROUND_HEX_NOW keeps the engraving flush at every depth (§18c). */
    c.globalAlpha = 1;
    c.fillStyle = GROUND_HEX_NOW;
    c.fillRect(w_ / 2 - tw / 2 - 16, ry - 8, tw + 32, 17);
    c.globalAlpha = alpha;
    c.fillStyle = TEXT_3;
    c.fillText(label, w_ / 2, ry + 0.5);
  }
  c.restore();
}

/* --- the caption pill — a quiet plate label under the focused card ------ */
function drawDescentPill(c, cx, py, alpha) {
  if (alpha <= 0.01 || !DS.pillText) return;
  c.save();
  setType(c, 10, 500, false, 0.14);
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  const tw = c.measureText(DS.pillText).width;
  const pw = tw + 28, ph = 22;
  c.globalAlpha = alpha;
  roundRectPath(c, cx - pw / 2, py, pw, ph, 11);
  c.fillStyle = 'rgba(13,17,23,0.88)';
  c.fill();
  c.strokeStyle = 'rgba(233,237,242,0.08)';
  c.lineWidth = 1;
  c.stroke();
  c.fillStyle = TEXT_2;
  c.fillText(DS.pillText, cx, py + ph / 2 + 0.5);
  c.restore();
}

/* --- the wheel affordance (§4) — arrives with the rulers on the 820–1120ms
   envelope, whispers below the pill, and retires for good on the first dive
   gesture. Discoverability of the primary verb rests on this line. */
function dismissDescentHint(now) {
  if (!DS.hintSeen) { DS.hintSeen = true; DS.hintT0 = now; invalidate(); }
}
function descentHintAlpha(now) {
  if (!DS.hintSeen) return 1;
  return 1 - clamp((now - DS.hintT0) / 400, 0, 1);
}
function drawDescentHint(c, cx, py, alpha) {
  if (alpha <= 0.01 || !DS.n) return;   /* nothing to descend to when the field is empty */
  c.save();
  setType(c, 10, 500, false, 0.18);
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.globalAlpha = alpha;
  c.fillStyle = TEXT_3;
  c.fillText('SCROLL TO DESCEND', cx, py);
  c.restore();
}

/* --- selection lume — glow baked once, never a per-frame shadowBlur ------ */
let lumeRingSprite = null;   /* stroke+glow at scale 1; drawImage'd at card scale */
const LUME_PAD = 40;         /* room for the outer glow — scaled with the larger plates */
function getLumeRingSprite() {
  if (lumeRingSprite) return lumeRingSprite;
  const c = document.createElement('canvas');
  c.width = (CARD_W + LUME_PAD * 2) * SPRS;
  c.height = (CARD_H + LUME_PAD * 2) * SPRS;
  const g = c.getContext('2d');
  g.scale(SPRS, SPRS);
  g.shadowColor = LUME_GLOW_0;
  g.shadowBlur = 20;
  g.strokeStyle = LUME;
  g.lineWidth = 1;
  roundRectPath(g, LUME_PAD + 0.5, LUME_PAD + 0.5, CARD_W - 1, CARD_H - 1, 8);
  g.stroke();
  g.stroke();   /* second pass deepens the glow to match the live 20px look */
  lumeRingSprite = c;
  return lumeRingSprite;
}

/* --- the frame — helix projection, flat sprites, no warp ---------------- */
function drawDescent(c, w_, h_, now, isExport) {
  if (!isExport) maybeLoadImages();
  const cx = isExport ? DS.cx : axisTick('cx', descTargetCX(), now);
  const cy = isExport ? DS.cy : axisTick('cy', descTargetCY(), now);
  /* MOBILE: smaller plates on a tighter spiral so several cards read at once —
     the helix becomes legible instead of one card filling the screen. */
  const mob = !isExport && w_ < 620;
  const cardK = mob ? 0.64 : 1;                          /* plate shrink */
  const R = mob ? clamp(w_ * 0.40, 128, 190) : clamp(w_ * 0.33, 320, 500);
  const s = DS.s;
  const Y0 = dYs(s);
  const n = clamp(Math.round(s), 0, DS.n - 1);
  const speed = Math.abs(DS.v);
  /* the caption breathes out during motion — a label for a card not yet
     focused encodes nothing */
  const pillA = speed > BLUR_V ? 0 : clamp(1 - Math.abs(s - n) * 3, 0, 1);

  if (!isExport) { DS.rects.length = 0; DS.annRectN = 0; }

  /* §18c — the water column, under the specimen plates: the surface
     ceiling, the strata rulers, the depth annotations, the marine snow.
     The focused card's scale is analytic — the annotations' label-yield
     needs it before the card loop runs. */
  const phiF = (n - s) * HELIX_DTH;
  const dF = (1 + Math.cos(phiF)) / 2;
  const scF = (0.40 + 0.60 * Math.pow(dF, 1.5)) * bloomOf(Math.max(0, 1 - Math.abs(n - s))) * cardK;
  const vy = -(dYs(s + 0.01) - dYs(s - 0.01)) / 0.02;   /* screen-px per card unit, shared */
  drawSurfaceCeiling(c, w_, h_, cy, Y0, 1);
  drawDescentRulers(c, w_, h_, cy, Y0, 1);
  drawDepthAnnotations(c, w_, h_, cx, cy, Y0, 1, scF, s, !isExport);
  drawMarineSnow(c, w_, h_, Y0, 1, vy);
  drawBiolum(c, w_, h_, Y0, 1, now);   /* §18c amendment — the dark makes its own light */

  /* the Lens reflow — survivors FLIP from their old berth to the new one */
  if (DS.reflow && now - DS.reflow.t0 >= DS.reflow.dur) DS.reflow = null;
  const rf = isExport ? null : DS.reflow;
  const rft = rf ? easeOut(clamp((now - rf.t0) / rf.dur, 0, 1)) : 1;

  /* window |i−s| ≤ 10 into preallocated slots, insertion-sorted rear→front */
  const i0 = Math.max(0, Math.ceil(s - 10)), i1 = Math.min(DS.n - 1, Math.floor(s + 10));
  let m = 0;
  for (let i = i0; i <= i1; i++) {
    const phi = (i - s) * HELIX_DTH;
    const d = (1 + Math.cos(phi)) / 2;
    const o = dSlots[m++];
    o.i = i; o.phi = phi; o.d = d;
    o.sc = (0.40 + 0.60 * Math.pow(d, 1.5)) * bloomOf(Math.max(0, 1 - Math.abs(i - s))) * cardK;
    o.al = 0.08 + 0.92 * d * d;
    o.x = cx + R * Math.sin(phi);
    o.y = cy + dYof(i) - Y0;
    o.fade = 1;
    if (rf) {
      const op = rf.oldPos.get(DS.order[i].id);
      if (op) {                                   /* survivor — slide from old berth */
        o.x = lerp(cx + R * Math.sin(op.phi), o.x, rft);
        o.y = lerp(cy + (op.y - rf.oldY0), o.y, rft);
      } else {                                    /* arriver (on expand) — rise + fade in */
        o.fade = rft;
        o.y += (1 - rft) * 26;
      }
    }
  }
  for (let a = 1; a < m; a++) {
    const o = dSlots[a];
    let b = a - 1;
    while (b >= 0 && dSlots[b].d > o.d) { dSlots[b + 1] = dSlots[b]; b--; }
    dSlots[b + 1] = o;
  }

  const ghostA = REDUCED ? 0 : clamp((speed - BLUR_V) / 6, 0, 0.35);
  let scFocus = 1, rectN = 0;

  c.save();
  for (let k = 0; k < m; k++) {
    const o = dSlots[k];
    const w = DS.order[o.i];
    const wd = CARD_W * o.sc, ht = CARD_H * o.sc;
    const x0 = o.x - wd / 2, y0 = o.y - ht / 2;
    if (y0 > h_ + 40 || y0 + ht < -40) continue;
    /* the Lens narrows the Descent (removes non-matches) rather than dimming;
       o.fade carries the reflow's arrive-in envelope */
    let mainA = o.al * o.fade;
    if (ghostA > 0.003) {
      /* motion blur at speed only: two ghosts at ±v·6ms along the numeric
         motion vector, energy conserved out of the main draw */
      const vx = -R * HELIX_DTH * Math.cos(o.phi);
      let gx = vx * DS.v * 0.006, gy = vy * DS.v * 0.006;
      const gl = Math.hypot(gx, gy);
      if (gl > 24) { gx *= 24 / gl; gy *= 24 / gl; }
      const ga = ghostA * o.al * o.fade;
      drawCardSprite(c, w, x0 + gx, y0 + gy, wd, ht, ga, now);
      drawCardSprite(c, w, x0 - gx, y0 - gy, wd, ht, ga, now);
      mainA = Math.max(mainA - ga, 0);
    }
    drawCardSprite(c, w, x0, y0, wd, ht, mainA, now);

    const rr = 8 * o.sc;
    if (S.selection && S.selection.id === w.id) {
      /* lume stays reserved for selection — same grammar as the sky ring.
         Glow comes from a baked sprite (glowSprite discipline: no shadowBlur
         per frame); the 1px stroke stays live so the hairline never softens. */
      c.globalAlpha = o.al;
      const lr = getLumeRingSprite();
      c.drawImage(lr, x0 - LUME_PAD * o.sc, y0 - LUME_PAD * o.sc,
        (CARD_W + LUME_PAD * 2) * o.sc, (CARD_H + LUME_PAD * 2) * o.sc);
      c.strokeStyle = LUME;
      c.lineWidth = 1;
      roundRectPath(c, x0 + 0.5, y0 + 0.5, wd - 1, ht - 1, rr);
      c.stroke();
    } else {
      const hov = hoverProgress(w.id, now);
      const live = o.i === n ? pillA : 0;
      const ba = Math.max(hov * 0.7, live) * o.al;
      if (ba > 0.01) {
        c.globalAlpha = ba;
        c.strokeStyle = 'rgba(233,237,242,0.16)';
        c.lineWidth = 1;
        roundRectPath(c, x0 + 0.5, y0 + 0.5, wd - 1, ht - 1, rr);
        c.stroke();
      }
    }
    if (o.i === n) scFocus = o.sc;
    if (!isExport && o.d > 0.15 && rectN < dRectPool.length) {
      const r = dRectPool[rectN++];
      r.id = w.id; r.x = x0; r.y = y0; r.w = wd; r.h = ht;
      DS.rects.push(r);
    }
  }
  /* the departed sink away and fade — the deep taking them back */
  if (rf && rf.exit.length) {
    const exitA = clamp(1 - rft * 1.5, 0, 1);
    const sink = rft * 48;
    for (let e = 0; e < rf.exit.length; e++) {
      const w = rf.exit[e];
      const op = rf.oldPos.get(w.id);
      if (!op) continue;
      const dd = (1 + Math.cos(op.phi)) / 2;
      const sc = (0.40 + 0.60 * Math.pow(dd, 1.5)) * cardK;
      const wd = CARD_W * sc, ht = CARD_H * sc;
      const ex = cx + R * Math.sin(op.phi) - wd / 2;
      const ey = cy + (op.y - rf.oldY0) + sink - ht / 2;
      if (ey > h_ + 40 || ey + ht < -40) continue;
      drawCardSprite(c, w, ex, ey, wd, ht, exitA * (0.08 + 0.92 * dd * dd), now);
    }
  }
  c.restore();

  /* §18c amendment — the wake rides the foreground (parallax 1.4, drawn
     over the helix): bubbles exist only while there is velocity to encode.
     Never in export — a print has no velocity. */
  if (!isExport) drawBubbles(c, w_, h_, Y0, 1, now);

  drawDescentPill(c, cx, cy + 56 * scFocus + 18, pillA);
  /* the whisper is a screen affordance — a print cannot scroll */
  if (!isExport) drawDescentHint(c, cx, cy + 56 * scFocus + 18 + 40, descentHintAlpha(now));
}

/* ======================================================================
   18b · THE MORPH — the showpiece
   Toggling projections flies every star between its constellation position
   and its helix card along eased paths — 900ms flight, 220ms stagger by
   depth order, shallowest first. One continuous world; the transition IS
   the argument. Esc or D mid-flight retraces from exactly where it is.
   ====================================================================== */

const MORPH_MS = 1120, MORPH_FLY = 900, MORPH_STAG = 220;
let morphData = null;            /* {x0,y0,x1,y1,sc,al: Float32Array, famJobs} */
let morphQueued = null;          /* deferred action for after surfacing (family from search) */
let morphFlyW = null;            /* watch selected mid-morph — flown at landing, by final dir */
let descentChromeOn = false, descentChromeTimer = null;

function applyDescentChrome(on) {
  descentChromeOn = on;
  /* the depth axis only exists in the descent — in the sky the mark is a mark */
  { const wm = $('wordmark');
    if (wm) { wm.classList.toggle('inert', !on);
              if (!on) wm.setAttribute('aria-disabled', 'true'); } }
  if (typeof updateNoMatch === 'function') updateNoMatch();
  if (elTagline) elTagline.textContent = on ? TAGLINE_DESCENT : TAGLINE_SKY;
  if (on) {
    elFooterGauge.textContent = DS.gaugeText || '';
    elCart2.textContent = `BY WATER RESISTANCE · ${S.watches.length} WATCHES`;
  } else {
    lastTlYear = null;           /* force the sky footer/cartouche to re-derive */
    if (S.loaded) maybeTimeChrome(curTY === Infinity ? S.time.max : curTY);
  }
}

function captureFamJobs() {
  /* the last sky frame's winning labels — the camera is frozen, so they
     fade in place rather than being re-fought every morph frame */
  return S.famLabelRects.map(r => ({
    x: r.x + r.w / 2,
    y: r.y + r.h / 2,
    lines: wrapFamily(r.label || familyLabel(r.id))
  }));
}

function startMorph(dir) {
  if (!S.loaded || S.morph) return;
  const now = performance.now();
  cancelFlight();
  stopPlay();
  S.morph = { pending: true };   /* set early so updateNoMatch hides the empty state before the flight */
  updateNoMatch();
  S.morph = null;
  if (dir === 1 && timeEngaged()) returnToPresent();
  closeLensPanel();              /* lens filters sleep in descent — the whole census flies */
  hideWatchPreview();
  hideFamPreview();
  setHover(null);
  setFamHover(null);
  /* park the drift where it is — captured positions must hold still */
  S.observatoryIdle = false;
  S.drift.on = false; S.drift.release = null; S.drift.x = 0; S.drift.y = 0;
  dismissCousteau();
  /* a manual observatory carried into descent would hide the gauge, legend
     and mode toggle with no way back (H is sky-gated) — surface it here */
  if (dir === 1) S.observatoryManual = false;
  if (!S.observatoryManual && !S.exportMode) body.classList.remove('observatory');
  if (S.familyView) {            /* the family index is a sky instrument (v1) */
    releaseFamActive();
    const keepPanel = !!S.selection;
    S.familyView = null;
    if (!keepPanel) hidePanel();
  }
  /* the Lens narrows only the resting Descent — the morph flies the whole
     census. Expand to full first, keeping the focused watch centred. */
  if (DS.full && DS.order !== DS.full) {
    const fid = DS.n ? (DS.order[clamp(Math.round(DS.s), 0, DS.n - 1)] || {}).id : null;
    descentDerive(DS.full);
    if (fid && S.byId.get(fid)) DS.s = S.byId.get(fid)._di;
    DS.s = clamp(DS.s, 0, Math.max(0, DS.n - 1));
    DS.reflow = null; DS.lastFocus = -1; refreshFocus();
  }
  if (REDUCED) {
    /* §4 reduced motion: a 200ms full-scene crossfade — the outgoing frame
       (still on the canvas) fades over the incoming scene, which draws live
       underneath: both scenes present, alpha-lerped. S.morph stays set for
       the window so the input lockout holds and D cannot re-enter; no
       per-star flight, no stagger. */
    const snap = document.createElement('canvas');
    snap.width = canvas.width;
    snap.height = canvas.height;
    snap.getContext('2d').drawImage(canvas, 0, 0);
    if (dir === 1) {
      DS.cxA = DS.cyA = null;
      DS.cx = descTargetCX();
      DS.cy = descTargetCY();
      DS.phase = 'rest';
      DS.v = 0;
      DS.glide = null;
      DS.lastFocus = -1;
      refreshFocus();
    }
    S.mode = dir === 1 ? 'descent' : 'sky';   /* the incoming scene draws live */
    S.morph = { t0: now, dir, fromS: DS.s, reduced: true, snap };
    body.classList.add('morphing');
    body.classList.toggle('descent', dir === 1);
    clearTimeout(descentChromeTimer);
    syncToggle();
    invalidate();
    return;
  }

  /* both endpoints captured once — the flight is pure evaluation */
  DS.cxA = DS.cyA = null;
  DS.cx = descTargetCX();
  DS.cy = descTargetCY();
  DS.lastFocus = -1;
  refreshFocus();
  const N = DS.n;
  const md = morphData = {
    x0: new Float32Array(N), y0: new Float32Array(N),
    x1: new Float32Array(N), y1: new Float32Array(N),
    sc: new Float32Array(N), al: new Float32Array(N),
    /* each watch's ACTUAL sky render state — the dot launches from (and, in
       reverse, lands on) what the sky truly showed: reveal/born alpha, the
       selection/lens dim, and the rendered radius at the current tier.
       The field never pops, it resolves — in its flagship transition too. */
    a0: new Float32Array(N), r0: new Float32Array(N), gt: new Float32Array(N),
    famJobs: captureFamJobs()
  };
  const R = clamp(W * 0.33, 320, 500);
  const Y0 = dYs(DS.s);
  const zC = S.cam.z;
  const AC = tierAlphas(zC);
  const gd = glyphDiameter(zC);
  const dimVal0 = lerp(1, DIM_FIELD, currentDimT(now));
  const sel0 = S.selection;
  const relSet0 = sel0 ? sel0.related
    : S.familyView ? S.familyView.members
    : S.releasing ? S.releasing.related : null;
  const timeOn0 = curTY < S.time.max - 1e-6;
  for (let i = 0; i < N; i++) {
    const w = DS.order[i];
    const [sx, sy] = toScreen(w.x, w.y);
    md.x0[i] = sx; md.y0[i] = sy;
    const phi = (i - DS.s) * HELIX_DTH;
    const d = (1 + Math.cos(phi)) / 2;
    md.x1[i] = DS.cx + R * Math.sin(phi);
    md.y1[i] = DS.cy + dYof(i) - Y0;
    md.sc[i] = (0.40 + 0.60 * Math.pow(d, 1.5)) * bloomOf(Math.max(0, 1 - Math.abs(i - DS.s)));
    md.al[i] = 0.08 + 0.92 * d * d;
    const rv = revealState(w, now);
    let bornA = 1, magScale = 1;
    if (timeOn0) {
      bornA = bornAlphaOf(w, curTY);
      const dY = descAt(w, curTY);
      if (dY < w._desc) magScale = magR(dY) / w._r;
    }
    const isRel0 = relSet0 ? relSet0.has(w.id) : false;
    const selFactor = isRel0 || !relSet0 ? 1 : dimVal0;
    md.a0[i] = rv.a * bornA * Math.min(selFactor, lensFactorOf(w, now));
    const relFull = sel0 && sel0.related.has(w.id);
    if (relFull) { md.r0[i] = Math.max(gd, 28) / 2; md.gt[i] = 1; }
    else if (AC.glyph > 0.5) { md.r0[i] = gd / 2; md.gt[i] = AC.t3; }
    else { md.r0[i] = w._r * magScale; md.gt[i] = -1; }
  }
  DS.built = 0;                  /* plate prebuild — chunks of 48/frame */
  DS.phase = 'rest';
  DS.v = 0;
  DS.glide = null;
  S.morph = { t0: now, dir, fromS: DS.s };
  body.classList.add('morphing');
  clearTimeout(descentChromeTimer);
  if (dir === 1) {
    body.classList.add('descent');
    descentChromeTimer = setTimeout(() => applyDescentChrome(true), 450);
  } else {
    body.classList.remove('descent');
    descentChromeTimer = setTimeout(() => applyDescentChrome(false), 450);
  }
  syncToggle();
  invalidate();
}

function reverseMorph() {
  const M = S.morph;
  if (!M) return;
  /* the reduced crossfade is 200ms and directionless — there is no flight
     to retrace, and reversing it would only jump the veil. Let it land. */
  if (M.reduced) return;
  const now = performance.now();
  M.dir *= -1;
  M.t0 = now - (MORPH_MS - (now - M.t0));   /* every star retraces from exactly here */
  clearTimeout(descentChromeTimer);
  if (M.dir === 1) {
    /* reversing back to descent cancels the surfacing the queue was riding —
       a queued family open must die with the reversal, or it survives as a
       stale closure and fires on some unrelated surfacing minutes later */
    morphQueued = null;
    body.classList.add('descent');
    descentChromeTimer = setTimeout(() => applyDescentChrome(true), 450);
  } else {
    body.classList.remove('descent');
    descentChromeTimer = setTimeout(() => applyDescentChrome(false), 450);
  }
  syncToggle();
  invalidate();
}

function morphFinished(now) {
  const M = S.morph;
  if (now - M.t0 < (M.reduced ? 200 : MORPH_MS)) return false;
  finishMorph(M.dir);
  return true;
}
function finishMorph(dir) {
  S.morph = null;
  morphData = null;
  body.classList.remove('morphing');
  clearTimeout(descentChromeTimer);
  if (dir === 1) {
    S.mode = 'descent';
    DS.phase = 'rest';
    DS.v = 0;
    DS.lastT = performance.now();
    /* §18c — snow (or the deep's own light) greets the arrival, unless
       the water here is truly empty */
    scheduleWaterTail(DS.lastT);
    applyDescentChrome(true);
    /* re-narrow to the active Lens now the census has landed whole */
    if (lensActive()) applyDescentNarrow(!morphFlyW);
    elLive.textContent = `The descent — ${DS.n} watches ranked by water resistance.`;
    if (morphFlyW) { descentFlyToWatch(morphFlyW); morphFlyW = null; }
    /* a family queued during a non-reversible (reduced) descent morph:
       honor it by surfacing at once — never hold a stale closure */
    if (morphQueued) { syncToggle(); invalidate(); startMorph(-1); return; }
  } else {
    S.mode = 'sky';
    body.classList.remove('descent');
    applyDescentChrome(false);
    if (morphFlyW) { flyToWatch(morphFlyW); morphFlyW = null; }
    if (morphQueued) {
      const q = morphQueued;
      morphQueued = null;
      q();
    }
  }
  syncToggle();
  scheduleURLWrite();
  invalidate();
}

function drawMorph(c, w_, h_, now, isExport) {
  const M = S.morph, md = morphData;
  if (!md) return;
  /* one clock, two directions — reverse runs the same envelope backward */
  const eff = clamp(M.dir === 1 ? now - M.t0 : MORPH_MS - (now - M.t0), 0, MORPH_MS);

  /* plate prebuild — sprites are always ready before cards materialize */
  let built = 0;
  while (DS.built < DS.n && built < 48) { getSprite(DS.order[DS.built++]); built++; }

  const skyA = 1 - easeExit(clamp(eff / 300, 0, 1));
  const descA = easeOut(clamp((eff - 820) / 300, 0, 1));
  const timeOn = curTY < S.time.max - 1e-6;

  /* the sky letting go — threads + family labels out over 0–300ms. The dim
     floor is the LIVE field dim: with a selection or lens engaged the threads
     were already receded, and frame one must not flash them bright. */
  if (skyA > 0.05) drawThreads(c, w_, h_, now, S.cam.z, Math.max(currentDimT(now), 1 - skyA), curTY, timeOn);
  if (skyA > 0.01 && md.famJobs.length) {
    c.save();
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    setType(c, 11, 500, false, 0.18);
    c.fillStyle = TEXT_3;
    c.globalAlpha = skyA * tierAlphas(S.cam.z).fam;
    for (const j of md.famJobs) {
      let ty = snap(j.y - (j.lines.length - 1) * 7.5);
      for (const ln of j.lines) { c.fillText(ln, snap(j.x), ty); ty += 15; }
    }
    c.restore();
  }

  /* the strata arriving — rulers + pill in over 820–1120ms. The water
     column (§18c) rides the same envelope: descA IS waterT this frame,
     so the annotation knockouts stay flush with the crossfading ground. */
  if (descA > 0.01) {
    const Y0 = dYs(DS.s);
    const nF = clamp(Math.round(DS.s), 0, DS.n - 1);
    const dF = (1 + Math.cos((nF - DS.s) * HELIX_DTH)) / 2;
    const scF = (0.40 + 0.60 * Math.pow(dF, 1.5)) * bloomOf(Math.max(0, 1 - Math.abs(nF - DS.s)));
    drawSurfaceCeiling(c, w_, h_, DS.cy, Y0, descA);
    drawDescentRulers(c, w_, h_, DS.cy, Y0, descA);
    drawDepthAnnotations(c, w_, h_, DS.cx, DS.cy, Y0, descA, scF, DS.s);
    drawMarineSnow(c, w_, h_, Y0, descA, 0);     /* frozen mid-morph — never streaked */
    drawDescentPill(c, DS.cx, DS.cy + 56 + 18, descA);
    /* the wheel affordance arrives on the same 820–1120ms envelope (§4) */
    drawDescentHint(c, DS.cx, DS.cy + 56 + 18 + 40, descA * descentHintAlpha(now));
  }

  /* the flights — shallowest launches first (delay by depth rank); the point
     of light travels, the plate materializes over the final 35% */
  const N = DS.n;
  c.save();
  for (let i = 0; i < N; i++) {
    const delay = (i / (N - 1)) * MORPH_STAG;
    const p = clamp((eff - delay) / MORPH_FLY, 0, 1);
    const e = easeGlide(p);
    const x = lerp(md.x0[i], md.x1[i], e);
    const y = lerp(md.y0[i], md.y1[i], e);
    if (x < -220 || x > w_ + 220 || y < -160 || y > h_ + 160) continue;
    const w = DS.order[i];
    const cardT = clamp((p - 0.65) / 0.35, 0, 1);
    if (cardT < 1) {
      /* the dot launches from (and, in reverse, lands on) the watch's ACTUAL
         sky frame — captured alpha (reveal/born × selection/lens dim) and the
         rendered radius at the current tier. At glyph tiers the dial drawing
         dissolves into its travelling dot over the first 35%; a dimmed or
         unborn star brightens along the flight. Never pops — resolves. */
      const t35 = clamp(p / 0.35, 0, 1);
      if (md.gt[i] >= 0 && t35 < 1 && md.a0[i] > 0.004) {
        c.globalAlpha = md.a0[i] * (1 - t35);
        drawGlyph(c, w, x, y, md.r0[i] * 2, md.gt[i], now);
      }
      const dotA = lerp(md.a0[i], 1, t35) * (1 - cardT) * (md.gt[i] >= 0 ? t35 : 1);
      if (dotA > 0.004) {
        c.globalAlpha = dotA;
        c.fillStyle = mixed('star', w.dialColor);
        c.beginPath();
        c.arc(x, y, Math.max(lerp(md.r0[i], w._r, t35), 0.75), 0, Math.PI * 2);
        c.fill();
      }
    }
    if (cardT > 0) {
      const sc = md.sc[i] * lerp(0.85, 1, cardT);
      const wd = CARD_W * sc, ht = CARD_H * sc;
      drawCardSprite(c, w, x - wd / 2, y - ht / 2, wd, ht, md.al[i] * cardT, now);
    }
  }
  c.restore();
}

/* reduced motion: the crossfade veil — the outgoing frame, snapshotted at
   startMorph, lies over the live incoming scene and fades out over 200ms.
   Drawn at the tail of both scene paths in draw(); finishMorph closes it. */
function drawReducedMorphVeil(c, w_, h_, now, isExport) {
  const M = S.morph;
  if (!M || !M.reduced || !M.snap || isExport) return;
  const p = clamp((now - M.t0) / 200, 0, 1);
  if (p >= 1) return;
  c.save();
  c.globalAlpha = 1 - p;
  c.drawImage(M.snap, 0, 0, w_, h_);
  c.restore();
}

function toggleDescent() {
  if (!S.loaded) return;
  if (S.morph) { reverseMorph(); return; }
  startMorph(S.mode === 'sky' ? 1 : -1);
}

function syncToggle() {
  const target = S.morph ? (S.morph.dir === 1 ? 'descent' : 'sky') : S.mode;
  elMtSky.setAttribute('aria-pressed', target === 'sky' ? 'true' : 'false');
  elMtDescent.setAttribute('aria-pressed', target === 'descent' ? 'true' : 'false');
}

elMtSky.addEventListener('click', () => {
  anyInput();
  if (S.morph || S.mode === 'sky') return;
  toggleDescent();
});
elMtDescent.addEventListener('click', () => {
  anyInput();
  if (S.morph || S.mode === 'descent') return;
  toggleDescent();
});

/* ======================================================================
   18c · THE WATER COLUMN — the ocean is not imagery; it is physics + light
   Every element below keys off ONE continuous depth scalar, dM(DS.s):
   light attenuation on the ground and vignette, marine snow density,
   the coast time-constant, the depth annotations, the surface ceiling.
   Amended: bubbles encode velocity in lit water (the diver's wake — gone
   at rest, gone below 1000m where no light reaches the air); biolumin-
   escence encodes life where light ends (>1000m — the one place the
   column makes its own color, because down there light IS data about
   life). Both deterministic (fixed seeds), both parked when idle.
   Still refused: waves, creatures, sound — imagery, not physics.
   In the sky waterT is 0 and every path short-circuits — bit-identical.
   ====================================================================== */

/* --- the depth scalar — metres at the current scroll position ---------- */
function dM(s) {
  s = clamp(s, 0, DS.n - 1);
  const i0 = Math.floor(s);
  return lerp(DS.wrM[i0], DS.wrM[Math.min(i0 + 1, DS.n - 1)], s - i0);
}

const sstep = t => t * t * (3 - 2 * t);   /* smoothstep — zero-slope at knots */

/* --- light attenuation — the real optical zones, smoothly interpolated.
   Base FIELD_RGB [6,8,11] sits between the 200m and 1000m anchors: the
   sky's ground already reads as shallow water, so entry never pops. ------ */
const WC_ZONE_D = [0, 200, 1000, 4000, 11000];
const WC_ZONE_RGB = [[9, 12, 14], [7, 9, 12], [5, 7, 10], [4, 5, 8], [3, 4, 6]];
const wcZoneOut = [0, 0, 0];
function wcZone(d) {
  let k = WC_ZONE_D.length - 2;
  for (let i = 1; i < WC_ZONE_D.length; i++) {
    if (d < WC_ZONE_D[i]) { k = i - 1; break; }
  }
  const a = WC_ZONE_RGB[k], b = WC_ZONE_RGB[k + 1];
  const t = sstep(clamp((d - WC_ZONE_D[k]) / (WC_ZONE_D[k + 1] - WC_ZONE_D[k]), 0, 1));
  wcZoneOut[0] = lerp(a[0], b[0], t);
  wcZoneOut[1] = lerp(a[1], b[1], t);
  wcZoneOut[2] = lerp(a[2], b[2], t);
  return wcZoneOut;
}

/* master gate — 0 in the sky (exact FIELD_HEX, zero diff), 1 in descent,
   and the strata-ruler 820–1120ms envelope through the morph (both dirs).
   The reduced morph has already flipped the mode: waterT is 0/1 and the
   200ms snapshot veil carries the crossfade. */
function wcComputeWaterT(now) {
  if (S.morph && !S.morph.reduced) {
    const eff = clamp(S.morph.dir === 1 ? now - S.morph.t0 : MORPH_MS - (now - S.morph.t0), 0, MORPH_MS);
    return easeOut(clamp((eff - 820) / 300, 0, 1));
  }
  return S.mode === 'descent' ? 1 : 0;
}

let GROUND_HEX_NOW = FIELD_HEX;     /* ground fill + every knockout, this frame */
const wcVignRGB = [0, 0, 0];        /* vignette tint = zone + (VIGNETTE − FIELD) */
const wcHexMemo = new Map();        /* ≤ ~30 entries ever — zone deltas are 6–8 steps */
function wcUpdateGround(now) {
  const t = wcComputeWaterT(now);
  if (t <= 0 || !DS.wrM) { GROUND_HEX_NOW = FIELD_HEX; return 0; }
  const z = wcZone(dM(DS.s));
  const r = Math.round(lerp(FIELD_RGB[0], z[0], t));
  const g = Math.round(lerp(FIELD_RGB[1], z[1], t));
  const b = Math.round(lerp(FIELD_RGB[2], z[2], t));
  const key = (r << 16) | (g << 8) | b;
  let hx = wcHexMemo.get(key);
  if (!hx) { hx = `rgb(${r},${g},${b})`; wcHexMemo.set(key, hx); }
  GROUND_HEX_NOW = hx;
  /* vignette stays darker than its ground at every depth: zone + [−2,−3,−1] */
  wcVignRGB[0] = Math.round(lerp(VIGNETTE_RGB[0], Math.max(0, z[0] - 2), t));
  wcVignRGB[1] = Math.round(lerp(VIGNETTE_RGB[1], Math.max(0, z[1] - 3), t));
  wcVignRGB[2] = Math.round(lerp(VIGNETTE_RGB[2], Math.max(0, z[2] - 1), t));
  return t;
}

/* tinted vignette — geometry identical to paintVignette; the gradient is
   memoized on (tone, w, h) so a gesture rebuilds a handful, never per frame */
let wcVgKey = -1, wcVgW = 0, wcVgH = 0, wcVgGrad = null;
function paintVignetteWater(c, w_, h_) {
  const key = (wcVignRGB[0] << 16) | (wcVignRGB[1] << 8) | wcVignRGB[2];
  if (!wcVgGrad || wcVgKey !== key || wcVgW !== w_ || wcVgH !== h_) {
    const R = Math.hypot(w_, h_) / 2;
    const r0 = Math.min(w_, h_) * 0.325;
    const g = c.createRadialGradient(w_ / 2, h_ / 2, r0, w_ / 2, h_ / 2, R);
    g.addColorStop(0, rgbaStr(wcVignRGB, 0));
    g.addColorStop(1, rgbaStr(wcVignRGB, 1));
    wcVgKey = key; wcVgW = w_; wcVgH = h_; wcVgGrad = g;
  }
  c.fillStyle = wcVgGrad;
  c.fillRect(0, 0, w_, h_);
}

/* --- pressure in the hand — the water thickens fractionally with depth.
   τ: 180→150ms via a 0.35 exponent, so the change spreads across the whole
   journey instead of hiding below 2000m. Felt, never seen; the detent
   spring is untouched and a full flick still reaches the floor. */
function dTau(d) {
  return 0.150 + 0.030 * (1 - Math.pow(d / 11000, 0.35));
}

/* --- marine snow — 28 single-pixel motes, whisper alpha, seeded once.
   Deterministic per session (mulberry32, fixed seed); zero per-frame
   allocation; parallax 0.35 so descending streams them gently upward. ---- */
const WC_SNOW_N = 28, WC_SNOW_P = 0.35;
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function initMarineSnow() {
  const rnd = mulberry32(10911);                 /* fixed seed — same sea every session */
  const sn = DS.snow = new Float32Array(WC_SNOW_N * 4);
  for (let j = 0; j < WC_SNOW_N; j++) {
    sn[j * 4] = 0.02 + 0.96 * rnd();             /* xFrac */
    sn[j * 4 + 1] = rnd();                       /* yFrac */
    sn[j * 4 + 2] = 0.04 + 0.06 * rnd();         /* alpha 0.04–0.10 */
    sn[j * 4 + 3] = 2 + 3 * rnd();               /* fall 2–5 px/s, world, downward */
  }
}
/* density thins with depth — near-none below the midnight line, hadal empty */
function wcSnowK(d) {
  if (d <= 200) return 1;
  if (d <= 1000) return 1 - 0.85 * sstep((d - 200) / 800);
  if (d <= 2500) return 0.15 * (1 - sstep((d - 1000) / 1500));
  return 0;
}
function drawMarineSnow(c, w_, h_, Y0, aMul, vy) {
  if (aMul <= 0.004 || !DS.snow) return;
  const k = wcSnowK(dM(DS.s));
  if (k <= 0.001) return;                        /* hadal water is empty — skip the loop */
  const WRAP = DS.snowWrap || h_ + 240;
  const sn = DS.snow, clockPx = DS.snowClock, par = WC_SNOW_P * Y0;
  /* fast scroll: the card-ghost grammar, actually honored — the ghosts'
     energy is taken FROM the main mote (composite alpha stays a through
     the whole transition) and the ghost share ramps in from the |gy|
     threshold, so streak onset never steps brightness. vy is the caller's
     shared derivative — never resampled here. */
  let gy = 0, gsh = 0;
  if (!REDUCED && vy && Math.abs(DS.v) > BLUR_V) {
    gy = clamp(vy * DS.v * 0.006 * WC_SNOW_P, -12, 12);
    gsh = 0.25 * clamp((Math.abs(gy) - 0.5) / 1.5, 0, 1);
  }
  c.save();
  c.fillStyle = THREAD_INK;
  for (let j = 0; j < WC_SNOW_N; j++) {
    const a = sn[j * 4 + 2] * k * aMul;
    if (a < 0.004) continue;
    const raw = sn[j * 4 + 1] * WRAP + sn[j * 4 + 3] * clockPx - par;
    const sy = ((raw % WRAP) + WRAP) % WRAP - 120;
    const sx = sn[j * 4] * w_;
    if (gsh > 0.003) {
      c.globalAlpha = a * (1 - 2 * gsh);         /* main yields what the ghosts take */
      c.fillRect(sx, sy, 1, 1);
      c.globalAlpha = a * gsh;
      c.fillRect(sx, sy + gy, 1, 1);
      c.fillRect(sx, sy - gy, 1, 1);
    } else {
      c.globalAlpha = a;
      c.fillRect(sx, sy, 1, 1);
    }
  }
  c.restore();
}
/* --- bubbles — the diver's wake (§18c amendment): velocity made light.
   18 baked-rim sprites on foreground parallax 1.4, so they stream past
   the helix and read as IN FRONT; density ∝ |DS.v| — invisible at rest
   (still water holds no wake), a stream mid-dive. They wobble as they
   rise; snow falls dead straight — that contrast is the point. Zero idle
   cost: the system dies with the velocity, so it never needs the tail. */
const WC_BUB_N = 18;
/* bubbles are WAKE, not a static field the camera passes — released at the diver
   every moment, so buoyancy is their identity: they ALWAYS rise on screen. The
   old feel of streaming past the helix isn't position-parallax (which inverts on
   ascent) — it's SPEED: you stir more wake the faster you move, either direction.
   rise rate = base + gust·min(|v|, cap), rectified, always upward. */
const BUB_RISE_BASE = 52, BUB_RISE_GUST = 74, BUB_VCAP = 3.2;
function initBubbles() {
  const rnd = mulberry32(47712);                 /* fixed seed — same wake every session */
  const bb = DS.bub = new Float32Array(WC_BUB_N * 5);
  for (let j = 0; j < WC_BUB_N; j++) {
    bb[j * 5] = 0.03 + 0.94 * rnd();             /* xFrac */
    bb[j * 5 + 1] = rnd();                       /* yFrac */
    bb[j * 5 + 2] = 0.16 + 0.14 * rnd();         /* alpha 0.16–0.30 — present, not loud */
    bb[j * 5 + 3] = 0.78 + 0.44 * rnd();         /* rise multiplier 0.78–1.22 — depth layering */
    bb[j * 5 + 4] = 5 + 4 * rnd();               /* diameter 5–9 logical px */
  }
}
/* you can't see air where there's no light — full to 200m, gone by 1000m */
function wcBubK(d) {
  if (d <= 200) return 1;
  if (d >= 1000) return 0;
  return 1 - sstep((d - 200) / 800);
}
let bubSprite = null;   /* a bubble is a lit edge, not a dot — rim baked once */
const BUB_SPR = 12;
function getBubSprite() {
  if (bubSprite) return bubSprite;
  const cv = document.createElement('canvas');
  cv.width = cv.height = BUB_SPR * SPRS;
  const g = cv.getContext('2d');
  const r = BUB_SPR * SPRS / 2;
  const grad = g.createRadialGradient(r, r, 0, r, r, r);
  grad.addColorStop(0, 'rgba(233,237,242,0)');   /* transparent core — water inside is water */
  grad.addColorStop(0.52, 'rgba(233,237,242,0)');
  grad.addColorStop(0.72, 'rgba(233,237,242,1)');/* the rim — wide enough to survive downscale */
  grad.addColorStop(0.94, 'rgba(233,237,242,0.9)');
  grad.addColorStop(1, 'rgba(233,237,242,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, cv.width, cv.height);
  bubSprite = cv;
  return bubSprite;
}
function drawBubbles(c, w_, h_, Y0, aMul, now) {
  if (REDUCED || aMul <= 0.004 || !DS.bub) return;
  /* onset at a gentle scroll, full presence by ~1.4 cards/s — a deliberate
     human dive must SEE its wake, not just a flung wheel */
  let visK = clamp((Math.abs(DS.v) - 0.2) / 1.2, 0, 1);
  /* the Lens reflow stirs the water too: turbulence ∝ card speed, which for
     an eased FLIP is exactly 1 − progress — the burst blooms the instant the
     filter lands and decays along the same curve the cards ride. Capped at
     0.85: a filter click reads softer than a deliberate dive. */
  if (DS.reflow) {
    const p = clamp((now - DS.reflow.t0) / DS.reflow.dur, 0, 1);
    visK = Math.max(visK, 0.85 * (1 - easeOut(p)));
  }
  if (visK <= 0.004) return;                     /* still water holds no wake */
  const k = wcBubK(dM(DS.s));
  if (k <= 0.001) return;                        /* below the light, air is invisible */
  const WRAP = DS.snowWrap || h_ + 240;
  const bb = DS.bub, rise = DS.bubClock;
  const spr = getBubSprite();
  c.save();
  for (let j = 0; j < WC_BUB_N; j++) {
    const a = bb[j * 5 + 2] * k * visK * aMul;
    if (a < 0.004) continue;
    const raw = bb[j * 5 + 1] * WRAP - bb[j * 5 + 3] * rise;   /* MINUS·monotonic — always rises */
    const sy = ((raw % WRAP) + WRAP) % WRAP - 120;
    const sx = bb[j * 5] * w_ + 5 * Math.sin(sy * 0.03 + j * 2.4);      /* the wobble */
    const dpx = bb[j * 5 + 4];
    c.globalAlpha = a;
    c.drawImage(spr, sx - dpx / 2, sy - dpx / 2, dpx, dpx);
  }
  c.restore();
}

/* --- bioluminescence — where light ends, life makes its own (§18c
   amendment). 8 cold points below the photic zone — the exact inverse
   territory of snow and bubbles — pulsing on the shared motion clock,
   envelope cubed so at any instant only two or three read. They wander,
   they do not fall. The one place the column emits its own color: down
   in the dark, light is data about life. */
const WC_BIO_N = 8, WC_BIO_P = 0.5;
function initBiolum() {
  const rnd = mulberry32(88123);                 /* fixed seed — same deep every session */
  const bo = DS.bio = new Float32Array(WC_BIO_N * 6);
  for (let j = 0; j < WC_BIO_N; j++) {
    bo[j * 6] = 0.05 + 0.90 * rnd();             /* xFrac */
    bo[j * 6 + 1] = rnd();                       /* yFrac */
    bo[j * 6 + 2] = 2.2 + 1.2 * rnd();           /* pulse period 2.2–3.4s */
    bo[j * 6 + 3] = rnd() * Math.PI * 2;         /* pulse phase */
    bo[j * 6 + 4] = rnd() * Math.PI * 2;         /* drift phase */
    bo[j * 6 + 5] = 0.22 + 0.12 * rnd();         /* peak alpha 0.22–0.34 — readable in the dark */
  }
}
/* nothing in lit water; ramps in below 1000m, full by 1800m — the hadal
   emptiness (wcSnowK = 0) is exactly where this system lives */
function wcBioK(d) {
  if (d <= 1000) return 0;
  if (d >= 1800) return 1;
  return sstep((d - 1000) / 800);
}
let bioSprite = null;   /* soft cold-cyan point — emitted light, never THREAD_INK */
const BIO_SPR = 10;
function getBioSprite() {
  if (bioSprite) return bioSprite;
  const cv = document.createElement('canvas');
  cv.width = cv.height = BIO_SPR * SPRS;
  const g = cv.getContext('2d');
  const r = BIO_SPR * SPRS / 2;
  const grad = g.createRadialGradient(r, r, 0, r, r, r);
  grad.addColorStop(0, 'rgba(150,200,220,1)');
  grad.addColorStop(0.35, 'rgba(150,200,220,0.35)');
  grad.addColorStop(1, 'rgba(150,200,220,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, cv.width, cv.height);
  bioSprite = cv;
  return bioSprite;
}
const BIO_TAU = Math.PI * 2;
function drawBiolum(c, w_, h_, Y0, aMul, now) {
  if (aMul <= 0.004 || !DS.bio) return;
  const k = wcBioK(dM(DS.s));
  if (k <= 0.001) return;                        /* lit water — the deep's light unreadable */
  const WRAP = DS.snowWrap || h_ + 240;
  const bo = DS.bio, t = DS.snowClock, par = WC_BIO_P * Y0;
  const spr = getBioSprite();
  c.save();
  for (let j = 0; j < WC_BIO_N; j++) {
    let a, sx, raw;
    if (REDUCED) {                               /* designed fallback — a still constellation */
      a = 0.05 * k * aMul;
      sx = bo[j * 6] * w_;
      raw = bo[j * 6 + 1] * WRAP - par;
    } else {
      const pulse = Math.max(0, Math.sin(t * BIO_TAU / bo[j * 6 + 2] + bo[j * 6 + 3]));
      const env = pulse * pulse;                 /* squared — soft blinks with real dwell time */
      a = bo[j * 6 + 5] * env * k * aMul;
      const dph = bo[j * 6 + 4];
      sx = bo[j * 6] * w_ + 14 * Math.sin(t * 0.13 + dph);
      raw = bo[j * 6 + 1] * WRAP + 8 * Math.sin(t * 0.09 + dph * 1.7) - par;
    }
    if (a < 0.004) continue;
    const sy = ((raw % WRAP) + WRAP) % WRAP - 120;
    c.globalAlpha = a;
    c.drawImage(spr, sx - 7, sy - 7, 14, 14);    /* 14px — a glow, not a speck */
  }
  c.restore();
}

/* the water tail — how long a settled descent keeps living. Lit water gets
   4s of drifting snow, then parks (the house law). But below the photic
   zone the ONLY thing visible is the life — so the deep never sleeps: the
   blinks ride the 10fps idle path for as long as the viewer stays down. */
function scheduleWaterTail(now) {
  if (REDUCED || !DS.wrM) return;
  const d = dM(DS.s);
  if (wcBioK(d) > 0) DS.snowUntil = Infinity;
  else if (wcSnowK(d) > 0) DS.snowUntil = now + 4000;
}

/* the snow tail is the only reason a settled descent still frames — and it
   rides the sky-drift 10fps path, then goes fully dark after 4s (except the
   deep — see scheduleWaterTail) */
function snowOnly(now) {
  if (S.morph || S.mode !== 'descent' || REDUCED) return false;
  if (now >= DS.snowUntil) return false;
  if (DS.phase !== 'rest' || DS.cxA || DS.cyA) return false;
  if (now < DS.rampUntil) return false;
  if (DS.hintT0 && now < DS.hintT0 + 400) return false;
  if (S.flight || S.time.anim || S.time.playing) return false;
  if (lensAnim.from !== lensAnim.to && now - lensAnim.t0 < 420) return false;
  if (S.minuteAnim && now - S.minuteAnim.t0 < 140) return false;
  for (const a of S.hoverAnims.values()) if (now - a.t0 < a.dur) return false;
  for (const a of S.famHoverAnims.values()) if (now - a.t0 < 220) return false;
  for (const a of famActiveAnims.values()) if (now - a.t0 < a.dur) return false;
  for (const a of S.panelHoverAnims.values()) if (now - a.t0 < 140) return false;
  if (S.selection && now - S.selection.t0 < S.selection.animLen + 500) return false;
  if (S.releasing) return false;
  return true;
}

/* --- depth annotations — the only words. True one-line facts, engraved
   at their real depth in the strata rulers' exact typography — caps, so
   the mode keeps ONE engraved voice (the 0.18em tracking is calibrated
   for it). Figures verified: RSTC recreational limit 40m; Nitsch 2007
   no-limit RECORD 214m — "record", not "dive": the 2012 253m dive went
   deeper but was never ratified, so the record scoping is what makes the
   line true; Gabr 2014 scuba 332.35m; aphotic boundary 1000m; Titanic
   wreck ≈3800m; hadal boundary 6000m (the brief said abyssal — that zone
   begins at 4000m); Challenger Deep 10,935±6m (2021 survey). ------------- */
const WC_FACTS = [
  [0, '0 M — SURFACE'],
  [40, '−40 M — RECREATIONAL DIVING’S LIMIT'],
  [253, '−253 M — DEEPEST FREEDIVING RECORD', 'freediver'],
  [332, '−332 M — DEEPEST SCUBA DIVE', 'scuba'],
  [564, '−564 M — EMPEROR PENGUIN, DEEPEST DIVE', 'penguin'],
  [1000, '−1,000 M — THE MIDNIGHT ZONE BEGINS'],
  [1280, '−1,280 M — LEATHERBACK TURTLE, DEEPEST DIVE', 'leatherback'],
  [2992, '−2,992 M — CUVIER’S BEAKED WHALE, DEEPEST DIVE', 'whale'],
  [3800, '−3,800 M — THE TITANIC'],
  [6000, '−6,000 M — THE HADAL ZONE BEGINS'],
  [8336, '−8,336 M — HADAL SNAILFISH, DEEPEST FISH', 'snailfish', 'BELOW THIS LINE, NOTHING SWIMS'],
  [10935, '−10,935 M — CHALLENGER DEEP']
];
const WC_SURFACE_Y = -224;                       /* 3.5 pitches above card 0 */

/* --- the ladder of life — silhouettes of the deepest divers, engraved at
   their verified depths beside the annotation captions. Every path lives in
   a viewBox exactly 4× its logical render size (so the coords carry sub-pixel
   fidelity that survives downscale); baked ONCE into a TEXT_3-ink sprite,
   drawImage per frame — no per-frame Path2D fill (§3). All five face LEFT.
   Order here IS the sprite-table index that DS.annSil stores. ------------- */
const WC_SILS = [
  { key: 'freediver',   w: 16, h: 34, url: 'https://en.wikipedia.org/wiki/Herbert_Nitsch', d: 'M 28 134 C 27 126 27 118 27 110 C 22 107 20 101 21 95 C 22 91 24 89 25 87 C 24 79 24 71 25 64 C 26 61 27 59 27 56 C 28 48 28 40 29 32 C 29 29 29 27 29 25 C 24 19 18 12 12 4 C 20 8 26 9 32 9 C 38 9 44 8 52 4 C 47 11 41 18 37 25 C 37 31 37 37 38 43 C 39 49 40 55 40 61 C 40 69 40 77 39 85 C 39 87 39 89 40 91 C 44 94 45 104 40 110 C 37 112 35 114 34 116 C 33 122 32 128 32 134 C 31 136 29 136 28 134 Z' },
  { key: 'penguin',     w: 24, h: 12, url: 'https://en.wikipedia.org/wiki/Emperor_penguin', d: 'M 2 14 C 7 13 12 12 17 11 C 24 6 32 5 40 8 C 56 12 72 16 86 21 C 91 23 93 25 89 27 C 80 30 70 31 62 31 C 57 32 52 33 48 33 C 54 36 59 40 63 45 C 55 45 46 39 39 34 C 31 33 26 29 21 25 C 17 21 12 17 7 16 C 5 15 3 14 2 14 Z' },
  { key: 'leatherback', w: 30, h: 16, url: 'https://en.wikipedia.org/wiki/Leatherback_sea_turtle', d: 'M 3 25 C 6 21 10 19 15 19 C 19 19 22 18 25 16 C 31 8 41 4 53 4 C 74 6 94 14 109 24 C 114 27 117 30 118 33 C 113 37 108 40 103 41 C 97 40 91 38 86 36 C 75 36 64 36 53 35 C 56 44 60 53 62 61 C 55 56 48 46 42 36 C 34 35 26 33 19 30 C 13 29 8 28 3 25 Z' },
  { key: 'whale',       w: 48, h: 14, url: 'https://en.wikipedia.org/wiki/Cuvier%27s_beaked_whale', d: 'M 2 27 C 4 23 7 20 10 18 C 13 11 24 8 42 7 C 72 5 102 6 124 11 C 129 10 134 6 139 3 C 138 7 140 11 146 13 C 158 15 168 17 176 20 C 181 15 184 11 188 6 C 184 14 182 18 181 22 C 185 27 188 33 190 39 C 184 34 178 31 172 29 C 152 36 124 41 100 43 C 88 43 76 44 66 43 C 68 47 70 50 72 53 C 65 52 59 47 54 43 C 40 40 27 36 15 32 C 10 31 5 29 2 27 Z' },
  { key: 'scuba',       w: 34, h: 14, url: 'https://en.wikipedia.org/wiki/Ahmed_Gabr', d: 'M 9 33 C 9 27 13 23 18 23 C 22 23 25 25 26 28 C 28 27 30 26 32 26 C 37 25 42 24 46 24 C 47 17 51 14 56 14 L 73 14 C 78 14 81 17 81 21 C 88 21 95 21 102 20 C 105 20 108 21 110 22 C 118 21 126 19 132 16 L 134 19 C 128 23 120 26 112 27 C 120 28 127 28 133 27 L 133 30 C 126 32 118 33 110 31 C 104 33 97 34 90 34 C 78 35 66 36 56 37 C 50 38 45 40 41 44 C 39 47 36 50 33 52 L 30 49 C 32 45 34 41 37 38 C 34 38 30 38 27 37 C 20 37 13 36 9 33 Z' },
  { key: 'snailfish',   w: 26, h: 12, url: 'https://en.wikipedia.org/wiki/Pseudoliparis_belyaevi', d: 'M 3 19 C 4 10 13 5 26 5 C 40 6 54 10 66 14 C 76 16 88 12 101 4 C 92 13 84 18 74 20 C 65 23 57 25 50 26 C 53 33 51 41 44 46 C 35 44 29 37 28 29 C 20 30 12 29 6 25 C 4 23 3 21 3 19 Z' }
];
const WC_SIL_IDX = {};
for (let i = 0; i < WC_SILS.length; i++) WC_SIL_IDX[WC_SILS[i].key] = i;
const wcSilSprites = new Array(WC_SILS.length).fill(null);   /* lazy baked; drawImage per frame */
function getSilSprite(idx) {
  if (wcSilSprites[idx]) return wcSilSprites[idx];
  const s = WC_SILS[idx];
  const cv = document.createElement('canvas');
  cv.width = s.w * SPRS; cv.height = s.h * SPRS;
  const g = cv.getContext('2d');
  g.scale(SPRS / 4, SPRS / 4);                    /* viewBox (4×) → logical, then SPRS oversample */
  g.fillStyle = TEXT_3;                           /* one ink — silhouette and caption read as one engraving */
  g.fill(new Path2D(s.d));
  wcSilSprites[idx] = cv;
  return cv;
}
function initDepthAnnotations() {
  /* placement is deterministic, computed once: natural depth position, then
     card rule (24px), strata rule (28px), sibling rule (20px) — in order */
  const shelfYs = DS.shelfIdx.map(b => (dYof(b - 1) + dYof(b)) / 2);
  const ys = [], labels = [], sils = [], l2s = [];
  for (const [d, label, silKey, line2] of WC_FACTS) {
    const silIdx = silKey ? WC_SIL_IDX[silKey] : -1;
    const hasSil = silIdx >= 0;
    /* silhouette entries need more air — the figure rides above the caption,
       so its whole stack (card / strata / sibling clearance) grows */
    const cardR = hasSil ? 40 : 24, strataR = hasSil ? 44 : 28, sibR = hasSil ? 52 : 20;
    let y;
    if (d < DS.wrM[0]) {
      y = WC_SURFACE_Y * (1 - d / DS.wrM[0]);    /* the surface region */
    } else {
      let iA = 0;
      for (let i = 0; i < DS.n; i++) if (DS.wrM[i] < d) iA = i;
      const i1 = Math.min(iA + 1, DS.n - 1);
      const span = DS.wrM[i1] - DS.wrM[iA];
      y = span > 0 ? lerp(dYof(iA), dYof(i1), (d - DS.wrM[iA]) / span) : dYof(iA);
    }
    /* card rule — never within cardR of a plate center; an exact landing
       (t = 1.0) yields to the shallow side */
    let ni = 0, nd = Infinity;
    for (let i = 0; i < DS.n; i++) {
      const dd = Math.abs(y - dYof(i));
      if (dd < nd) { nd = dd; ni = i; }
    }
    if (nd < cardR) y = y <= dYof(ni) ? dYof(ni) - cardR : dYof(ni) + cardR;
    /* strata rule — nudge deeper off a shelf ruler */
    for (const sy of shelfYs) if (Math.abs(y - sy) < strataR) y = sy + strataR;
    /* sibling rule — the later fact yields entirely */
    let clash = false;
    for (const py of ys) if (Math.abs(y - py) < sibR) { clash = true; break; }
    if (clash) continue;
    ys.push(Math.round(y));
    labels.push(label);
    sils.push(silIdx);
    l2s.push(line2 || '');
  }
  DS.annY = Float32Array.from(ys);
  DS.annLabel = labels;
  DS.annSil = Int8Array.from(sils);              /* sprite-table index, −1 = no figure */
  DS.annL2 = l2s;                                /* second caption line, '' = none */
  /* widths measured once — labels, font, and tracking are fixed at init
     (system font stack: no async webfont to wait for), so a scroll frame
     never allocates a TextMetrics. Export reuses the same CSS-px widths. */
  ctx.save();
  setType(ctx, 10, 500, false, 0.18);
  DS.annW = Float32Array.from(labels, l => ctx.measureText(l).width);
  DS.annL2W = Float32Array.from(l2s, l => l ? ctx.measureText(l).width : 0);
  DS.shelfW = Float32Array.from(DS.shelfLabel, l => ctx.measureText(l).width);
  ctx.restore();
}
function drawDepthAnnotations(c, w_, h_, cx, cy, Y0, alpha, scFocus, s, live) {
  if (alpha <= 0.01 || !DS.annY) return;
  c.save();
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  setType(c, 10, 500, false, 0.18);
  for (let k = 0; k < DS.annY.length; k++) {
    const wy = DS.annY[k];
    const ry = snap(cy + wy - Y0);
    if (ry < -30 || ry > h_ + 30) continue;
    const label = DS.annLabel[k];
    const tw = DS.annW[k];
    /* label yield — through the focused card's span the engraving slides
       left of the specimen instead of dying behind it. At rest it sits on
       the strata rulers' axis (w_/2) — one engraved centerline; the card
       lives at cx (they differ when the panel is open), so the dodge is
       gated on actual horizontal overlap (ov), also continuous. */
    /* the depth insights hold still on the centerline — engraved into the
       water like the strata rulers, they never slide to dodge the focused
       card (Simon: they must read as fixed depth markers, not reactive UI) */
    const lx = w_ / 2;
    c.globalAlpha = alpha;
    c.strokeStyle = 'rgba(233,237,242,0.08)';
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(0, ry + 0.5);
    c.lineTo(w_, ry + 0.5);
    c.stroke();
    c.globalAlpha = 1;
    c.fillStyle = GROUND_HEX_NOW;
    c.fillRect(lx - tw / 2 - 16, ry - 8, tw + 32, 17);
    c.globalAlpha = alpha;
    c.fillStyle = TEXT_3;
    c.fillText(label, lx, ry + 0.5);
    /* the figure rides ABOVE the caption on the SAME lx slide and alpha —
       Deference: when the label dodges the focused card, the figure dodges
       with it, one unit. Sprite bottom ≈ ry − 11, centered on lx; baked
       once in caption ink, drawImage only — no per-frame Path2D fill (§3). */
    const si = DS.annSil[k];
    if (si >= 0) {
      const sp = getSilSprite(si);
      const sw = WC_SILS[si].w, sh = WC_SILS[si].h;
      /* hover lift — the mark is a door; ink densifies, nothing moves (Feedback
         without motion; the engraving stays an engraving) */
      const hov = k === DS.annHover;
      c.globalAlpha = hov ? Math.min(1, alpha * 1.9) : alpha;
      c.drawImage(sp, snap(lx - sw / 2), snap(ry - 11 - sh), sw, sh);
      if (hov) {                                  /* re-print the caption denser too */
        c.fillStyle = TEXT_3;
        c.fillText(label, lx, ry + 0.5);
      }
      c.globalAlpha = alpha;
      /* the whole engraving — figure through caption(s) — is one door (§18e) */
      if (live && DS.annRectN < dAnnPool.length) {
        const r = dAnnPool[DS.annRectN++];
        r.k = k; r.url = WC_SILS[si].url;
        r.x = lx - Math.max(tw / 2 + 12, sw / 2 + 8);
        r.y = ry - 13 - sh;
        r.w = 2 * Math.max(tw / 2 + 12, sw / 2 + 8);
        r.h = (13 + sh) + (DS.annL2[k] ? 25 : 10);
      }
    }
    /* second caption line — same type, TEXT_3, its own ground knockout,
       ~15px under the first (hadal compression: snailfish's coda). */
    const l2 = DS.annL2[k];
    if (l2) {
      const t2 = DS.annL2W[k];
      const ry2 = ry + 15;
      c.globalAlpha = 1;
      c.fillStyle = GROUND_HEX_NOW;
      c.fillRect(lx - t2 / 2 - 16, ry2 - 8, t2 + 32, 17);
      /* the coda lifts with the rest of the engraving — one door, one unit */
      c.globalAlpha = k === DS.annHover ? Math.min(1, alpha * 1.9) : alpha;
      c.fillStyle = TEXT_3;
      c.fillText(l2, lx, ry2 + 0.5);
    }
  }
  c.restore();
}

/* --- the surface — light as a ceiling above the 0M line, no animation.
   A 1×256 strip baked once; ≤ +7.4/255 lift, fading within ~1.5 strata. --- */
let wcStrip = null;
function getWcStrip() {
  if (wcStrip) return wcStrip;
  const c = document.createElement('canvas');
  c.width = 1; c.height = 256;
  const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, 'rgba(168,188,202,0.04)');
  gr.addColorStop(1, 'rgba(168,188,202,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 1, 256);
  wcStrip = c;
  return c;
}
function drawSurfaceCeiling(c, w_, h_, cy, Y0, aMul) {
  if (aMul <= 0.01) return;
  const lineY = cy + WC_SURFACE_Y - Y0;
  if (lineY <= -h_ * 0.5) return;                /* the surface is far above — nothing prints */
  c.save();
  c.globalAlpha = aMul;
  c.drawImage(getWcStrip(), 0, lineY - 420, w_, 420);
  if (lineY - 420 > 0) {
    c.fillStyle = 'rgba(168,188,202,0.04)';      /* constant above the ramp — brightest at top */
    c.fillRect(0, 0, w_, lineY - 420);
  }
  c.restore();
}

/* ======================================================================
   17 · RESIZE + BOOT
   ====================================================================== */

function resize() {
  /* capped at 2, not 3. The atlas fills the viewport, so every extra DPR step
     is quadratic: a 1440x900 window is 5.2M pixels at 2x and 11.7M at 3x, and
     each of those frames also carries marine snow, the bubble column and up to
     ~160 live sprites. 3x buys detail almost nobody can resolve on a scene
     like this, and it costs the most on exactly the 3x phones least able to
     pay it. Text and card art stay crisp at 2x. */
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  W = window.innerWidth;
  H = window.innerHeight;
  canvas.width = Math.max(1, Math.round(W * dpr));
  canvas.height = Math.max(1, Math.round(H * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  rebuildVignette();
  DS.snowWrap = H + 240;         /* §18c — the marine-snow wrap tracks the viewport */
  sizeRuler();
  sizeSounding();                /* §18d — the line re-hangs at the new height */
  if (S.loaded) {
    const prevFit = S.fitZ;
    computeFit();
    if (Math.abs(S.cam.z - prevFit) < 1e-6) S.cam.z = S.fitZ;
    clampCam();
  }
  for (const w of S.watches) w._glow = null;   /* dpr may have changed */
  invalidate();
}

/* ======================================================================
   21 · THE FITTING — quiz + reveal
   Four independent binary threads (dreamTrip, virtue, water, era) converge
   on one watch; a multi-select nudges ties. Scoring is a pure function over
   FITTING (data/fitting.json). The reveal is the museum-plate poster; its
   DOM is what the 2× offscreen PNG export mirrors (see fitSavePoster).
   ====================================================================== */

/* ---- copy: the five screens (ANCHORS). Glyphs are hairline SVG, --lume-dim.
   Each binary option carries { axis, sign } → the answer emits sign on axis. ---- */
const FIT_GLYPH = {
  /* wayfinding / public-signage icons — bold, concrete, universally legible (AIGA lineage) */
  wild: '<svg viewBox="0 0 46 46" fill="currentColor"><path d="M3 37 L16 14 L24 27 L30 18 L43 37 Z"/><circle cx="31" cy="11" r="3.4"/></svg>',
  storied: '<svg viewBox="0 0 46 46" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round"><path d="M5 17 L23 7 L41 17"/><path d="M9 18 V33 M17 18 V33 M29 18 V33 M37 18 V33" stroke-width="3.2"/><path d="M5 34 H41" stroke-width="3"/></svg>',
  seen: '<svg viewBox="0 0 46 46" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 23 Q23 8 42 23 Q23 38 4 23 Z"/><circle cx="23" cy="23" r="5" fill="currentColor" stroke="none"/></svg>',
  outlast: '<svg viewBox="0 0 46 46" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="23" cy="8" r="3.6"/><path d="M23 12 V38"/><path d="M14 20 H32"/><path d="M8 28 Q8 39 23 39 Q38 39 38 28"/><path d="M8 28 L4 25 M8 28 L12 25 M38 28 L42 25 M38 28 L34 25"/></svg>',
  cold: '<svg viewBox="0 0 46 46" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4 V42 M7 13.5 L39 32.5 M39 13.5 L7 32.5"/><path d="M23 4 L19 8 M23 4 L27 8 M23 42 L19 38 M23 42 L27 38 M7 13.5 L8 19 M7 13.5 L12.5 12.5 M39 32.5 L38 27 M39 32.5 L33.5 33.5 M39 13.5 L33.5 12.5 M39 13.5 L38 19 M7 32.5 L12.5 33.5 M7 32.5 L8 27"/></svg>',
  warm: '<svg viewBox="0 0 46 46" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="23" cy="23" r="8" fill="currentColor" stroke="none"/><path d="M23 3 V9 M23 37 V43 M3 23 H9 M37 23 H43 M9 9 L13.2 13.2 M32.8 32.8 L37 37 M9 37 L13.2 32.8 M32.8 13.2 L37 9"/></svg>',
  origins: '<svg viewBox="0 0 46 46" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 34 H42"/><path d="M13 34 A10 10 0 0 1 33 34 Z" fill="currentColor" stroke="none"/><path d="M23 10 V15 M8.5 18 L12 21.5 M37.5 18 L34 21.5"/></svg>',
  next: '<svg viewBox="0 0 46 46" fill="currentColor"><path d="M23 4 L27.5 18.5 L42 23 L27.5 27.5 L23 42 L18.5 27.5 L4 23 L18.5 18.5 Z"/></svg>',
  mechanical: '<svg viewBox="0 0 46 46" fill="currentColor" fill-rule="evenodd"><path d="M39 23L43.6 27.1L40.5 34.7L34.3 34.3L34.7 40.5L27.1 43.6L23 39L18.9 43.6L11.3 40.5L11.7 34.3L5.5 34.7L2.4 27.1L7 23L2.4 18.9L5.5 11.3L11.7 11.7L11.3 5.5L18.9 2.4L23 7L27.1 2.4L34.7 5.5L34.3 11.7L40.5 11.3L43.6 18.9L39 23Z M23 16.5 A 6.5 6.5 0 1 0 23 29.5 A 6.5 6.5 0 1 0 23 16.5 Z"/></svg>',
  tough: '<svg viewBox="0 0 46 46" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linejoin="round"><path d="M23 4 L38 10 V22 Q38 34 23 42 Q8 34 8 22 V10 Z"/><path d="M16 22 L21 28 L31 16" stroke-width="2.8" stroke-linecap="round"/></svg>',
  history: '<svg viewBox="0 0 46 46" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round"><path d="M16 5 L23 19 L30 5"/><circle cx="23" cy="30" r="10"/><path d="M23 25 L24.7 28.6 L28.6 29.1 L25.8 31.9 L26.5 35.8 L23 34 L19.5 35.8 L20.2 31.9 L17.4 29.1 L21.3 28.6 Z" fill="currentColor" stroke="none"/></svg>',
  value: '<svg viewBox="0 0 46 46" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linejoin="round"><path d="M6 23 L23 6 H40 V23 L23 40 Z"/><circle cx="31.5" cy="14.5" r="2.7" fill="currentColor" stroke="none"/></svg>',
  grail: '<svg viewBox="0 0 46 46" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round"><path d="M12 7 H34 Q34 24 23 27 Q12 24 12 7 Z"/><path d="M23 27 V37 M14 41 H32 M17 41 Q17 37 23 37 Q29 37 29 41"/></svg>',
};

/* each ANSWER carries its own accent — a distinct, thematically-tuned hue from
   #F6935D's harmonies, so every choice feels like a unique act (icon + selected
   state + the progress bar all take the chosen answer's colour) */
const FIT_SCREENS = [
  {
    key: 'dreamTrip', axis: 'dreamTrip', type: 'binary',
    headline: 'Your dream trip',
    a: { glyph: 'wild',    sign: 1,  color: '#5FC98A', title: 'Wild and remote',  sub: 'Off the map, into the unknown.' },
    b: { glyph: 'storied', sign: -1, color: '#E8B24C', title: 'Rich and storied', sub: 'History, culture, comfort.' },
  },
  {
    key: 'virtue', axis: 'virtue', type: 'binary',
    headline: 'When it matters most',
    a: { glyph: 'seen',    sign: 1,  color: '#F6935D', title: 'Be seen',   sub: 'Clarity. Presence. Read at a glance.' },
    b: { glyph: 'outlast', sign: -1, color: '#6E8BC4', title: 'Outlast it', sub: 'Endurance. Take whatever comes.' },
  },
  {
    key: 'water', axis: 'water', type: 'binary',
    headline: 'The water you’re from',
    a: { glyph: 'cold', sign: 1,  color: '#4FB8D4', title: 'Cold and deep', sub: 'Grey, serious — the far north.' },
    b: { glyph: 'warm', sign: -1, color: '#F27E6B', title: 'Warm and open', sub: 'Bright, alive — the reef.' },
  },
  {
    key: 'era', axis: 'era', type: 'binary',
    headline: 'What draws you',
    a: { glyph: 'origins', sign: 1,  color: '#D69A5C', title: 'The origins', sub: 'Where it began.' },
    b: { glyph: 'next',    sign: -1, color: '#9E7DEA', title: 'What’s next', sub: 'Modern. Made today.' },
  },
  {
    key: 'extras', type: 'multi',
    headline: 'Anything else that’s you',
    sub: 'Pick any — or skip.',
    options: [
      { flag: 'mechanical', glyph: 'mechanical', color: '#4FB8D4', title: 'Mechanical soul',    sub: 'A movement, not a battery.' },
      { flag: 'tough', glyph: 'tough',      color: '#5FC98A', title: 'Built to be beaten up', sub: 'Scars are the point.' },
      { flag: 'history', glyph: 'history',    color: '#E8B24C', title: 'A piece of history',  sub: 'It was there.' },
      { flag: 'value', glyph: 'value',      color: '#F6935D', title: 'Value over logo',     sub: 'Substance, not the badge.' },
      { flag: 'grail', glyph: 'grail',      color: '#9E7DEA', title: 'The grail',           sub: 'The one you’d chase.' },
    ],
  },
];

/* country → full name for the poster ref line (mirrors LENS_CHIPS.origin) */
const FIT_COUNTRY = {
  CH: 'Switzerland', DE: 'Germany', JP: 'Japan', FR: 'France', GB: 'United Kingdom',
  US: 'United States', RU: 'Russia', IT: 'Italy', OTHER: 'International',
};

/* --- state --- */
const fitEl = {};              /* cached DOM, lazily bound on first open */
let fitBound = false;
let fitOpen = false;
let fitStep = 0;               /* 0..4 */
const fitAnswers = {};         /* axis → sign (binary) */
const fitExtras = new Set();   /* multi flags */
let fitResult = null;          /* { best, runnerUp } after scoring */
let fitPrevFocus = null;
let fitTurnTimer = null, fitAdvTimer = null;

function bindFitting() {
  if (fitBound) return;
  fitBound = true;
  fitEl.root = $('fitting');
  fitEl.quiz = $('fit-quiz');
  fitEl.fill = $('fq-fill');
  fitEl.round = $('fq-round');
  fitEl.back = $('fq-back');
  fitEl.close = $('fq-close');
  fitEl.stage = $('fq-stage');
  fitEl.headline = $('fq-headline');
  fitEl.cards = $('fq-cards');
  fitEl.actions = $('fq-actions');
  fitEl.continue = $('fq-continue');
  fitEl.skip = $('fq-skip');
  fitEl.reveal = $('fit-reveal');
  fitEl.img = $('fr-img');
  fitEl.archetype = $('fr-archetype');
  fitEl.rname = $('fr-name');
  fitEl.ref = $('fr-ref');
  fitEl.why = $('fr-why');
  fitEl.whyText = $('fr-why-text');
  fitEl.alt = $('fr-alt');
  fitEl.see = $('fr-see');
  fitEl.save = $('fr-save');
  fitEl.share = $('fr-share');
  fitEl.restart = $('fr-restart');
  fitEl.recv = $('fr-received');
  fitEl.take = $('fr-take');

  fitEl.close.addEventListener('click', closeFitting);
  { const bm = $('fr-brandmark'); if (bm) bm.addEventListener('click', fitToSpiral); }
  fitEl.back.addEventListener('click', fitBack);
  fitEl.continue.addEventListener('click', () => fitAdvance());
  fitEl.skip.addEventListener('click', () => fitAdvance());
  fitEl.see.addEventListener('click', fitSeeInAtlas);
  fitEl.save.addEventListener('click', fitSavePoster);
  fitEl.share.addEventListener('click', fitShare);
  fitEl.restart.addEventListener('click', fitRestart);
  if (fitEl.take) fitEl.take.addEventListener('click', fitTake);

  /* the sheet — channel rows, Escape, and click-away. Non-modal by choice: it
     is a short list of links, not a task, and a focus trap would be heavier
     machinery than the thing it guards. */
  { const sheet = $('fr-sheet');
    if (sheet) sheet.addEventListener('click', e => {
      const btn = e.target.closest('.fr-ch');
      if (btn) fitChannel(btn.dataset.ch);
    });
    document.addEventListener('click', e => {
      /* a pinned preview dismisses on the next tap anywhere else — the way a
         popover should, since there is no cursor to leave on a touch screen */
      if (fitAltPinned && !e.target.closest('.fr-alt-link') && !e.target.closest('#watch-preview')) {
        fitAltUnpin();
      }
      if (!fitSheetOpen) return;
      if (e.target.closest('#fr-sheet') || e.target.closest('#fr-share')) return;
      fitSheetToggle(false);
    });
  }

  /* the engraving */
  { const tog = $('fr-inscribe-toggle'), row = $('fr-inscribe-row'),
          inp = $('fr-inscribe-input'), cnt = $('fr-inscribe-count'), done = $('fr-inscribe-done');
    if (tog && row && inp) {
      tog.addEventListener('click', () => {
        const open = row.hidden;
        row.hidden = !open;
        tog.setAttribute('aria-expanded', open ? 'true' : 'false');
        tog.textContent = open ? 'Inscription' : (fitInscription ? 'Edit inscription' : 'Add an inscription');
        if (open) requestAnimationFrame(() => { try { inp.focus(); } catch (e) {} });
      });
      /* live: it appears on the plate as it is typed — the whole point */
      inp.addEventListener('input', () => {
        fitSetInscription(inp.value);
        if (cnt) cnt.textContent = String(32 - inp.value.length);
      });
      inp.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); done && done.click(); }
        if (e.key === 'Escape') { e.preventDefault(); inp.value = ''; fitSetInscription(''); done && done.click(); }
      });
      if (done) done.addEventListener('click', () => {
        row.hidden = true;
        tog.setAttribute('aria-expanded', 'false');
        tog.textContent = fitInscription ? 'Edit inscription' : 'Add an inscription';
        try { tog.focus(); } catch (e) {}
      });
    }
  }

  /* keyboard: overlay owns keys while open (mirrors lightbox pattern) */
  fitEl.root.addEventListener('keydown', onFitKey);
}

const chipEntry = () => $('fitting-chip');

function openFitting(opts) {
  if (!FITTING) { pendingFitOpen = opts || true; return; }   /* wait for data */
  bindFitting();
  if (fitOpen) return;
  fitOpen = true;
  fitPrevFocus = document.activeElement;
  fitStep = 0;
  fitResult = null;
  for (const k in fitAnswers) delete fitAnswers[k];
  fitExtras.clear();
  fitEl.reveal.hidden = true;
  fitEl.quiz.style.display = '';
  fitEl.root.classList.remove('reveal-mode');
  fitEl.root.hidden = false;

  /* a received plate lands straight on the reveal — the sender's result, framed
     as theirs. Unknown id falls through to the quiz rather than erroring out. */
  const rec = opts && opts.received;
  if (rec && FITTING[rec]) {
    fitResult = { best: { id: rec }, runnerUp: null };
    renderReveal({ received: true });
  } else {
    renderFitStep(false);
  }
  /* fade in (mirrors #no-match: hidden→false, then .on next frame) */
  requestAnimationFrame(() => requestAnimationFrame(() => fitEl.root.classList.add('on')));
  /* park the render loop concerns — the overlay covers the canvas */
  const sig = (rec && FITTING[rec]) ? '#fit&r=' + rec : '#fit';
  try { history.replaceState(null, '', sig); urlSig = sig; } catch (e) { /* file:// */ }
}

function closeFitting() {
  if (!fitOpen) return;
  fitAltUnpin();          /* a pinned preview must not outlive the panel it belongs to */
  fitOpen = false;
  clearTimeout(fitTurnTimer); clearTimeout(fitAdvTimer);
  fitEl.root.classList.remove('on');
  const done = () => { fitEl.root.hidden = true; };
  if (REDUCED) done(); else setTimeout(done, 260);
  if (fitPrevFocus && fitPrevFocus.focus) { try { fitPrevFocus.focus(); } catch (e) {} }
  /* restore the URL to the world underneath */
  urlSig = '';
  scheduleURLWrite();
  invalidate();
}

/* ---- render a quiz screen ---- */
/* per-question accent — a spectrum walk drawn from #F6935D's harmonies; the
   "sea time" mark stays orange, only the question's accent shifts (progress,
   selected state, icons). warm → rose → ocean → jade → violet. */
function renderFitStep(animate) {
  const s = FIT_SCREENS[fitStep];
  const pct = Math.round(((fitStep + 1) / FIT_SCREENS.length) * 100);
  fitEl.fill.style.width = pct + '%';
  fitEl.round.textContent = 'Round ' + (fitStep + 1) + ' / ' + FIT_SCREENS.length;
  fitEl.back.hidden = fitStep === 0;

  const paint = () => {
    fitEl.headline.textContent = s.headline;
    fitEl.cards.innerHTML = '';
    fitEl.cards.classList.toggle('multi', s.type === 'multi');
    if (s.type === 'binary') {
      fitEl.actions.hidden = true;
      const cur = fitAnswers[s.axis];
      fitEl.cards.appendChild(fitBinaryCard(s, s.a, cur === s.a.sign));
      const vs = document.createElement('div');
      vs.id = 'fq-vs'; vs.textContent = 'vs'; vs.setAttribute('aria-hidden', 'true');
      fitEl.cards.appendChild(vs);
      fitEl.cards.appendChild(fitBinaryCard(s, s.b, cur === s.b.sign));
    } else {
      fitEl.actions.hidden = false;
      s.options.forEach(opt => fitEl.cards.appendChild(fitMultiChip(opt)));
      fitEl.continue.textContent = fitExtras.size ? 'Continue' : 'Continue';
    }
    /* focus the first interactive control for keyboard flow */
    const first = fitEl.cards.querySelector('.fq-card, .fq-chip');
    if (first) requestAnimationFrame(() => { try { first.focus(); } catch (e) {} });
  };

  if (animate && !REDUCED) {
    fitEl.stage.classList.add('turning');
    clearTimeout(fitTurnTimer);
    fitTurnTimer = setTimeout(() => {
      paint();
      requestAnimationFrame(() => fitEl.stage.classList.remove('turning'));
    }, 200);
  } else {
    paint();
    fitEl.stage.classList.remove('turning');
  }
}

function fitBinaryCard(screen, opt, chosen) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'fq-card' + (chosen ? ' chosen' : '');
  if (opt.color) btn.style.setProperty('--fq-accent', opt.color);   /* this answer's own hue */
  btn.setAttribute('role', 'radio');
  btn.setAttribute('aria-checked', chosen ? 'true' : 'false');
  btn.innerHTML =
    '<span class="fq-card-glyph">' + FIT_GLYPH[opt.glyph] + '</span>' +
    '<span class="fq-card-body"><span class="fq-card-title"></span><span class="fq-card-sub"></span></span>' +
    '<svg class="fq-card-check" viewBox="0 0 22 22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="9.3" opacity="0.5"/><path d="M6.5 11.2 L9.6 14.2 L15.5 7.8"/></svg>';
  btn.querySelector('.fq-card-title').textContent = opt.title;
  btn.querySelector('.fq-card-sub').textContent = opt.sub;
  btn.addEventListener('click', () => fitChooseBinary(screen, opt, btn));
  return btn;
}

function fitMultiChip(opt) {
  const on = fitExtras.has(opt.flag);
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'fq-chip' + (on ? ' chosen' : '');
  if (opt.color) btn.style.setProperty('--fq-accent', opt.color);   /* this answer's own hue */
  btn.setAttribute('role', 'checkbox');
  btn.setAttribute('aria-checked', on ? 'true' : 'false');
  btn.innerHTML =
    '<span class="fq-chip-glyph">' + (FIT_GLYPH[opt.glyph] || '') + '</span>' +
    '<span class="fq-chip-body"><span class="fq-chip-title"></span><span class="fq-chip-sub"></span></span>' +
    '<span class="fq-chip-box"><svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 6.2 L5 8.6 L9.5 3.4"/></svg></span>';
  btn.querySelector('.fq-chip-title').textContent = opt.title;
  btn.querySelector('.fq-chip-sub').textContent = opt.sub;
  btn.addEventListener('click', () => {
    if (fitExtras.has(opt.flag)) fitExtras.delete(opt.flag); else fitExtras.add(opt.flag);
    const now = fitExtras.has(opt.flag);
    btn.classList.toggle('chosen', now);
    btn.setAttribute('aria-checked', now ? 'true' : 'false');
  });
  return btn;
}

function fitChooseBinary(screen, opt, btn) {
  fitAnswers[screen.axis] = opt.sign;
  /* light this card, clear the sibling */
  fitEl.cards.querySelectorAll('.fq-card').forEach(c => {
    const isMe = c === btn;
    c.classList.toggle('chosen', isMe);
    c.setAttribute('aria-checked', isMe ? 'true' : 'false');
  });
  /* auto-advance — the whole "effortless" feel (no Next on binaries) */
  clearTimeout(fitAdvTimer);
  fitAdvTimer = setTimeout(() => fitAdvance(), REDUCED ? 120 : 420);
}

function fitAdvance() {
  clearTimeout(fitAdvTimer);
  if (fitStep < FIT_SCREENS.length - 1) {
    fitStep++;
    renderFitStep(true);
  } else {
    fitFinish();
  }
}

function fitBack() {
  clearTimeout(fitAdvTimer);
  if (fitStep === 0) return;
  fitStep--;
  renderFitStep(true);
}

/* ---- SCORING — pure over FITTING; deterministic ---- */
/* ---- THE FORMULA, v2 -----------------------------------------------------
   The old score was a raw dot product plus a flat +0.35·distinct bonus. Both
   reward MAGNITUDE: a watch with extreme weights on every axis outscored a
   moderate watch even on the moderate watch's own home turf, and the same
   four heroes soaked a third of all answer paths. Measured before rewriting:
   pool of 20 reachable watches out of 146; Fifty Fathoms alone took 14% of
   the extras space.

   v2 scores PROXIMITY — the watch whose authored personality sits nearest the
   visitor's answers, per axis, wins. Extremity now costs on any axis the
   visitor didn't choose. Extras are proximity too, and distinct is demoted to
   a pure tiebreak.

   Then the shortlist: every watch within EPS of the best fit is a genuine
   near-tie — the honest answer is "any of these" — so the visitor's EXACT
   combination (a hash of all nine choices) selects among them. Same answers
   always land the same plate, so results stay shareable and repeatable; a
   neighbour whose one different extra flips a near-tie gets a different
   watch, which is precisely the claim the quiz makes.

   Measured after: all 16 binary paths land on 16 different watches; the full
   512-combination space reaches 82 of 148; no watch holds more than 6.4%. */
const FIT_EPS = 0.5, FIT_K = 7;

function fitProfileSeed() {
  const AXES = ['dreamTrip', 'virtue', 'water', 'era'];
  const s = AXES.map(ax => String(fitAnswers[ax] ?? null)).join(',')
    + '|' + [...fitExtras].sort().join(',');
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h;
}

function fitScore() {
  const AXES = ['dreamTrip', 'virtue', 'water', 'era'];
  const FLAGS = ['mechanical', 'tough', 'history', 'value', 'grail'];
  const rows = [];
  for (const id in FITTING) {
    const f = FITTING[id];
    if (!f) continue;
    if (S.byId && !S.byId.has(id)) continue;   /* the winner must be a watch on the map */
    let s = 0;
    for (const ax of AXES) {
      const ans = fitAnswers[ax];
      if (ans == null) continue;               /* skipped axis constrains nothing */
      const w = typeof f[ax] === 'number' ? f[ax] : 0;
      s -= (ans - w) * (ans - w);
    }
    for (const fl of FLAGS) {
      if (!fitExtras.has(fl)) continue;
      const w = typeof f[fl] === 'number' ? f[fl] : 0;
      s -= 0.8 * (1 - w) * (1 - w);
    }
    rows.push({ id, s, distinct: typeof f.distinct === 'number' ? f.distinct : 0.5 });
  }
  rows.sort((a, b) =>
    b.s - a.s ||
    b.distinct - a.distinct ||         /* tiebreak → more characterful */
    (a.id < b.id ? -1 : 1));           /* final deterministic tiebreak */
  if (!rows.length) return { best: null, runnerUp: null };

  const short = rows.filter(r => rows[0].s - r.s <= FIT_EPS).slice(0, FIT_K);
  const best = short[fitProfileSeed() % short.length];

  /* the other life should be a genuinely different life — the strongest fit
     from another design family, not the same watch one reference over */
  const fam = id => (S.byId && S.byId.get(id) || {}).designFamily || null;
  const bestFam = fam(best.id);
  const runnerUp = rows.find(r => r.id !== best.id && fam(r.id) !== bestFam)
    || rows.find(r => r.id !== best.id) || null;
  return { best, runnerUp };
}

/* ---- compose the convergence line from the user's actual answers ---- */
function fitConvergence() {
  const parts = [];
  if (fitAnswers.water === 1) parts.push('Cold water');
  else if (fitAnswers.water === -1) parts.push('Warm water');
  if (fitAnswers.virtue === 1) parts.push('seen not hidden');
  else if (fitAnswers.virtue === -1) parts.push('built to outlast');
  if (fitAnswers.dreamTrip === 1) parts.push('drawn to the wild');
  else if (fitAnswers.dreamTrip === -1) parts.push('drawn to the storied');
  if (fitAnswers.era === 1) parts.push('born of the origins');
  else if (fitAnswers.era === -1) parts.push('made for what’s next');
  let clause = parts.length ? parts.join(', ') : 'When it all converges';
  /* Sentence-case the first word only */
  return clause.charAt(0).toUpperCase() + clause.slice(1);
}

function fitFinish() {
  fitResult = fitScore();
  if (!fitResult || !fitResult.best) { closeFitting(); return; }
  renderReveal();
}

/* ---- THE REVEAL — populate the museum-plate poster ---- */
function fitWatchMeta(id) {
  const w = (S.byId && S.byId.get(id)) || null;
  const f = FITTING[id] || {};
  const brand = w ? (w.brand || '') : '';
  const model = w ? (w.model || '') : '';
  const name = (brand + ' ' + model).trim() || id;
  const country = w ? (FIT_COUNTRY[w.country] || w.country || '') : '';
  const year = w && w.year ? String(w.year) : '';
  /* the fitting's own authored line first — written FOR this moment and unused
     until now; the encyclopedic significance is the fallback, the generic
     convergence sentence last */
  const insight = f.hook || (w && w.significance) || fitConvergence();
  return {
    id, w, f, name, insight,
    archetype: (f.archetype || name).toUpperCase(),
    ref: [country, year].filter(Boolean).join(' · '),
  };
}

/* reveal: preview the runner-up watch, anchored to the hovered archetype word.
   Reuses the map's #watch-preview card but positions it off the word's rect. */
function fitPreviewShow(id, anchorEl) {
  const w = S.byId && S.byId.get(id);
  if (!w || !anchorEl) return;
  clearTimeout(wpHideTimer);
  elWpMedia.innerHTML = '';
  const pick = (CATALOG[id] && CATALOG[id].file) ? CATALOG[id] : null;
  if (pick) {
    const img = document.createElement('img');
    img.src = './data/' + pick.file; img.alt = '';
    img.addEventListener('error', () => { img.remove(); wpGlyphFallback(w); });
    elWpMedia.appendChild(img);
  } else { wpGlyphFallback(w); }
  elWpOverline.textContent = String(w.brand || '').toUpperCase();
  elWpName.textContent = w.model || '';
  const price = Array.isArray(w.priceBandUsd) && w.priceBandUsd.length === 2
    ? `${fmtShortUsd(w.priceBandUsd[0])}–${fmtShortUsd(w.priceBandUsd[1])}` : '';
  elWpMeta.textContent = [w.reference ? `Ref. ${w.reference}` : null, w.year,
    isFinite(w.diameterMm) ? `Ø ${w.diameterMm} mm` : null, price].filter(Boolean).join(' · ');
  const r = anchorEl.getBoundingClientRect();
  elWatchPreview.style.visibility = 'hidden';
  elWatchPreview.hidden = false;
  const cw = elWatchPreview.offsetWidth, chh = elWatchPreview.offsetHeight;
  const px = clamp(r.left + r.width / 2 - cw / 2, 16, window.innerWidth - cw - 16);
  let py = r.top - chh - 12;
  if (py < 16) py = r.bottom + 12;
  py = clamp(py, 16, window.innerHeight - chh - 16);
  elWatchPreview.style.left = px + 'px';
  elWatchPreview.style.top = py + 'px';
  elWatchPreview.style.visibility = '';
  requestAnimationFrame(() => elWatchPreview.classList.add('on'));
}

function renderReveal(opts) {
  const b = fitWatchMeta(fitResult.best.id);
  const count = (S.watches && S.watches.length) || Object.keys(FITTING).length;
  /* received = this plate belongs to whoever sent the link, not to the viewer */
  const received = !!(opts && opts.received);

  fitEl.img.src = 'data/img-catalog/' + b.id + '.jpg';
  fitEl.img.alt = b.name;
  fitEl.archetype.textContent = b.archetype;
  fitEl.rname.textContent = b.name.toUpperCase();
  fitEl.ref.textContent = b.ref.toUpperCase();

  /* WHY THIS WATCH, RIGHT NOW — the fitting's authored hook (see fitWatchMeta) */
  if (fitEl.whyText) fitEl.whyText.textContent = b.insight;

  /* plate foot — kept identical to the PNG (buildPoster) so the screen and the
     shared image never disagree about the address or the edition number */
  const host = $('fr-host'), serialNo = $('fr-serial-no');
  if (host) host.textContent = SITE_HOST;
  if (serialNo) {
    const rank = (S.watches ? S.watches.findIndex(w => w.id === b.id) : -1) + 1;
    serialNo.textContent = (rank ? 'No.' + String(rank).padStart(3, '0') : 'No.—') + ' / ' + count;
  }

  /* "in another life, you're the {runnerUp.archetype}" */
  if (fitResult.runnerUp) {
    const ru = fitWatchMeta(fitResult.runnerUp.id);
    const raw = (ru.f.archetype || ru.name);
    /* the archetype usually already carries its article ("The Snowflake") — don't
       double it; otherwise supply a lowercase "the" */
    const lead = /^the\b/i.test(raw.trim()) ? 'In another life, you’re ' : 'In another life, you’re the ';
    fitEl.alt.innerHTML = lead + '<em></em>.';
    const em = fitEl.alt.querySelector('em');
    em.textContent = raw;
    /* The archetype previews the runner-up. It used to bind hover and focus
       ONLY, which made it a lie on a phone: underlined, role="button", and
       completely inert to a tap. Pointer-independent activation now drives it,
       and hover stays as the desktop shortcut. */
    const ruId = fitResult.runnerUp.id;
    em.className = 'fr-alt-link';
    em.tabIndex = 0;
    em.setAttribute('role', 'button');
    em.setAttribute('aria-expanded', 'false');
    em.setAttribute('aria-label', 'Preview ' + ru.name);
    fitAltPinned = false;

    const setPinned = on => {
      fitAltPinned = on;
      em.setAttribute('aria-expanded', on ? 'true' : 'false');
      if (on) fitPreviewShow(ruId, em); else hideWatchPreview();
    };
    em.onclick = e => { e.preventDefault(); setPinned(!fitAltPinned); };
    /* a span with role="button" gets no synthesised click from the keyboard —
       Enter and Space have to be wired by hand */
    em.onkeydown = e => {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault(); setPinned(!fitAltPinned);
      }
    };
    em.onmouseenter = () => { if (!fitAltPinned) fitPreviewShow(ruId, em); };
    em.onmouseleave = () => { if (!fitAltPinned) hideWatchPreview(); };
    em.onfocus = () => { if (!fitAltPinned) fitPreviewShow(ruId, em); };
    em.onblur = () => { if (!fitAltPinned) hideWatchPreview(); };
    fitEl.altLink = em;
    fitEl.alt.hidden = false;
  } else {
    fitEl.alt.hidden = true;
  }

  /* ---- MODE: yours vs. received ----
     Received hides the runner-up (it's not the viewer's other life), states
     whose plate this is, and collapses the action row to a single invitation. */
  fitEl.root.classList.toggle('received', received);
  if (received) fitEl.alt.hidden = true;
  /* a received plate is someone else's — you do not engrave another man's watch */
  { const insc = $('fr-inscribe'); if (insc) insc.hidden = received; }
  fitSheetToggle(false);
  fitPaintInscription();
  if (fitEl.recv) fitEl.recv.hidden = !received;
  if (fitEl.take) fitEl.take.hidden = !received;
  fitEl.share.hidden = received;
  fitEl.restart.hidden = received;
  /* on a phone the share sheet already offers "Save Image", so a second button
     for it is noise. Desktop Chrome also reports canShare({files}) but its sheet
     is AirDrop/Mail/Messages with no save path — so gate on a coarse pointer,
     not on capability alone, and keep Save wherever a file is the real want. */
  const touchSheet = canShareFiles() &&
    (window.matchMedia ? window.matchMedia('(pointer: coarse)').matches : false);
  fitEl.save.hidden = received || touchSheet;

  /* swap quiz → reveal */
  fitEl.quiz.style.display = 'none';
  fitEl.reveal.hidden = false;
  fitEl.root.classList.add('reveal-mode');
  fitScalePoster();

  /* draw the PNG now so the share tap stays inside the user gesture */
  if (!received) fitPrimePoster(b.id);

  /* cinematic bloom (REDUCED = plain, no animation class) */
  fitEl.reveal.classList.remove('fr-bloom');
  if (!REDUCED) requestAnimationFrame(() => fitEl.reveal.classList.add('fr-bloom'));

  const focusTarget = received ? fitEl.take : fitEl.see;
  requestAnimationFrame(() => { try { focusTarget.focus(); } catch (e) {} });
}

/* received → take your own: drop the sender's result and start the quiz clean */
function fitTake() {
  fitEl.root.classList.remove('received');
  if (fitEl.recv) fitEl.recv.hidden = true;
  if (fitEl.take) fitEl.take.hidden = true;
  fitEl.share.hidden = false;
  fitEl.restart.hidden = false;
  fitRestart();
  try { history.replaceState(null, '', '#fit'); urlSig = '#fit'; } catch (e) {}
}

/* scale the 1080×1350 poster to fit the viewport, reserving its scaled height */
function fitScalePoster() {
  const poster = $('fr-poster');
  if (!poster) return;
  const avail = Math.min(window.innerWidth - 32, 620);
  const scale = Math.min(1, avail / 1080);
  poster.style.setProperty('--poster-scale', scale);
  /* the scaled poster is transform-only; reserve layout height so the actions
     sit below it, not on top */
  poster.style.marginBottom = (1350 * scale - 1350) + 'px';
}

/* ---- REVEAL ACTIONS ---- */
/* the "sea time" mark on the reveal → close the fitting and return to the spiral */
function fitToSpiral() {
  closeFitting();
  try { history.replaceState(null, '', '#m=descent'); urlSig = '#m=descent'; } catch (e) {}
  if (S.mode !== 'descent') defaultToDescent();
  invalidate();
}

function fitSeeInAtlas() {
  if (!fitResult || !fitResult.best) return;
  const id = fitResult.best.id;
  closeFitting();
  /* land the watch in descent (mirrors applyDeepLink #m=descent&w=<id>) */
  try {
    history.replaceState(null, '', '#m=descent&w=' + id);
    urlSig = '#m=descent&w=' + id;
  } catch (e) {}
  if (S.byId && S.byId.has(id)) {
    if (S.mode !== 'descent') defaultToDescent();
    const ww = S.byId.get(id);
    if (isFinite(ww._di)) { DS.s = ww._di; DS.lastFocus = -1; refreshFocus(); }
    selectWatch(id, { fly: false });
  }
  invalidate();
}

/* the phone's own sheet beats anything we can draw — it holds Instagram, X,
   Threads, WhatsApp and Messages in the user's own app order, and it can carry
   the PNG. Our sheet exists for the desktop, where no such thing is offered. */
function prefersOSSheet() {
  return canShareFiles() &&
    (window.matchMedia ? window.matchMedia('(pointer: coarse)').matches : false);
}

function fitShareText() {
  const b = fitWatchMeta(fitResult.best.id);
  const count = (S.watches && S.watches.length) || Object.keys(FITTING).length;
  /* written as the sender, in the site's register — no "check out", no hype */
  return { b, url: fitShareURL(b.id),
           text: 'The Fitting put me on the ' + b.name + '. ' + count + ' dive watches, one plate.' };
}

function fitShare() {
  if (!fitResult || !fitResult.best) return;
  const { b, url, text } = fitShareText();

  if (prefersOSSheet()) {
    const blob = (fitPoster.id === b.id) ? fitPoster.blob : null;
    if (blob) {
      const file = new File([blob], 'the-fitting-' + b.id + '.png', { type: 'image/png' });
      navigator.share({ files: [file], text, url })
        .then(() => { elLive.textContent = 'Shared.'; })
        .catch(() => {});   /* AbortError = user dismissed the sheet; say nothing */
      return;
    }
    navigator.share({ text, url }).catch(() => {});
    return;
  }
  fitSheetToggle();          /* desktop: our own, named */
}

/* ---- THE SHEET ---------------------------------------------------------- */
let fitSheetOpen = false;
/* the runner-up preview, held open by tap/Enter rather than by a hovering cursor */
let fitAltPinned = false;

function fitAltUnpin() {
  if (!fitAltPinned) return;
  fitAltPinned = false;
  if (fitEl.altLink) fitEl.altLink.setAttribute('aria-expanded', 'false');
  hideWatchPreview();
}

function fitSheetToggle(force) {
  const sheet = $('fr-sheet');
  if (!sheet) return;
  const open = force === undefined ? !fitSheetOpen : force;
  if (open === fitSheetOpen) return;
  fitSheetOpen = open;
  sheet.hidden = !open;
  fitEl.share.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (open) {
    const first = sheet.querySelector('.fr-ch');
    if (first) requestAnimationFrame(() => { try { first.focus(); } catch (e) {} });
  } else {
    try { fitEl.share.focus(); } catch (e) {}      /* focus goes back where it came from */
  }
}

function fitChannel(ch) {
  if (!fitResult || !fitResult.best) return;
  const { b, url, text } = fitShareText();
  const enc = encodeURIComponent;
  let href = '';
  if (ch === 'instagram') {
    /* Instagram publishes NO web intent — there is no URL that opens a composer
       with an image. Pretending otherwise with a button that goes nowhere is the
       one thing worse than not offering it. So we do the only true thing: hand
       over the plate and say plainly what happens next. */
    fitSavePoster();
    elLive.textContent = 'Plate saved. Post it to Instagram from your photos.';
    fitSheetToggle(false);
    return;
  }
  if (ch === 'copy') {
    const done = () => { elLive.textContent = 'Link copied.'; fitSheetToggle(false); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(done).catch(() => fallbackCopy(url, done));
    } else fallbackCopy(url, done);
    return;
  }
  if (ch === 'x')        href = 'https://x.com/intent/tweet?text=' + enc(text) + '&url=' + enc(url);
  else if (ch === 'reddit')   href = 'https://www.reddit.com/submit?url=' + enc(url) + '&title=' + enc(text);
  else if (ch === 'whatsapp') href = 'https://wa.me/?text=' + enc(text + ' ' + url);
  if (!href) return;
  window.open(href, '_blank', 'noopener,noreferrer');
  elLive.textContent = 'Opening ' + ch + '.';
  fitSheetToggle(false);
}
function fallbackCopy(text, done) {
  try {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    document.execCommand('copy'); document.body.removeChild(ta);
    done();
  } catch (e) { elLive.textContent = 'Copy failed.'; }
}
function flashBtn(btn, msg) {
  if (!btn) return;
  const orig = btn.textContent;
  btn.textContent = msg;
  setTimeout(() => { if (fitOpen) btn.textContent = orig; }, 1600);
}

function fitRestart() {
  fitStep = 0;
  fitResult = null;
  for (const k in fitAnswers) delete fitAnswers[k];
  fitExtras.clear();
  fitAltUnpin();
  /* a new fitting is a new watch — the old engraving does not follow it */
  fitInscription = '';
  fitPaintInscription();
  fitSheetToggle(false);
  { const inp = $('fr-inscribe-input'), row = $('fr-inscribe-row'),
          tog = $('fr-inscribe-toggle'), cnt = $('fr-inscribe-count');
    if (inp) inp.value = '';
    if (cnt) cnt.textContent = '32';
    if (row) row.hidden = true;
    if (tog) { tog.textContent = 'Add an inscription'; tog.setAttribute('aria-expanded', 'false'); } }
  fitEl.reveal.hidden = true;
  fitEl.reveal.classList.remove('fr-bloom');
  fitEl.quiz.style.display = '';
  fitEl.root.classList.remove('reveal-mode');
  renderFitStep(false);
}

/* ---- BUILD THE PLATE — 2× offscreen canvas → toBlob (mirrors doExport ~3690).
   Redraws the poster spec onto a 2160×2700 canvas so the PNG is frame-worthy
   and independent of the on-screen scale.

   opts.tall → 1080×1920 instead of 1080×1350. Same plate, same geometry; the
   ground vignette simply keeps going above and below it, so a Stories post has
   no letterbox seam and no platform-generated blur behind the frame.
   Returns a Promise<Blob|null>. ---- */
function buildPoster(opts) {
  return new Promise(resolve => {
  if (!fitResult || !fitResult.best) { resolve(null); return; }
  const b = fitWatchMeta(fitResult.best.id);
  const count = (S.watches && S.watches.length) || Object.keys(FITTING).length;
  const scale = 2;
  const W0 = 1080, H0 = 1350;
  const OUT_H = (opts && opts.tall) ? 1920 : H0;
  const oc = document.createElement('canvas');
  oc.width = W0 * scale; oc.height = OUT_H * scale;
  const c = oc.getContext('2d');
  c.scale(scale, scale);

  /* ground: radial vignette — drawn across the FULL output height */
  const g = c.createRadialGradient(W0 / 2, OUT_H / 2, 0, W0 / 2, OUT_H / 2, Math.max(W0, OUT_H) * 0.75);
  g.addColorStop(0, '#06080B'); g.addColorStop(0.52, '#06080B'); g.addColorStop(1, '#04050A');
  c.fillStyle = g; c.fillRect(0, 0, W0, OUT_H);

  /* centre the plate — every coordinate below stays plate-local (0…1350) */
  c.translate(0, (OUT_H - H0) / 2);

  /* ---- SPECIMEN-PLATE GEOMETRY (mirrors the DOM/CSS exactly) ---- */
  const MAT = 56, HAIR = 74;                 /* mat inset, inner hairline inset */
  const PAD_X = 52, PAD_TOP = 40, PAD_BOT = 34;
  const contentL = HAIR + PAD_X;             /* 126 */
  const contentR = W0 - HAIR - PAD_X;        /* 954 */
  const contentW = contentR - contentL;      /* 828 */
  const cx = W0 / 2;
  /* hero window: plate top 74 + pad-top 40 + serial line-box ~15.6 + pad-bottom
     22 + border 1 → ~152.6, then stage margin-top 26 → STAGE_TOP≈179; height 760
     → bottom 939 = CAP_TOP (caption archetype margin-top 30 handled in drawText) */
  const STAGE_TOP = 179, STAGE_H = 690, CAP_TOP = STAGE_TOP + STAGE_H;   /* hero window; caption gets the freed room for the insight */

  /* mat plate fill + frame border (1.5px), inner brightened hairline (1px) */
  const matG = c.createLinearGradient(0, MAT, 0, H0 - MAT);
  matG.addColorStop(0, 'rgba(16,21,28,0.55)');
  matG.addColorStop(1, 'rgba(9,12,17,0.80)');
  c.fillStyle = matG;
  c.fillRect(MAT, MAT, W0 - 2 * MAT, H0 - 2 * MAT);
  c.strokeStyle = 'rgba(233,237,242,0.30)'; c.lineWidth = 1.5;
  c.strokeRect(MAT + 0.75, MAT + 0.75, W0 - 2 * MAT - 1.5, H0 - 2 * MAT - 1.5);
  c.strokeStyle = 'rgba(233,237,242,0.20)'; c.lineWidth = 1;
  c.strokeRect(HAIR + 0.5, HAIR + 0.5, W0 - 2 * HAIR - 1, H0 - 2 * HAIR - 1);

  /* four corner registration ticks (graft B): a plus at each frame corner */
  const drawTick = (tx, ty) => {
    c.fillStyle = 'rgba(233,237,242,0.34)';
    c.fillRect(tx - 11, ty - 0.75, 22, 1.5);
    c.fillRect(tx - 0.75, ty - 11, 1.5, 22);
  };
  drawTick(MAT, MAT); drawTick(W0 - MAT, MAT);
  drawTick(MAT, H0 - MAT); drawTick(W0 - MAT, H0 - MAT);

  const drawText = () => {
    c.textAlign = 'left'; c.textBaseline = 'alphabetic';
    /* plate-top: "sea time" wordmark (left, orange) + serial (right), divider under */
    const topBaseY = HAIR + PAD_TOP + 13;
    c.font = '500 17px ' + FIT_FONT; c.letterSpacing = '0px';
    c.fillStyle = '#F6935D';
    c.fillText('sea time', contentL, topBaseY);
    fitSetType(c, 13, 500, 0.34);
    c.fillStyle = TEXT_3;
    c.textAlign = 'right';
    c.fillText('THE FITTING', contentR, topBaseY);   /* the serial moves to the foot, opposite the address */
    c.textAlign = 'left';
    const topDivY = HAIR + PAD_TOP + 13 + 22;   /* baseline + padding-bottom */
    c.strokeStyle = 'rgba(233,237,242,0.08)'; c.lineWidth = 1;
    c.beginPath(); c.moveTo(contentL, topDivY); c.lineTo(contentR, topDivY); c.stroke();

    /* caption block begins under the hero window (hero bottom = STAGE_TOP+760).
       spacing chain mirrors the DOM flex flow (archetype margin-top 30, rule
       22/24, ledger rows 34 apart, why margin-top 28) */
    c.textAlign = 'center';
    let y = CAP_TOP + 60;                        /* archetype baseline (mt30 + ascent) */
    /* archetype — engraved 47/400, wide tracking */
    fitSetType(c, 47, 400, 0.28);
    c.fillStyle = INK; c.fillText(b.archetype, cx + 0.14 * 47, y);
    y += 52;                                     /* → first ledger row baseline (rule removed) */

    /* ---- ENGRAVED LEDGER (graft B): labels left, values flushed right ---- */
    const ledgerW = 470, lx = cx - ledgerW / 2, rx = cx + ledgerW / 2;
    const rows = [
      ['REFERENCE', b.name.toUpperCase(), 15, 0.14],
      ['PROVENANCE', b.ref.toUpperCase(), 13, 0.16],
    ];
    /* the engraving takes its place in the ledger, on the same rules */
    if (fitInscription) rows.push(['INSCRIPTION', fitInscription.toUpperCase(), 13, 0.16]);
    rows.forEach((r, i) => {
      const rowY = y + i * 34;
      c.textAlign = 'left';
      fitSetType(c, 11, 500, 0.32);
      c.fillStyle = TEXT_3; c.fillText(r[0], lx, rowY);
      c.textAlign = 'right';
      fitSetType(c, r[2], 500, r[3]);
      c.fillStyle = INK; c.fillText(r[1], rx, rowY);
      if (i < rows.length - 1) {
        c.strokeStyle = 'rgba(233,237,242,0.08)'; c.lineWidth = 1;
        c.beginPath(); c.moveTo(lx, rowY + 11); c.lineTo(rx, rowY + 11); c.stroke();
      }
    });
    c.textAlign = 'left';
    y += (rows.length - 1) * 34 + 40;            /* → insight label baseline (mt18) */

    /* the foot's position is fixed, so it sets the prose's budget — computed
       BEFORE the prose is drawn. The plate is a fixed 1350 tall: a third ledger
       row plus the longest insight in the corpus (the Fifty Fathoms, ~5 lines)
       leaves ~21px of air, and anything longer would run through the rule. The
       prose yields, never the frame. */
    const footBaseY = H0 - HAIR - PAD_BOT;          /* 1350 − 74 − 34 = 1242 */
    const footDivY = footBaseY - 22;
    const proseTop = y + 9 + 14;
    const maxLines = Math.max(2, Math.floor((footDivY - 16 - proseTop) / (14 * 1.55)) + 1);

    /* WHY THIS WATCH, RIGHT NOW — orange left-aligned label + prose (ledger format) */
    fitDrawWhy(c, lx, y, ledgerW, b.insight, maxLines);

    /* ---- PLATE FOOT — the return path, bracketed by the serial.
       Set in the same engraved caps as the ledger labels so it reads as part
       of the plate's own typography, not as a watermark stuck on top of it.
       This is the only thing on the poster that tells a stranger where the
       fitting came from — without it the plate is a beautiful dead end. */
    c.strokeStyle = 'rgba(233,237,242,0.08)'; c.lineWidth = 1;
    c.beginPath(); c.moveTo(contentL, footDivY); c.lineTo(contentR, footDivY); c.stroke();
    fitSetType(c, 11, 500, 0.32);
    c.textAlign = 'left';
    c.fillStyle = TEXT_3;
    c.fillText(SITE_HOST.toUpperCase(), contentL, footBaseY);
    /* the plate number is this reference's place in the atlas, not a counter —
       true without a backend, and it reads like a print edition: NO.087 / 143 */
    c.textAlign = 'right';
    const rank = (S.watches ? S.watches.findIndex(w => w.id === b.id) : -1) + 1;
    c.fillText((rank ? 'NO.' + String(rank).padStart(3, '0') : 'NO.—') + ' / ' + count, contentR, footBaseY);
    c.textAlign = 'left';

    finish();
  };

  const finish = () => { oc.toBlob(blob => resolve(blob), 'image/png'); };

  /* HERO WINDOW — rectangular portrait; watch large, strap bleeds off top &
     bottom via object-fit:cover. Mirrors #fr-stage (176px top, 760px tall). */
  const drawStage = (img) => {
    const HX = contentL, HW = contentW;        /* hero spans the content width */
    const HY = STAGE_TOP, HH = STAGE_H;

    c.save();
    /* clip to the rectangular window (rounded 0 — a plate edge) */
    c.beginPath(); c.rect(HX, HY, HW, HH); c.clip();
    /* window ground */
    c.fillStyle = '#04050A'; c.fillRect(HX, HY, HW, HH);

    if (img && img.complete && img.naturalWidth) {
      /* object-fit: cover — scale to fill, center, crop overflow */
      const iw = img.naturalWidth, ih = img.naturalHeight;
      const s = Math.max(HW / iw, HH / ih);
      const dw = iw * s, dh = ih * s;
      const dx = HX + (HW - dw) / 2, dy = HY + (HH - dh) / 2;
      c.drawImage(img, dx, dy, dw, dh);
    }

    /* lume bloom, top-centre (must-fix #3) */
    const bloomCx = HX + HW / 2, bloomCy = HY + HH * 0.44;
    const bloomR = Math.max(HW, HH) * 0.40;
    const bloom = c.createRadialGradient(bloomCx, bloomCy, 0, bloomCx, bloomCy, bloomR);
    bloom.addColorStop(0, 'rgba(228,213,168,0.16)');
    bloom.addColorStop(1, 'rgba(228,213,168,0)');
    c.fillStyle = bloom; c.fillRect(HX, HY, HW, HH);

    /* rim-lit emergence vignette (graft C): darken window corners ~12% */
    const vg = c.createRadialGradient(bloomCx, HY + HH / 2, HH * 0.30, bloomCx, HY + HH / 2, HH * 0.72);
    vg.addColorStop(0, 'rgba(4,5,10,0)');
    vg.addColorStop(1, 'rgba(4,5,10,0.42)');
    c.fillStyle = vg; c.fillRect(HX, HY, HW, HH);
    c.restore();

    /* window frame hairline */
    c.strokeStyle = 'rgba(233,237,242,0.16)'; c.lineWidth = 1;
    c.strokeRect(HX + 0.5, HY + 0.5, HW - 1, HH - 1);

    drawText();
  };

  const img = new Image();
  img.onload = () => drawStage(img);
  img.onerror = () => drawStage(null);
  img.src = 'data/img-catalog/' + b.id + '.jpg';
  /* if cached and already complete, onload may not fire */
  if (img.complete && img.naturalWidth) drawStage(img);
  });
}

/* ---- THE ENGRAVING ------------------------------------------------------
   A caseback inscription: the one thing on the plate that is the owner's and
   not the watch's. It lands as a THIRD LEDGER ROW rather than a rendered
   caseback disc — the plate already has a language for "a fact about this
   watch", and inventing a second one to say something smaller would be
   decoration. Clarity over complexity, and it survives being 200px wide.

   It rides in the PNG and never in the deep link: user text in a URL means a
   stranger can craft a link that renders arbitrary words on our page and pass
   it off as ours. The image is flat and self-contained; the link stays clean. */
let fitInscription = '';

function fitSetInscription(raw) {
  /* one line, collapsed, trimmed to the caseback's worth of room */
  const v = String(raw || '').replace(/\s+/g, ' ').trim().slice(0, 32);
  if (v === fitInscription) return;
  fitInscription = v;
  fitPaintInscription();
  /* the cached PNG is now stale — rebuild it, or Share would hand over a plate
     that does not match the one on screen */
  if (fitResult && fitResult.best) {
    fitPoster = { id: null, blob: null };
    fitPrimePoster(fitResult.best.id);
  }
}

function fitPaintInscription() {
  const row = $('fr-lrow-inscription'), val = $('fr-inscription'), led = $('fr-ledger');
  if (!row || !val) return;
  const on = !!fitInscription;
  row.hidden = !on;
  val.textContent = fitInscription;
  if (led) led.classList.toggle('has-inscription', on);
}

/* ---- THE PLATE IS THE SHARE ---------------------------------------------
   The reveal primes a PNG the moment it lands, so the share tap is instant AND
   — the part that actually matters — navigator.share() fires inside the user
   gesture. Awaiting toBlob() first spends the transient activation and iOS
   Safari silently refuses the call. */
let fitPoster = { id: null, blob: null };

function fitPrimePoster(id) {
  if (fitPoster.id === id) return;
  fitPoster = { id, blob: null };
  buildPoster().then(blob => { if (fitPoster.id === id) fitPoster.blob = blob; });
}

/* can this browser hand over an actual image file? (probe once) */
let _canShareFiles = null;
function canShareFiles() {
  if (_canShareFiles !== null) return _canShareFiles;
  try {
    const probe = new File([new Blob([''], { type: 'image/png' })], 'p.png', { type: 'image/png' });
    _canShareFiles = !!(navigator.canShare && navigator.share && navigator.canShare({ files: [probe] }));
  } catch (e) { _canShareFiles = false; }
  return _canShareFiles;
}

function fitSavePoster() {
  if (!fitResult || !fitResult.best) return;
  const id = fitResult.best.id;
  const use = (blob) => { if (blob) downloadPoster(blob, id); };
  if (fitPoster.id === id && fitPoster.blob) use(fitPoster.blob);
  else buildPoster().then(use);
}

function downloadPoster(blob, id) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'the-fitting-' + id + '.png';
  a.click();
  elLive.textContent = 'Poster saved.';
  flashBtn(fitEl.save, 'Saved');
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

/* poster type helper — system stack, tabular, tracked (px em) */
function fitSetType(c, sizePx, weight, trackingEm) {
  c.font = weight + ' ' + sizePx + 'px ' + FIT_FONT;
  c.letterSpacing = (trackingEm * sizePx).toFixed(2) + 'px';
}
const FIT_FONT = "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', system-ui, 'Helvetica Neue', sans-serif";
const INK = '#E9EDF2';

/* ---- THE RETURN PATH ----------------------------------------------------
   A plate that travels needs a way home. The address is derived from wherever
   the site is served, so dev prints dev and production prints production and
   nobody has to remember to change a constant before a deploy. */
const SITE_HOST = (() => {
  try { return (location.host || '').replace(/^www\./, '') || 'sea time'; }
  catch (e) { return 'sea time'; }
})();

/* the link a shared plate carries: the recipient lands on the SENDER'S plate
   with one thing to do — take their own. Not the index; the index is the
   answer, and handing over the answer kills the reason to play. */
function fitShareURL(id) {
  try { return location.origin + location.pathname + '#fit&r=' + id; }
  catch (e) { return 'https://' + SITE_HOST + '/#fit&r=' + id; }
}

/* draw the "why this watch, right now" insight, LEFT-ALIGNED (ledger format):
   orange label (#F6935D) + wrapped prose. lx = left edge of the ledger column. */
function fitDrawWhy(c, lx, y, maxW, insight, maxLines) {
  c.save();
  c.textAlign = 'left';
  /* label — sea-time orange, letter-spaced caps (mirrors #fr-why-label) */
  fitSetType(c, 11, 500, 0.32);
  c.fillStyle = '#F6935D';
  c.fillText('WHY THIS WATCH, RIGHT NOW', lx, y);
  /* prose — INK, 14px, wrapped (mirrors #fr-why-text, mb9) */
  const proseY = y + 9 + 14;
  c.font = '400 14px ' + FIT_FONT;
  c.letterSpacing = (0.01 * 14).toFixed(2) + 'px';
  const words = (insight || '').split(' ');
  const lines = []; let line = '';
  for (const wd of words) {
    const test = line ? line + ' ' + wd : wd;
    if (c.measureText(test).width > maxW && line) { lines.push(line); line = wd; }
    else line = test;
  }
  if (line) lines.push(line);
  /* the frame wins — trim to the budget and mark the cut honestly */
  if (maxLines && lines.length > maxLines) {
    lines.length = maxLines;
    lines[maxLines - 1] = lines[maxLines - 1].replace(/[,;:.\s]+$/, '') + '…';
  }
  const lh = 14 * 1.55;
  c.fillStyle = INK;
  lines.forEach((ln, i) => c.fillText(ln, lx, proseY + i * lh));
  c.restore();
  return proseY + (lines.length - 1) * lh + 6;   /* baseline of last prose line */
}

/* ---- keyboard: arrows/enter/esc, mirrors the lightbox's key ownership ---- */
function onFitKey(e) {
  if (!fitOpen) return;
  if (e.key === 'Escape') {
    e.preventDefault(); e.stopPropagation();
    /* Escape unwinds one layer at a time — preview, then sheet, then the fitting */
    if (fitAltPinned) { fitAltUnpin(); return; }
    if (fitSheetOpen) { fitSheetToggle(false); return; }
    closeFitting();
    return;
  }
  /* reveal screen: let Tab/Enter work natively on the action row */
  if (!fitEl.reveal.hidden) return;
  const s = FIT_SCREENS[fitStep];
  if (s.type === 'binary') {
    const cards = [...fitEl.cards.querySelectorAll('.fq-card')];
    const idx = cards.indexOf(document.activeElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
      e.preventDefault(); (cards[(idx + 1 + cards.length) % cards.length] || cards[0]).focus();
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      e.preventDefault(); (cards[(idx - 1 + cards.length) % cards.length] || cards[0]).focus();
    } else if (e.key === 'Enter' || e.key === ' ') {
      if (document.activeElement && document.activeElement.classList.contains('fq-card')) {
        e.preventDefault(); document.activeElement.click();
      }
    } else if (e.key === 'Backspace') { e.preventDefault(); fitBack(); }
  } else {
    if (e.key === 'Enter') { e.preventDefault(); fitAdvance(); }
    else if (e.key === 'Backspace') { e.preventDefault(); fitBack(); }
  }
}

/* the wordmark is the way back to 0 M — a <button>, so Enter and Space come free */
(function wireWordmark() {
  const wm = $('wordmark');
  if (wm) wm.addEventListener('click', ascendToSurface);
})();

/* wire the entry chip once DOM is present */
(function wireFitEntry() {
  const chip = chipEntry();
  if (chip) chip.addEventListener('click', () => openFitting());
})();

window.addEventListener('resize', resize);
window.addEventListener('resize', () => { if (fitOpen && !fitEl.reveal.hidden) fitScalePoster(); });

resize();
invalidate();      /* field renders immediately */
loadData();

/* ======================================================================
   THE SURFACE HERO — dive into the descent on first scroll / tap.
   A DOM layer over the (already-booting) atlas; dismissing it reveals
   the descent underneath. Skipped for returning visitors + deep links.
   ====================================================================== */
let heroEl = null, heroVisible = false, heroPullUp = 0;

function heroDive() {
  if (!heroEl || !heroVisible) return;
  heroVisible = false;
  heroEl.classList.add('diving');
  setTimeout(() => { if (!heroVisible) heroEl.classList.add('gone'); try { invalidate(); } catch (e) {} },
            REDUCED ? 300 : 900);
}
function heroShow() {
  if (!heroEl || heroVisible) return;
  heroVisible = true; heroPullUp = 0;
  heroEl.classList.remove('gone');
  void heroEl.offsetWidth;                 /* reflow so the surfacing transition plays */
  heroEl.classList.remove('diving');
  heroLumePlace(); heroFxStart();
}

/* --- the underwater light: sun shafts + caustic dapple + rising bubbles (canvas 2D) --- */
let heroFx = null, heroFxRaf = 0;
function heroFxSetup() {
  const cv = document.getElementById('hero-fx');
  if (!cv) return;
  const r = () => Math.random();
  heroFx = {
    cv, ctx: cv.getContext('2d'), DPR: Math.min(dpr, 2), W: 0, H: 0,
    shafts: Array.from({ length: 6 }, (_, i) => ({ x0: 0.30 + i * 0.13, w: 0.11 + r() * 0.07, ang: -0.14 + r() * 0.28, ph: r() * 6.28, a: 0.055 + r() * 0.05 })),
    dapple: Array.from({ length: 8 }, () => ({ x: 0.30 + r() * 0.7, y: r() * 0.55, r: 0.05 + r() * 0.08, ph: r() * 6.28, sp: 0.2 + r() * 0.3, a: 0.03 + r() * 0.028 })),
    bubbles: Array.from({ length: 18 }, () => ({ x: 0.30 + r() * 0.7, y: r(), r: 1 + r() * 3.2, sp: 0.02 + r() * 0.05, ph: r() * 6.28, a: 0.07 + r() * 0.2 })),
  };
  heroFxResize();
}
function heroFxResize() {
  if (!heroFx) return;
  const cv = heroFx.cv;
  heroFx.W = cv.clientWidth; heroFx.H = cv.clientHeight;
  cv.width = Math.round(heroFx.W * heroFx.DPR);
  cv.height = Math.round(heroFx.H * heroFx.DPR);
  heroLumePlace();
}
function heroLumePlace() {
  const media = document.getElementById('hero-media'), lume = document.getElementById('hero-lume');
  if (!media || !lume) return;
  const b = media.getBoundingClientRect();
  if (!b.width) return;
  /* the dial sits slightly left-of-centre and above the vertical midline in the
     contained watch; size the glow to the black dial face */
  const cx = b.width * 0.455, cy = b.height * 0.465, R = b.height * 0.15;
  lume.style.left = (cx - R) + 'px'; lume.style.top = (cy - R) + 'px';
  lume.style.width = (2 * R) + 'px'; lume.style.height = (2 * R) + 'px';
}
function heroFxFrame(ms) {
  heroFxRaf = 0;
  if (!heroFx || !heroEl || heroEl.classList.contains('gone')) return;
  const st = heroFx, x = st.ctx, DPR = st.DPR, W = st.W, H = st.H, t = ms / 1000;
  const lf = px => Math.min(1, Math.max(0, (px / W - 0.14) / 0.24));
  x.setTransform(DPR, 0, 0, DPR, 0, 0);
  x.clearRect(0, 0, W, H);
  x.globalCompositeOperation = 'lighter';
  for (const s of st.shafts) {
    const cx = (s.x0 + Math.sin(t * 0.22 + s.ph) * 0.03) * W, ang = s.ang + Math.sin(t * 0.16 + s.ph) * 0.05, f = lf(cx);
    if (f <= 0) continue;
    x.save(); x.translate(cx, -40); x.rotate(ang);
    const w = s.w * W, gg = x.createLinearGradient(0, 0, 0, H * 1.25), pulse = s.a * f * (0.7 + 0.3 * Math.sin(t * 0.5 + s.ph));
    gg.addColorStop(0, `rgba(150,205,235,${pulse})`); gg.addColorStop(0.5, `rgba(120,185,220,${pulse * 0.32})`); gg.addColorStop(1, 'rgba(120,185,220,0)');
    x.fillStyle = gg; x.filter = 'blur(16px)';
    x.beginPath(); x.moveTo(-w * 0.3, 0); x.lineTo(w * 0.3, 0); x.lineTo(w * 0.9, H * 1.25); x.lineTo(-w * 0.9, H * 1.25); x.closePath(); x.fill();
    x.restore();
  }
  x.filter = 'none';
  for (const d of st.dapple) {
    const px = (d.x + Math.sin(t * d.sp + d.ph) * 0.03) * W, py = (d.y + Math.cos(t * d.sp * 0.8 + d.ph) * 0.03) * H, f = lf(px);
    if (f <= 0) continue;
    const r = (d.r * (0.85 + 0.25 * Math.sin(t * 0.6 + d.ph))) * W, a = d.a * f * (0.55 + 0.45 * Math.sin(t * 0.7 + d.ph));
    const rg = x.createRadialGradient(px, py, 0, px, py, r);
    rg.addColorStop(0, `rgba(175,218,242,${Math.max(0, a)})`); rg.addColorStop(1, 'rgba(175,218,242,0)');
    x.fillStyle = rg; x.beginPath(); x.arc(px, py, r, 0, 6.2832); x.fill();
  }
  for (const b of st.bubbles) {
    b.y -= b.sp * 0.012; if (b.y < -0.02) { b.y = 1.03; b.x = 0.30 + Math.random() * 0.7; }
    const px = (b.x + Math.sin(t * 0.6 + b.ph) * 0.006) * W, py = b.y * H, f = lf(px);
    if (f <= 0) continue;
    const rg = x.createRadialGradient(px - b.r * 0.3, py - b.r * 0.3, 0, px, py, b.r * 2.2);
    rg.addColorStop(0, `rgba(220,240,255,${b.a * f})`); rg.addColorStop(0.6, `rgba(180,215,240,${b.a * f * 0.3})`); rg.addColorStop(1, 'rgba(180,215,240,0)');
    x.fillStyle = rg; x.beginPath(); x.arc(px, py, b.r * 2.2, 0, 6.2832); x.fill();
  }
  x.globalCompositeOperation = 'source-over';
  if (!REDUCED) heroFxRaf = requestAnimationFrame(heroFxFrame);
}
function heroFxStart() {
  if (!heroFx) return;
  if (REDUCED) { heroFxFrame(0); return; }          /* one static frame, no loop */
  if (!heroFxRaf) heroFxRaf = requestAnimationFrame(heroFxFrame);
}
/* resurface the hero when the diver pulls up past the top of the spiral
   (dsIntent < 0 = moving toward the surface). Called from the descent scroll paths. */
function heroPullCheck(dsIntent) {
  if (!heroEl || heroVisible || !heroEl.classList.contains('gone')) return false;
  if (DS.s <= 0.02 && dsIntent < 0) {
    heroPullUp += -dsIntent;
    if (heroPullUp > 0.7) { heroShow(); return true; }   /* ~a deliberate upward pull */
  } else { heroPullUp = 0; }
  return false;
}

(function heroInit() {
  heroEl = document.getElementById('hero');
  if (!heroEl || document.documentElement.classList.contains('no-hero')) { heroEl = null; return; }
  heroVisible = true;
  window.addEventListener('wheel', e => {
    if (!heroVisible) return; e.preventDefault(); if (e.deltaY > 4) heroDive();
  }, { passive: false });
  window.addEventListener('keydown', e => {
    if (!heroVisible) return;
    if (e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === ' ' ||
        e.key === 'Enter' || e.key === 'Spacebar') { e.preventDefault(); heroDive(); }
  });
  let ty0 = null;
  heroEl.addEventListener('touchstart', e => { if (heroVisible) ty0 = e.touches[0].clientY; }, { passive: true });
  heroEl.addEventListener('touchmove', e => {
    if (!heroVisible) return; e.preventDefault();
    if (ty0 != null && ty0 - e.touches[0].clientY > 24) heroDive();
  }, { passive: false });
  const btn = document.getElementById('hero-descend');
  if (btn) btn.addEventListener('click', heroDive);
  heroFxSetup();
  heroFxStart();
  window.addEventListener('resize', heroFxResize);
})();

/* ======================================================================
   THE COLOPHON — the site footer, in an overlay because this document does
   not scroll (html/body are overflow:hidden; the atlas owns the viewport).

   The mono clock is ported from simonleyton.com with its geometry intact —
   the same G table, the same knockout of the seconds disc where it crosses a
   hand — and re-inked for a dark ground. GROUND must equal the panel's own
   background or the knockout punches the wrong colour.
   ====================================================================== */
(function colophon() {
  const root = $('colophon'), openBtn = $('colophon-open'), closeBtn = $('cph-close');
  if (!root || !openBtn) return;

  const cv = root.querySelector('.mono-clock');
  const INK = '#5C6672', GROUND = '#06080B', STROKE = 1, CSS = 64;
  const G = { DIAL: 1, CAP: 0.32, HOUR_LEN: 0.70, MIN_LEN: 0.96, BATON_W: 0.13,
              SEC_R: 0.295, SEC_ORBIT: 0.64 };
  const reduce = window.matchMedia('(prefers-reduced-motion:reduce)').matches;
  let ctx = null, raf = null, iv = null, prevFocus = null;

  if (cv) {
    const DPR = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    cv.width = Math.round(CSS * DPR); cv.height = Math.round(CSS * DPR);
    cv.style.width = CSS + 'px'; cv.style.height = CSS + 'px';
    ctx = cv.getContext('2d');
    ctx._dpr = DPR;
  }

  const ang = t => -Math.PI / 2 + t * Math.PI * 2;
  /* Miami time, read from the zone rather than the visitor's clock */
  function miami() {
    const n = new Date();
    const o = {};
    new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour12: false,
      hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(n).forEach(p => { o[p.type] = p.value; });
    return { h: (+o.hour) % 24, m: +o.minute,
             s: (+o.second) + (reduce ? 0 : n.getMilliseconds() / 1000) };
  }

  const elH = root.querySelector('.t-h'), elM = root.querySelector('.t-m'),
        elAP = root.querySelector('.t-ap'), elTemp = root.querySelector('.chip-temp');
  function updateChip(t) {
    let h = t.h % 12; if (h === 0) h = 12;
    const mm = ('0' + t.m).slice(-2), ap = t.h < 12 ? 'AM' : 'PM';
    if (elH && elH.textContent !== String(h)) elH.textContent = h;
    if (elM && elM.textContent !== mm) elM.textContent = mm;
    if (elAP && elAP.textContent !== ap) elAP.textContent = ap;
  }

  function baton(a, L, W) {
    const hw = W / 2, back = W * 0.6;
    ctx.save(); ctx.rotate(a); ctx.beginPath(); ctx.rect(-back, -hw, L + back, W); ctx.restore();
  }
  function batonInto(a, L, W) {
    const hw = W / 2, back = W * 0.6;
    ctx.save(); ctx.rotate(a); ctx.rect(-back, -hw, L + back, W); ctx.restore();
  }

  function render() {
    if (!ctx) return;
    const t = miami(), W = CSS, H = CSS, DPR = ctx._dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height);
    const R = Math.min(W, H) * 0.48;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0); ctx.translate(W / 2, H / 2);
    ctx.lineWidth = STROKE; ctx.strokeStyle = INK; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const aH = ang(((t.h % 12) + t.m / 60 + t.s / 3600) / 12),
          aM = ang((t.m + t.s / 60) / 60),
          aS = ang((t.s % 60) / 60), bw = G.BATON_W * R;
    ctx.beginPath(); ctx.arc(0, 0, G.DIAL * R + STROKE / 2, 0, Math.PI * 2); ctx.stroke();
    ctx.save(); ctx.beginPath(); ctx.arc(0, 0, G.DIAL * R, 0, Math.PI * 2); ctx.clip();
    ctx.lineCap = 'butt'; ctx.beginPath();
    ctx.moveTo(0, -R); ctx.lineTo(0, R); ctx.moveTo(-R, 0); ctx.lineTo(R, 0);
    ctx.stroke(); ctx.restore(); ctx.lineCap = 'round';
    baton(aH, G.HOUR_LEN * R, bw); ctx.fillStyle = INK; ctx.fill();
    baton(aM, G.MIN_LEN * R, bw); ctx.fillStyle = INK; ctx.fill();
    ctx.beginPath(); ctx.arc(0, 0, G.CAP * R, 0, Math.PI * 2); ctx.fillStyle = GROUND; ctx.fill();
    ctx.beginPath(); ctx.arc(0, 0, G.CAP * R - STROKE / 2, 0, Math.PI * 2);
    ctx.lineWidth = STROKE; ctx.strokeStyle = INK; ctx.stroke();
    const sx = Math.cos(aS) * G.SEC_ORBIT * R, sy = Math.sin(aS) * G.SEC_ORBIT * R, br = G.SEC_R * R;
    ctx.beginPath(); ctx.arc(sx, sy, br, 0, Math.PI * 2); ctx.fillStyle = INK; ctx.fill();
    /* where the seconds disc crosses a hand it knocks back to the ground and
       draws its own outline — the detail that makes the lockup read as drawn */
    ctx.save(); ctx.beginPath();
    batonInto(aH, G.HOUR_LEN * R, bw); batonInto(aM, G.MIN_LEN * R, bw); ctx.clip();
    ctx.beginPath(); ctx.arc(sx, sy, br, 0, Math.PI * 2);
    ctx.fillStyle = GROUND; ctx.fill();
    ctx.lineWidth = STROKE; ctx.strokeStyle = INK; ctx.stroke();
    ctx.restore();
    updateChip(t);
  }

  function loop() { render(); if (!root.hidden && !reduce) raf = requestAnimationFrame(loop); }
  function startClock() {
    if (reduce) { render(); if (!iv) iv = setInterval(render, 1000); }
    else if (!raf) loop();
  }
  function stopClock() {
    if (raf) { cancelAnimationFrame(raf); raf = null; }
    if (iv) { clearInterval(iv); iv = null; }
  }

  let wxTimer = null;
  function weather() {
    fetch('https://api.open-meteo.com/v1/forecast?latitude=25.7617&longitude=-80.1918&current=temperature_2m&temperature_unit=fahrenheit')
      .then(r => r.json())
      .then(d => { if (elTemp && d && d.current && d.current.temperature_2m != null)
        elTemp.textContent = Math.round(d.current.temperature_2m) + '°F'; })
      .catch(() => {});
  }

  function open() {
    prevFocus = document.activeElement;
    root.hidden = false;
    openBtn.setAttribute('aria-expanded', 'true');
    requestAnimationFrame(() => requestAnimationFrame(() => root.classList.add('on')));
    startClock();
    weather();
    if (!wxTimer) wxTimer = setInterval(weather, 600000);
    requestAnimationFrame(() => { try { closeBtn.focus(); } catch (e) {} });
  }
  function close() {
    root.classList.remove('on');
    openBtn.setAttribute('aria-expanded', 'false');
    stopClock();
    if (wxTimer) { clearInterval(wxTimer); wxTimer = null; }
    const done = () => { root.hidden = true; };
    if (reduce) done(); else setTimeout(done, 260);
    if (prevFocus && prevFocus.focus) { try { prevFocus.focus(); } catch (e) {} }
  }

  openBtn.addEventListener('click', open);
  if (closeBtn) closeBtn.addEventListener('click', close);
  root.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
  });
  /* The in-site nav drives the app DIRECTLY. There is no hashchange listener
     here, so an href="#m=descent" would rewrite the URL and change nothing —
     a link that looks live and is inert. Each one closes the colophon and
     presses the control the user would otherwise have pressed. */
  const NAV = {
    descent: () => { if (S.mode !== 'descent') elMtDescent.click(); },
    sky:     () => { if (S.mode !== 'sky') elMtSky.click(); },
    fit:     () => openFitting(),
  };
  root.querySelectorAll('[data-cph-nav]').forEach(a => {
    a.addEventListener('click', e => {
      const fn = NAV[a.dataset.cphNav];
      if (!fn) return;                  /* mailto and external links pass through */
      e.preventDefault();
      close();
      /* let the overlay's fade finish before the projection morphs underneath */
      setTimeout(fn, reduce ? 0 : 280);
    });
  });
})();
