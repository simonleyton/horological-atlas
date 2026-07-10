#!/usr/bin/env node
// Fetch real watch photographs from Wikimedia Commons for The Horological Atlas.
// Node >= 18, zero deps (global fetch).

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DATA = path.join(ROOT, "data");
const IMG_DIR = path.join(DATA, "img");
const API = "https://commons.wikimedia.org/w/api.php";
const UA = "HorologicalAtlas/0.1 (personal prototype)";

const BAD_TITLE_WORDS = [
  "movement", "caseback", "case back", "box", "advertisement", "advert",
  "logo", "patent", "drawing", "catalog",
];
const OK_EXT = /\.(jpe?g|png|webp)$/i;
const GENERIC = new Set([
  "watch", "watches", "the", "and", "with", "for", "diver", "divers", "dive",
]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// fetch with retry/backoff on 429 and transient errors.
async function fetchRetry(url, tries = 5) {
  let wait = 2000;
  for (let i = 0; i < tries; i++) {
    let res;
    try {
      res = await fetch(url, { headers: { "User-Agent": UA } });
    } catch (err) {
      if (i === tries - 1) throw err;
      await sleep(wait);
      wait *= 2;
      continue;
    }
    if (res.ok) return res;
    if (res.status === 429 || res.status >= 500) {
      const ra = Number(res.headers.get("retry-after"));
      await sleep(Number.isFinite(ra) && ra > 0 ? ra * 1000 : wait);
      wait *= 2;
      continue;
    }
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
  throw new Error(`HTTP 429 (retries exhausted) for ${url}`);
}

// Normalize for matching: lowercase, strip diacritics, unify separators.
function norm(s) {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[-_./']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripHtml(s) {
  return s
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Distinctive model tokens: length >= 3, not generic words.
function modelTokens(watch) {
  const raw = norm(`${watch.model} ${watch.reference || ""}`).split(" ");
  return [...new Set(raw.filter((t) => t.length >= 3 && !GENERIC.has(t)))];
}

// Brand key: drop parentheticals ("Glashutte (GUB)" -> "glashutte").
function brandKey(brand) {
  return norm(brand.replace(/\(.*?\)/g, ""));
}

async function apiSearch(query) {
  const url = new URL(API);
  url.search = new URLSearchParams({
    action: "query",
    format: "json",
    generator: "search",
    gsrsearch: query,
    gsrnamespace: "6",
    gsrlimit: "8",
    prop: "imageinfo",
    iiprop: "url|extmetadata",
    iiurlwidth: "640",
  }).toString();
  const res = await fetchRetry(url);
  const json = await res.json();
  return Object.values(json?.query?.pages || {});
}

function evaluate(pages, watch) {
  const bKey = brandKey(watch.brand);
  const tokens = modelTokens(watch);
  let best = null;

  for (const page of pages) {
    const title = page?.title || "";
    const info = page?.imageinfo?.[0];
    if (!info || !info.thumburl) continue;

    if (!OK_EXT.test(title)) continue;
    const nTitle = norm(title.replace(/^file:/i, ""));
    if (!nTitle.includes(bKey)) continue; // brand is mandatory
    if (BAD_TITLE_WORDS.some((w) => nTitle.includes(w))) continue;

    const hits = tokens.filter((t) => nTitle.includes(t));
    const area = (info.width || 0) * (info.height || 0);
    const score = hits.length * 1e12 + Math.min(area, 1e12 - 1);
    if (!best || score > best.score) {
      best = { title, info, score, hits };
    }
  }
  if (!best) return null;

  const meta = best.info.extmetadata || {};
  return {
    thumburl: best.info.thumburl,
    credit: stripHtml(meta.Artist?.value || ""),
    license: stripHtml(meta.LicenseShortName?.value || ""),
    source: best.info.descriptionurl || "",
    confidence: best.hits.length > 0 ? "high" : "low",
  };
}

async function download(url, dest) {
  const res = await fetchRetry(url);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length === 0) throw new Error(`empty body for ${url}`);
  await writeFile(dest, buf);
}

async function main() {
  const watches = JSON.parse(
    await readFile(path.join(DATA, "watches.json"), "utf8")
  );
  await mkdir(IMG_DIR, { recursive: true });

  // resume: keep prior matches whose files still exist; re-try everything else
  let manifest = {};
  try {
    const prior = JSON.parse(await readFile(path.join(DATA, "images.json"), "utf8"));
    for (const [id, entry] of Object.entries(prior)) {
      if (existsSync(path.join(DATA, entry.file))) manifest[id] = entry;
    }
  } catch { /* first run */ }
  const unmatched = [];
  const saveManifest = () =>
    writeFile(path.join(DATA, "images.json"), JSON.stringify(manifest, null, 2) + "\n");

  for (const watch of watches) {
    if (manifest[watch.id]) {
      console.log(`have  ${watch.id}`);
      continue;
    }
    const queries = [`${watch.brand} ${watch.model} watch`];
    if (watch.reference) queries.push(`${watch.brand} ${watch.reference} watch`);

    let pick = null;
    for (const q of queries) {
      try {
        const pages = await apiSearch(q);
        pick = evaluate(pages, watch);
      } catch (err) {
        console.error(`  [api error] ${watch.id}: ${err.message}`);
      }
      if (pick) break;
      await sleep(300);
    }

    if (!pick) {
      unmatched.push(watch.id);
      console.log(`skip  ${watch.id}`);
      await sleep(300);
      continue;
    }

    try {
      await download(pick.thumburl, path.join(IMG_DIR, `${watch.id}.jpg`));
      manifest[watch.id] = {
        file: `img/${watch.id}.jpg`,
        credit: pick.credit,
        license: pick.license,
        source: pick.source,
        confidence: pick.confidence,
      };
      console.log(`ok    ${watch.id} (${pick.confidence})`);
      await saveManifest();   // incremental — a killed run loses nothing
    } catch (err) {
      unmatched.push(watch.id);
      console.error(`  [download error] ${watch.id}: ${err.message}`);
    }
    await sleep(300);
  }

  await saveManifest();

  // ---- validation ----
  const reloaded = JSON.parse(await readFile(path.join(DATA, "images.json"), "utf8"));
  const ids = new Set(watches.map((w) => w.id));
  let valid = true;
  for (const [id, entry] of Object.entries(reloaded)) {
    if (!ids.has(id)) { valid = false; console.error(`invalid id in manifest: ${id}`); }
    if (!existsSync(path.join(DATA, entry.file))) {
      valid = false; console.error(`missing file: ${entry.file}`);
    }
  }

  const entries = Object.values(reloaded);
  const high = entries.filter((e) => e.confidence === "high").length;
  const low = entries.filter((e) => e.confidence === "low").length;
  console.log("\n---- summary ----");
  console.log(`total watches:   ${watches.length}`);
  console.log(`matched:         ${entries.length}`);
  console.log(`high confidence: ${high}`);
  console.log(`low confidence:  ${low}`);
  console.log(`unmatched (${unmatched.length}): ${unmatched.join(",")}`);
  console.log(`validation:      ${valid ? "PASS" : "FAIL"}`);
  if (!valid) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
