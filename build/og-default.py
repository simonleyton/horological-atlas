#!/usr/bin/env python3
"""og-default.py — the 1200x630 link-preview card.

The plate's ground and frame language, cropped to landscape: same near-black
radial vignette, same hairline + corner registration ticks, same orange
wordmark. A link preview is the first frame of the site anyone sees, so it
should look like the site and not like a logo on a rectangle.

    python3 build/og-default.py

Writes ./og-default.png (referenced by the og:image / twitter:image tags).
"""

import os
from PIL import Image, ImageDraw, ImageFont

W, H = 1200, 630
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "og-default.png")
HERO = os.path.join(ROOT, "data", "hero-fifty-fathoms.png")

INK = (233, 237, 242)
TEXT_3 = (92, 102, 114)
ORANGE = (246, 147, 93)


def font(size, weight="Regular"):
    """SF first (it's what the site renders in), Helvetica as the fallback."""
    for path, idx in (("/System/Library/Fonts/SFNS.ttf", None),
                      ("/System/Library/Fonts/HelveticaNeue.ttc", 0),
                      ("/System/Library/Fonts/Helvetica.ttc", 0)):
        if os.path.exists(path):
            try:
                f = ImageFont.truetype(path, size, index=idx) if idx is not None \
                    else ImageFont.truetype(path, size)
                try:
                    f.set_variation_by_name(weight)
                except Exception:
                    pass
                return f
            except Exception:
                continue
    return ImageFont.load_default()


def tracked(d, xy, text, f, fill, track=0.0, anchor_right=False):
    """PIL has no letter-spacing — draw glyph by glyph. The plate's whole
    typographic character is its tracking, so this is not optional."""
    chars = list(text)
    widths = [d.textlength(ch, font=f) + track for ch in chars]
    total = sum(widths) - (track if chars else 0)
    x, y = xy
    if anchor_right:
        x -= total
    for ch, w in zip(chars, widths):
        d.text((x, y), ch, font=f, fill=fill)
        x += w
    return total


def ground():
    """radial vignette #06080B -> #04050A, matching buildPoster()"""
    img = Image.new("RGB", (W, H), (6, 8, 11))
    px = img.load()
    cx, cy = W / 2, H / 2
    rmax = max(W, H) * 0.75
    for y in range(H):
        for x in range(0, W, 2):
            d = ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5 / rmax
            t = max(0.0, min(1.0, (d - 0.52) / 0.48))
            c = (int(6 + (4 - 6) * t), int(8 + (5 - 8) * t), int(11 + (10 - 11) * t))
            px[x, y] = c
            if x + 1 < W:
                px[x + 1, y] = c
    return img


img = ground()
d = ImageDraw.Draw(img, "RGBA")

# the watch, bled off the right edge — the hero asset the site already ships
if os.path.exists(HERO):
    hero = Image.open(HERO).convert("RGBA")
    s = (H * 1.18) / hero.height
    hero = hero.resize((int(hero.width * s), int(hero.height * s)), Image.LANCZOS)
    img.paste(hero, (int(W - hero.width * 0.62), int((H - hero.height) / 2)), hero)
    d = ImageDraw.Draw(img, "RGBA")

# frame: mat hairline + corner registration ticks (the plate's signature)
MAT = 34
d.rectangle([MAT, MAT, W - MAT, H - MAT], outline=(233, 237, 242, 46), width=1)
for tx, ty in ((MAT, MAT), (W - MAT, MAT), (MAT, H - MAT), (W - MAT, H - MAT)):
    d.rectangle([tx - 10, ty - 1, tx + 10, ty + 1], fill=(233, 237, 242, 87))
    d.rectangle([tx - 1, ty - 10, tx + 1, ty + 10], fill=(233, 237, 242, 87))

L = MAT + 44
tracked(d, (L, 96), "sea time", font(34, "Medium"), ORANGE, 0)
tracked(d, (L, 168), "A FIELD GUIDE TO THE DIVE WATCH", font(15, "Medium"), TEXT_3, 4.2)

body = ["A living map of the dive watch,", "arranged by the one measure that", "ever mattered at sea. Depth."]
for i, line in enumerate(body):
    d.text((L, 250 + i * 46), line, font=font(32), fill=INK)

tracked(d, (L, H - 96), "143 REFERENCES · SURFACE TO THE MARIANA FLOOR",
        font(14, "Medium"), TEXT_3, 3.4)

img.save(OUT, "PNG", optimize=True)
print("wrote %s (%dx%d)" % (OUT, W, H))
