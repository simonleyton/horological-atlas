#!/usr/bin/env python3
"""favicon-emoji.py — render 🌊 to the site's icon set.

Replaces the dive-bezel mark (recoverable: git show 2f57259:favicon.svg).

Apple Color Emoji is a bitmap font — Pillow opens it only at the sizes the font
actually ships strikes for (on this machine: 20, 26, 32, 40, 48, 52, 64, 96,
160). Everything is rendered once at the largest strike and downsampled with
LANCZOS. Doing it the other way — rendering small — gives you mush.

    python3 build/favicon-emoji.py

Writes favicon-16.png, favicon-32.png, apple-touch-icon.png, icon-512.png.
favicon.svg is maintained by hand (it defers to the system emoji font).
"""

import os
from PIL import Image, ImageDraw, ImageFont

GLYPH = "\U0001F30A"                      # 🌊
STRIKE = 160                              # the largest strike the font ships
FONT = "/System/Library/Fonts/Apple Color Emoji.ttc"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GROUND = (6, 8, 11, 255)                  # #06080B — the site's field, for iOS only

# transparent master at the native strike
f = ImageFont.truetype(FONT, STRIKE)
master = Image.new("RGBA", (160, 160), (0, 0, 0, 0))
ImageDraw.Draw(master).text((80, 80), GLYPH, font=f, embedded_color=True, anchor="mm")

# tab icons: transparent — the emoji carries its own colour and sits on
# whatever chrome the browser has, light or dark
for size, name in ((16, "favicon-16.png"), (32, "favicon-32.png")):
    master.resize((size, size), Image.LANCZOS).save(os.path.join(ROOT, name), "PNG", optimize=True)

# icon-512 is currently unreferenced (no web manifest) but kept in step with the
# set. The 160px strike is the ceiling, so this is an upscale — quantized to hold
# the file near 30KB rather than shipping 200KB of interpolated gradient.
big = master.resize((512, 512), Image.LANCZOS).quantize(colors=128, method=Image.FASTOCTREE)
big.save(os.path.join(ROOT, "icon-512.png"), "PNG", optimize=True)

# apple-touch-icon: iOS composites onto an opaque tile and rounds the corners
# itself, so hand it the site's ground rather than letting iOS pick white
touch = Image.new("RGBA", (180, 180), GROUND)
art = master.resize((150, 150), Image.LANCZOS)
touch.paste(art, (15, 15), art)
touch.convert("RGB").save(os.path.join(ROOT, "apple-touch-icon.png"), "PNG", optimize=True)

print("wrote favicon-16 / favicon-32 / icon-512 / apple-touch-icon")
