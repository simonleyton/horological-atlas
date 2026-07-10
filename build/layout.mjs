#!/usr/bin/env node
// The Horological Atlas — layout engine.
// Reads data/watches.json, computes 2D positions (standardize -> weighted PCA
// via power iteration -> family-centroid blend -> deterministic jitter ->
// collision relaxation), writes data/atlas.json. Zero dependencies. Node >= 18.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WATCHES_PATH = join(ROOT, 'data', 'watches.json');
const ATLAS_PATH = join(ROOT, 'data', 'atlas.json');

const WORLD_HALF = 950;          // scale into ~[-1000,1000] with headroom for relaxation
const MIN_SPACING = 40;          // world units; glyphs never overlap at fit zoom
const RELAX_ITERS = 250;
const PCA_WEIGHT = 0.62;
const FAMILY_PULL = 0.38;

const FAMILY_LABELS = {
  'pioneers': 'The Pioneers',
  'submariner-lineage': 'Submariner Lineage',
  'fifty-fathoms-lineage': 'Fifty Fathoms Lineage',
  'seamaster-lineage': 'Seamaster Lineage',
  'tudor-lineage': 'Tudor Lineage',
  'japanese-toolwatch': 'Japanese Tool Watches',
  'doxa-professional': 'Doxa Professionals',
  'super-compressor': 'Super Compressors',
  'italian-military': 'Italian Military',
  'german-engineering': 'German Engineering',
  'vintage-skindiver': 'Skin Divers',
  'modern-heritage': 'Modern Heritage',
  'microbrand-modern': 'Microbrand Modern',
  'avant-garde': 'Avant-Garde',
};

// ---------------------------------------------------------------- data ----

function loadWatches() {
  if (existsSync(WATCHES_PATH)) {
    const watches = JSON.parse(readFileSync(WATCHES_PATH, 'utf8'));
    console.log(`Loaded ${watches.length} watches from data/watches.json`);
    return watches;
  }
  console.log('NOTE: data/watches.json not found — using in-memory 14-watch dev fixture (not written to disk).');
  return devFixture();
}

