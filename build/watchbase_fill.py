#!/usr/bin/env python3
"""WatchBase catalog-render fill for The Horological Atlas.

For every watch missing from data/images.json: locate its reference page via
server-rendered brand -> family -> reference navigation, pull the og:image
catalog render, knock out the white/transparent background, and composite onto
the DEEP FIELD surface tone so the catalog layer looks native to the dark UI.

Writes data/images-shard-watchbase.json incrementally (after every save) and
merges into data/images.json at the end. Skip-over-wrong is the law.
"""

import json, re, sys, time, unicodedata, urllib.request
from io import BytesIO
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
IMG = DATA / "img"
SHARD = DATA / "images-shard-watchbase.json"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0 Safari/537.36")
SLEEP = 1.5

# DEEP FIELD tones
BG = (13, 17, 23)          # --surface base #0D1117
LIFT = (233, 237, 242)     # ink, used at ~3.5% for the radial lift
CANVAS = 900
WATCH_H = 660              # ~73% of canvas height


def log(*a):
    print(*a, flush=True)


def fetch(url, binary=False, tries=3):
    wait = 3.0
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=25) as r:
                body = r.read()
                return (body, r.geturl()) if not binary else (body, r.geturl())
        except Exception as e:
            if i == tries - 1:
                raise
            time.sleep(wait)
            wait *= 2


def slugify(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    s = s.lower().replace("&", "and")
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s


def norm_token(s):
    return re.sub(r"[^a-z0-9]+", "", (s or "").lower())


FAMILY_LINK = re.compile(r'href="(https://watchbase\.com/([a-z0-9-]+)/([a-z0-9-]+))"')
REF_LINK = re.compile(r'href="(https://watchbase\.com/([a-z0-9-]+)/([a-z0-9-]+)/([a-z0-9-]+))"')
OG_IMAGE = re.compile(r'<meta property="og:image" content="([^"]+)"')

brand_cache = {}
family_cache = {}


def brand_page(slug):
    if slug in brand_cache:
        return brand_cache[slug]
    try:
        html, _ = fetch(f"https://watchbase.com/{slug}")
        html = html.decode("utf-8", "replace")
    except Exception:
        brand_cache[slug] = None
        return None
    time.sleep(SLEEP)
    fams, refs = set(), set()
    for m in FAMILY_LINK.finditer(html):
        if m.group(2) == slug and m.group(3) not in ("caliber",):
            fams.add(m.group(3))
    for m in REF_LINK.finditer(html):
        if m.group(2) == slug and m.group(3) != "caliber":
            refs.add((m.group(3), m.group(4), m.group(1)))
    out = {"families": fams, "refs": refs}
    brand_cache[slug] = out
    return out


def family_refs(brand_slug, fam_slug):
    key = (brand_slug, fam_slug)
    if key in family_cache:
        return family_cache[key]
    try:
        html, _ = fetch(f"https://watchbase.com/{brand_slug}/{fam_slug}")
        html = html.decode("utf-8", "replace")
    except Exception:
        family_cache[key] = set()
        return set()
    time.sleep(SLEEP)
    refs = set()
    for m in REF_LINK.finditer(html):
        if m.group(2) == brand_slug and m.group(3) == fam_slug:
            refs.add((m.group(3), m.group(4), m.group(1)))
    family_cache[key] = refs
    return refs


def find_detail_url(w):
    """brand page -> ref token match; else best-family pages -> ref match."""
    bslug = slugify(w["brand"])
    bp = brand_page(bslug)
    if bp is None:
        return None
    ref_tok = norm_token(w.get("reference", ""))
    model_toks = [t for t in re.split(r"[^a-z0-9]+", w["model"].lower()) if len(t) >= 3]

    def match_in(refs):
        if ref_tok and len(ref_tok) >= 4:
            for fam, ref, url in refs:
                if ref_tok in norm_token(ref):
                    return url
        # model-token fallback: unique family whose slug contains a model token
        return None

    hit = match_in(bp["refs"])
    if hit:
        return hit

    # rank families by similarity to model name, try the top few
    fams = sorted(bp["families"],
                  key=lambda f: -sum(1 for t in model_toks if t in f))
    for fam in fams[:4]:
        if not any(t in fam for t in model_toks) and (not ref_tok or len(ref_tok) < 4):
            continue
        refs = family_refs(bslug, fam)
        hit = match_in(refs)
        if hit:
            return hit
    return None


def radial_bg():
    small = np.zeros((90, 90, 3), dtype=np.float64)
    yy, xx = np.mgrid[0:90, 0:90]
    d = np.sqrt((xx - 45) ** 2 + (yy - 43) ** 2) / 58.0
    lift = np.clip(1.0 - d, 0, 1) ** 1.6 * 0.035
    for i in range(3):
        small[:, :, i] = BG[i] + (LIFT[i] - BG[i]) * lift
    img = Image.fromarray(small.astype("uint8"), "RGB")
    return img.resize((CANVAS, CANVAS), Image.LANCZOS)


BG_IMG = radial_bg()


def _keep_center_component(core):
    """Keep only the core component connected to the image center —
    detached elements (brand logos, badges) are dropped."""
    h, w = core.shape
    cy, cx = h // 2, w // 2
    seed = None
    for r in range(0, max(h, w) // 2, 6):
        ys = slice(max(0, cy - r), min(h, cy + r + 1))
        xs = slice(max(0, cx - r), min(w, cx + r + 1))
        block = core[ys, xs]
        if block.any():
            oy, ox = np.argwhere(block)[0]
            seed = (xs.start + int(ox), ys.start + int(oy))
            break
    if seed is None:
        return core
    m = Image.fromarray((core * 255).astype("uint8")).convert("RGB")
    ImageDraw.floodfill(m, seed, (255, 0, 0), thresh=0)
    arr = np.array(m)
    return (arr[:, :, 0] == 255) & (arr[:, :, 1] == 0)


def _fill_holes(core):
    """Everything not reachable from the border through non-core is a hole."""
    inv = Image.fromarray(((~core) * 255).astype("uint8")).convert("RGB")
    h, w = core.shape
    for s in [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]:
        if inv.getpixel(s) == (255, 255, 255):
            ImageDraw.floodfill(inv, s, (0, 255, 0), thresh=0)
    arr = np.array(inv)
    outside = (arr[:, :, 1] == 255) & (arr[:, :, 0] == 0)
    return core | (~core & ~outside)


def knockout(img):
    """Return RGBA on transparent ground. Uses real source alpha when present;
    otherwise: silhouette = colorful-or-dark pixels (center component, holes
    filled), and everything outside is white-unmixed so baked drop shadows
    become soft dark shading instead of trapped white pockets."""
    img = img.convert("RGBA")
    a = np.array(img)
    if (a[:, :, 3] < 128).mean() > 0.02:      # real transparency already
        return img

    arr = np.asarray(img.convert("RGB"), dtype=np.float64)
    mn = arr.min(axis=2)
    sat = arr.max(axis=2) - mn
    lum = arr.mean(axis=2)

    core = (mn < 190) | (sat > 22)            # definitely-watch pixels
    core = _keep_center_component(core)
    core = _fill_holes(core)
    core_img = Image.fromarray((core * 255).astype("uint8")).filter(ImageFilter.MaxFilter(3))
    core = np.array(core_img) > 127

    # outside the silhouette: un-compose from white — shadow opacity from darkness
    shadow_a = np.clip((255.0 - lum) * 0.85, 0, 255)
    alpha = np.where(core, 255.0, shadow_a)
    out_rgb = arr.copy()
    out_rgb[~core] = 0.0                      # shadows re-render as pure dark

    alpha_img = Image.fromarray(alpha.astype("uint8"), "L").filter(ImageFilter.GaussianBlur(1.0))
    out = Image.fromarray(out_rgb.astype("uint8"), "RGB").convert("RGBA")
    out.putalpha(alpha_img)
    return out


def compose(png_bytes):
    src = Image.open(BytesIO(png_bytes))
    src = knockout(src)
    bbox = src.getbbox()
    if bbox:
        src = src.crop(bbox)
    scale = min(WATCH_H / src.height, (CANVAS * 0.8) / src.width)
    src = src.resize((max(1, int(src.width * scale)), max(1, int(src.height * scale))),
                     Image.LANCZOS)
    canvas = BG_IMG.copy()
    canvas.paste(src, ((CANVAS - src.width) // 2, int(CANVAS * 0.48) - src.height // 2), src)
    return canvas


def redo():
    """Re-render every shard entry through the current treatment,
    refetching og:image from the recorded source page."""
    shard = json.loads(SHARD.read_text())
    done, failed = 0, []
    for wid, entry in shard.items():
        try:
            html, _ = fetch(entry["source"])
            time.sleep(SLEEP)
            m = OG_IMAGE.search(html.decode("utf-8", "replace"))
            if not m:
                failed.append(wid); continue
            img_bytes, _ = fetch(m.group(1), binary=True)
            time.sleep(SLEEP)
            compose(img_bytes).convert("RGB").save(IMG / f"{wid}.jpg", "JPEG", quality=88)
            done += 1
            log(f"redo  {wid}")
        except Exception as e:
            failed.append(wid)
            log(f"err   {wid}: {e}")
    log(f"\nredone {done}, failed {len(failed)}: {','.join(failed)}")


def main():
    if len(sys.argv) > 1 and sys.argv[1] == "--redo":
        redo()
        return
    watches = json.loads((DATA / "watches.json").read_text())
    manifest = json.loads((DATA / "images.json").read_text())
    shard = {}
    if SHARD.exists():
        shard = json.loads(SHARD.read_text())
    targets = [w for w in watches if w["id"] not in manifest and w["id"] not in shard]
    log(f"targets: {len(targets)} of {len(watches)}")
    saved, skipped = [], []

    for i, w in enumerate(targets):
        wid = w["id"]
        try:
            url = find_detail_url(w)
            if not url:
                skipped.append(wid); log(f"skip  {wid} (no page match)"); continue
            html, final_url = fetch(url)
            time.sleep(SLEEP)
            m = OG_IMAGE.search(html.decode("utf-8", "replace"))
            if not m or "default" in m.group(1) or "logo" in m.group(1):
                skipped.append(wid); log(f"skip  {wid} (no render)"); continue
            img_bytes, _ = fetch(m.group(1), binary=True)
            time.sleep(SLEEP)
            if len(img_bytes) < 8000:
                skipped.append(wid); log(f"skip  {wid} (tiny render)"); continue
            out = compose(img_bytes)
            out.convert("RGB").save(IMG / f"{wid}.jpg", "JPEG", quality=88)
            shard[wid] = {
                "file": f"img/{wid}.jpg",
                "credit": "WatchBase catalog render",
                "license": "Unlicensed — personal prototype; clear before publishing",
                "source": final_url,
                "confidence": "catalog",
            }
            SHARD.write_text(json.dumps(shard, indent=2) + "\n")
            saved.append(wid)
            log(f"ok    {wid}  [{i + 1}/{len(targets)}]")
        except Exception as e:
            skipped.append(wid)
            log(f"err   {wid}: {e}")

    # merge into the live manifest
    manifest = json.loads((DATA / "images.json").read_text())
    for k, v in shard.items():
        if k not in manifest and (DATA / v["file"]).exists():
            manifest[k] = v
    (DATA / "images.json").write_text(json.dumps(manifest, indent=2) + "\n")

    log("\n---- summary ----")
    log(f"saved:   {len(saved)}")
    log(f"skipped: {len(skipped)}: {','.join(skipped)}")
    log(f"manifest now {len(manifest)} of {len(watches)}")


if __name__ == "__main__":
    main()