function devFixture() {
  const W = (id, brand, model, reference, year, country, diameterMm, waterResistanceM,
    bezelType, bezelColor, dialColor, accentColor, caseShape, movement, designFamily,
    parents, significance, priceBandUsd, features) => ({
    id, brand, model, reference, year, country, diameterMm, waterResistanceM,
    bezelType, bezelColor, dialColor, accentColor, caseShape, movement, designFamily,
    parents, significance, priceBandUsd, features,
  });
  const F = (crownGuard, dateWindow, heliumValve, handsStyle, lumePlots) =>
    ({ crownGuard, dateWindow, heliumValve, handsStyle, lumePlots });
  return [
    W('omega-marine-1932', 'Omega', 'Marine', 'CK705', 1932, 'CH', 30, 135,
      'none', '#1a1a1a', '#c8c4b2', '#1a1a1a', 'tonneau', 'manual', 'pioneers',
      [], 'The first commercially available dive watch, with a sliding double case.',
      [8000, 25000], F(false, false, false, 'baton', 'none')),
    W('panerai-radiomir-3646', 'Panerai', 'Radiomir', '3646', 1936, 'IT', 47, 100,
      'fixed', '#111111', '#0d0d0d', '#d9c48a', 'cushion', 'manual', 'pioneers',
      ['omega-marine-1932'], 'Oversized luminous military diver built for Italian frogmen.',
      [60000, 150000], F(false, false, false, 'cathedral', 'sandwich')),
    W('rolex-submariner-6204', 'Rolex', 'Submariner', '6204', 1953, 'CH', 37, 100,
      'rotating', '#0b0b0b', '#0b0b0b', '#e8e4d8', 'round', 'automatic', 'submariner-lineage',
      ['omega-marine-1932'], 'The archetype: rotating timing bezel plus Oyster case set the dive-watch template.',
      [40000, 120000], F(false, false, false, 'pencil', 'round')),
    W('rolex-submariner-1680', 'Rolex', 'Submariner Date', '1680', 1969, 'CH', 40, 200,
      'rotating', '#0b0b0b', '#0b0b0b', '#d02b2b', 'round', 'automatic', 'submariner-lineage',
      ['rolex-submariner-6204'], 'First Submariner with a date; the "Red Sub" cemented the luxury tool watch.',
      [15000, 45000], F(true, true, false, 'mercedes', 'round')),
    W('rolex-submariner-126610', 'Rolex', 'Submariner Date', '126610LN', 2020, 'CH', 41, 300,
      'rotating', '#0d0d0d', '#0d0d0d', '#3aa0ff', 'round', 'automatic', 'submariner-lineage',
      ['rolex-submariner-1680'], 'The modern ceramic-bezel benchmark against which all divers are judged.',
      [9000, 15000], F(true, true, false, 'mercedes', 'round')),
    W('blancpain-fifty-fathoms-1953', 'Blancpain', 'Fifty Fathoms', 'FF-1953', 1953, 'CH', 41, 91,
      'rotating', '#101820', '#101820', '#e6e1cf', 'round', 'automatic', 'fifty-fathoms-lineage',
      ['omega-marine-1932'], 'Built to Bob Maloubier’s combat-diver spec; arguably the first modern diver.',
      [50000, 200000], F(false, false, false, 'sword', 'mixed')),
    W('blancpain-bathyscaphe-2013', 'Blancpain', 'Fifty Fathoms Bathyscaphe', '5000-1110', 2013, 'CH', 43, 300,
      'rotating', '#1c2430', '#22303f', '#c9cdd2', 'round', 'automatic', 'fifty-fathoms-lineage',
      ['blancpain-fifty-fathoms-1953'], 'Slimmer heritage reissue that brought the Fifty Fathoms back to daily wear.',
      [9000, 14000], F(false, true, false, 'baton', 'round')),
    W('seiko-62mas-1965', 'Seiko', '62MAS', '6217-8000', 1965, 'JP', 37, 150,
      'rotating', '#0e0e0e', '#141414', '#cfd4d9', 'round', 'automatic', 'japanese-toolwatch',
      ['rolex-submariner-6204'], 'Japan’s first professional diver; the root of every Seiko diver since.',
      [8000, 20000], F(false, true, false, 'baton', 'round')),
    W('seiko-6105-8110', 'Seiko', '6105 "Captain Willard"', '6105-8110', 1970, 'JP', 44, 150,
      'rotating', '#0e0e0e', '#101010', '#d8dde2', 'asymmetric', 'automatic', 'japanese-toolwatch',
      ['seiko-62mas-1965'], 'Cushion-cased Vietnam-era icon worn in Apocalypse Now.',
      [3000, 8000], F(true, true, false, 'baton', 'round')),
    W('seiko-skx007', 'Seiko', 'SKX007', 'SKX007K', 1996, 'JP', 42, 200,
      'rotating', '#101010', '#101010', '#e23b3b', 'cushion', 'automatic', 'japanese-toolwatch',
      ['seiko-6105-8110'], 'The default first mechanical diver for a generation of collectors.',
      [300, 700], F(false, true, false, 'baton', 'round')),
    W('citizen-promaster-1989', 'Citizen', 'Promaster Aqualand', 'C022', 1989, 'JP', 46, 200,
      'rotating', '#14181c', '#14181c', '#f2a900', 'asymmetric', 'quartz', 'japanese-toolwatch',
      ['seiko-62mas-1965'], 'First diver with an electronic depth gauge; pure instrument design.',
      [400, 1200], F(false, true, false, 'syringe', 'mixed')),
    W('doxa-sub300-1967', 'Doxa', 'SUB 300 Professional', '11899-4', 1967, 'CH', 42, 300,
      'rotating', '#3c3c3c', '#f26522', '#111111', 'cushion', 'automatic', 'doxa-professional',
      ['rolex-submariner-6204'], 'Orange dial and no-deco bezel designed with input from Jacques Cousteau’s divers.',
      [4000, 12000], F(false, true, false, 'baton', 'rectangular')),
    W('doxa-sub300t-1968', 'Doxa', 'SUB 300T Conquistador', '11899-6', 1968, 'CH', 42, 300,
      'rotating', '#3c3c3c', '#f26522', '#111111', 'cushion', 'automatic', 'doxa-professional',
      ['doxa-sub300-1967'], 'First commercially available watch with a helium release valve.',
      [3000, 9000], F(false, true, true, 'baton', 'rectangular')),
    W('doxa-sub300-carbon-2020', 'Doxa', 'SUB 300 Carbon', '822.70.351', 2020, 'CH', 42, 300,
      'rotating', '#1b1b1b', '#f26522', '#0d0d0d', 'cushion', 'automatic', 'doxa-professional',
      ['doxa-sub300-1967'], 'Forged-carbon reissue proving the 1967 design still reads as modern.',
      [3500, 5500], F(false, true, false, 'baton', 'rectangular')),
  ];
}

// ------------------------------------------------------------- features ----

function hexToHsl(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  const v = m ? parseInt(m[1], 16) : 0x808080;
  const r = ((v >> 16) & 255) / 255, g = ((v >> 8) & 255) / 255, b = (v & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  let h = 0;
  if (max !== min) {
    const d = max - min;
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return { h: h * 2 * Math.PI, l };
}

const CATS = {
  bezelType: ['rotating', 'internal', 'fixed', 'none'],
  caseShape: ['round', 'cushion', 'tonneau', 'asymmetric'],
  handsStyle: ['sword', 'mercedes', 'snowflake', 'pencil', 'plongeur', 'broad-arrow', 'baton', 'syringe', 'cathedral'],
  movement: ['automatic', 'manual', 'quartz', 'solar', 'digital', 'spring-drive'],
  country: ['CH', 'JP', 'DE', 'US', 'FR', 'IT', 'GB', 'OTHER'],
};
const W_VISUAL = 1.5, W_YEAR = 1.0, W_REST = 0.6;

function featureVector(w) {
  const vals = [], weights = [];
  const push = (v, wt) => { vals.push(v); weights.push(wt); };
  push(w.year, W_YEAR);
  push(w.diameterMm, W_REST);
  push(Math.log(Math.max(1, w.waterResistanceM || 1)), W_REST);
  const dial = hexToHsl(w.dialColor);
  push(Math.cos(dial.h), W_VISUAL); push(Math.sin(dial.h), W_VISUAL); push(dial.l, W_VISUAL);
  const accent = hexToHsl(w.accentColor);
  push(Math.cos(accent.h), W_VISUAL); push(Math.sin(accent.h), W_VISUAL);
  const oneHot = (list, val, wt) => list.forEach(c => push(c === val ? 1 : 0, wt));
  oneHot(CATS.bezelType, w.bezelType, W_VISUAL);
  oneHot(CATS.caseShape, w.caseShape, W_VISUAL);
  oneHot(CATS.handsStyle, w.features?.handsStyle, W_VISUAL);
  oneHot(CATS.movement, w.movement, W_REST);
  oneHot(CATS.country, w.country, W_REST);
  push(w.features?.crownGuard ? 1 : 0, W_REST);
  push(w.features?.dateWindow ? 1 : 0, W_REST);
  return { vals, weights };
}

function buildMatrix(watches) {
  const rows = watches.map(featureVector);
  const d = rows[0].vals.length, n = rows.length;
  const X = rows.map(r => r.vals.slice());
  const weights = rows[0].weights;
  for (let j = 0; j < d; j++) {                 // standardize, then weight
    let mean = 0; for (let i = 0; i < n; i++) mean += X[i][j]; mean /= n;
    let varr = 0; for (let i = 0; i < n; i++) varr += (X[i][j] - mean) ** 2; varr /= Math.max(1, n - 1);
    const std = Math.sqrt(varr) || 1;
    for (let i = 0; i < n; i++) X[i][j] = ((X[i][j] - mean) / std) * weights[j];
  }
  return X;
}

// ----------------------------------------------------------------- PCA ----

// Top-2 principal components via power iteration with deflation.
function pca2d(X) {
  const n = X.length, d = X[0].length;
  const C = Array.from({ length: d }, () => new Float64Array(d));
  for (const row of X)
    for (let a = 0; a < d; a++) { const ra = row[a]; for (let b = a; b < d; b++) C[a][b] += ra * row[b]; }
  for (let a = 0; a < d; a++) for (let b = 0; b < a; b++) C[a][b] = C[b][a];
  for (let a = 0; a < d; a++) for (let b = 0; b < d; b++) C[a][b] /= Math.max(1, n - 1);

  const topEig = () => {
    let v = Float64Array.from({ length: d }, (_, i) => Math.sin(i * 12.9898 + 78.233)); // deterministic seed
    for (let it = 0; it < 300; it++) {
      const nv = new Float64Array(d);
      for (let a = 0; a < d; a++) { let s = 0; for (let b = 0; b < d; b++) s += C[a][b] * v[b]; nv[a] = s; }
      const norm = Math.hypot(...nv) || 1;
      for (let a = 0; a < d; a++) v[a] = nv[a] / norm;
    }
    let lambda = 0;
    for (let a = 0; a < d; a++) { let s = 0; for (let b = 0; b < d; b++) s += C[a][b] * v[b]; lambda += v[a] * s; }
    return { v, lambda };
  };
  const e1 = topEig();
  for (let a = 0; a < d; a++) for (let b = 0; b < d; b++) C[a][b] -= e1.lambda * e1.v[a] * e1.v[b]; // deflate
  const e2 = topEig();
  return X.map(row => {
    let x = 0, y = 0;
    for (let j = 0; j < d; j++) { x += row[j] * e1.v[j]; y += row[j] * e2.v[j]; }
    return [x, y];
  });
}

// ------------------------------------------------------------- placing ----

function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
const hash01 = (str) => fnv1a(str) / 0xffffffff;

function layout(watches) {
  const pts = pca2d(buildMatrix(watches));

  // family centroids in PCA space
  const fam = new Map();
  watches.forEach((w, i) => {
    if (!fam.has(w.designFamily)) fam.set(w.designFamily, { x: 0, y: 0, n: 0 });
    const f = fam.get(w.designFamily); f.x += pts[i][0]; f.y += pts[i][1]; f.n++;
  });
  for (const f of fam.values()) { f.x /= f.n; f.y /= f.n; }

  // blend toward family centroid
  let pos = watches.map((w, i) => {
    const f = fam.get(w.designFamily);
    return [PCA_WEIGHT * pts[i][0] + FAMILY_PULL * f.x, PCA_WEIGHT * pts[i][1] + FAMILY_PULL * f.y];
  });

  // scale to world
  const xs = pos.map(p => p[0]), ys = pos.map(p => p[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const half = Math.max(Math.max(...xs) - cx, Math.max(...ys) - cy, 1e-9);
  pos = pos.map(p => [((p[0] - cx) / half) * WORLD_HALF, ((p[1] - cy) / half) * WORLD_HALF]);

  // deterministic jitter (hash of id, no Math.random)
  pos = pos.map((p, i) => {
    const a = hash01(watches[i].id) * 2 * Math.PI, r = 4 + hash01(watches[i].id + '/r') * 8;
    return [p[0] + Math.cos(a) * r, p[1] + Math.sin(a) * r];
  });

  // collision relaxation
  for (let it = 0; it < RELAX_ITERS; it++) {
    let moved = false;
    for (let i = 0; i < pos.length; i++) {
      for (let j = i + 1; j < pos.length; j++) {
        let dx = pos[j][0] - pos[i][0], dy = pos[j][1] - pos[i][1];
        let dist = Math.hypot(dx, dy);
        if (dist < 1e-9) { // coincident: split deterministically
          const a = hash01(watches[i].id + watches[j].id) * 2 * Math.PI;
          dx = Math.cos(a); dy = Math.sin(a); dist = 1;
        }
        if (dist < MIN_SPACING) {
          const push = (MIN_SPACING - dist) / 2 * 1.05;
          const ux = dx / dist, uy = dy / dist;
          pos[i][0] -= ux * push; pos[i][1] -= uy * push;
          pos[j][0] += ux * push; pos[j][1] += uy * push;
          moved = true;
        }
      }
    }
    if (!moved) break;
  }

  const placed = watches.map((w, i) => ({
    ...w,
    x: Math.round(pos[i][0] * 100) / 100,
    y: Math.round(pos[i][1] * 100) / 100,
  }));

  // family label anchors from final positions
  const famOut = new Map();
  for (const w of placed) {
    if (!famOut.has(w.designFamily)) famOut.set(w.designFamily, { x: 0, y: 0, n: 0 });
    const f = famOut.get(w.designFamily); f.x += w.x; f.y += w.y; f.n++;
  }
  const families = [...famOut.entries()].map(([id, f]) => ({
    id,
    label: FAMILY_LABELS[id] || id,
    x: Math.round((f.x / f.n) * 100) / 100,
    y: Math.round((f.y / f.n) * 100) / 100,
    count: f.n,
  })).sort((a, b) => b.count - a.count);

  return { placed, families };
}

// ---------------------------------------------------------------- main ----

const watches = loadWatches();
if (!Array.isArray(watches) || watches.length === 0) {
  console.error('watches.json is not a non-empty array'); process.exit(1);
}
const { placed, families } = layout(watches);

// verify
let minPair = Infinity;
for (let i = 0; i < placed.length; i++) {
  if (!Number.isFinite(placed[i].x) || !Number.isFinite(placed[i].y)) {
    console.error(`Non-finite coordinate for ${placed[i].id}`); process.exit(1);
  }
  for (let j = i + 1; j < placed.length; j++)
    minPair = Math.min(minPair, Math.hypot(placed[j].x - placed[i].x, placed[j].y - placed[i].y));
}
if (minPair < MIN_SPACING - 0.5) {
  console.error(`Min pair distance ${minPair.toFixed(2)} < spacing ${MIN_SPACING}`); process.exit(1);
}

mkdirSync(dirname(ATLAS_PATH), { recursive: true });
writeFileSync(ATLAS_PATH, JSON.stringify({ generatedAt: null, watches: placed, families }, null, 2) + '\n');

const xs = placed.map(w => w.x), ys = placed.map(w => w.y);
console.log(`Wrote ${ATLAS_PATH}`);
console.log(`  watches: ${placed.length}, families: ${families.length}`);
console.log(`  x: [${Math.min(...xs).toFixed(1)}, ${Math.max(...xs).toFixed(1)}]  y: [${Math.min(...ys).toFixed(1)}, ${Math.max(...ys).toFixed(1)}]`);
console.log(`  min pair distance: ${minPair.toFixed(2)} (min spacing ${MIN_SPACING})`);
