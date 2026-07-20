#!/usr/bin/env python3
"""knockout.py — lift a watch off a white auction-lot ground onto the atlas ground.

The catalog layer is 900x900 on (13,16,23). Sources that already sit on a dark
ground go through darkmatch.py; this is for the white-background lot photos.

Two things make a silver watch on white harder than it looks:

  1. A brightness threshold eats the subject. The PloProf's dial, its printing
     and its lume are all white or near-white. So the background is found by
     FLOOD FILL FROM THE BORDER instead — white that is enclosed by the bezel
     is never reached, and survives.

  2. A binary mask leaves a white fringe. Every pixel on the silhouette is a
     mix of white ground and steel, and against (13,16,23) that ring reads as
     a halo — the classic knockout tell. The mask is eroded past the
     contaminated ring before it is feathered, and the composite happens at
     FULL resolution so the downscale to 900 does the anti-aliasing against
     the dark ground rather than against white.

    python3 build/knockout.py <src> <out-id> [--probe] [--bleed] [--tol N]

--probe writes diagnostics instead of the final image.
--bleed  composes the 900x600 landscape plate instead of the 900x900 one.

The corpus has two committed formats, measured across all 146 plates:
  900x900  116 plates, subject wholly inside the frame (the specimen cut)
  900x600   30 plates, of which 15 run the bracelet cleanly off BOTH the top
            and bottom edges (the bleed cut)
--bleed reproduces the second: subject width normalised to 0.49 of the frame
(the corpus median), watch head centred on the frame's middle, bracelet
allowed to leave the frame. The head is found as the widest row of the mask,
which is the line through the case and crown.
"""

import sys, os
import numpy as np
from PIL import Image, ImageFilter
from collections import deque

GROUND = (13, 16, 23)
OUT = 900
SUBJECT_FRAC = 0.718          # measured off the existing catalog plates: 646/900
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

src_path = sys.argv[1]
out_id = sys.argv[2]
probe = '--probe' in sys.argv
bleed = '--bleed' in sys.argv


def flood_background(a, tol=14):
    """Background = near-white pixels connected to the image border.

    Scanline flood fill; the recursion-free version matters because these lot
    photos are 1500x2338 and Python's stack is not."""
    H, W = a.shape[:2]
    near_white = (a.min(axis=2) > 255 - tol)
    bg = np.zeros((H, W), bool)
    q = deque()
    for x in range(W):
        for y in (0, H - 1):
            if near_white[y, x] and not bg[y, x]:
                bg[y, x] = True; q.append((y, x))
    for y in range(H):
        for x in (0, W - 1):
            if near_white[y, x] and not bg[y, x]:
                bg[y, x] = True; q.append((y, x))
    while q:
        y, x = q.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < H and 0 <= nx < W and near_white[ny, nx] and not bg[ny, nx]:
                bg[ny, nx] = True; q.append((ny, nx))
    return bg


im = Image.open(src_path).convert('RGB')
a = np.asarray(im)
H, W = a.shape[:2]

tol = int(sys.argv[sys.argv.index('--tol') + 1]) if '--tol' in sys.argv else 14
bg = flood_background(a, tol)
subj = ~bg

# Seal the specular bites. Polished steel flanks peak near white, so the fill
# reaches a little way into them; a morphological close puts back anything the
# subject encloses without moving the true silhouette.
_m = Image.fromarray((subj * 255).astype('uint8'))
_m = _m.filter(ImageFilter.MaxFilter(7)).filter(ImageFilter.MinFilter(7))
subj = np.asarray(_m) > 127

# The soft cast shadow under the lot photo is too faint for the fill to take,
# so it survives as "subject" and the close then bridges it to the bracelet.
# It is not a mirror image — it carries no detail — so it is found by VARIANCE,
# not by gaps: scanning up from the bottom, the first row whose non-white pixels
# actually vary is where the object really ends. On this source the collapse is
# unmistakable (std 31.7 at the bracelet, 1.9 one row into the shadow).
# An earlier gap-based attempt cut at row 431, in the upper bracelet, and threw
# the whole watch away.
grey = a.astype(np.float32)
rows_m = subj.any(axis=1)
ys_all = np.where(rows_m)[0]
split = None
for y in range(ys_all.max(), ys_all.min(), -1):
    px = grey[y][grey[y].min(axis=1) < 240]
    if len(px) > 40 and px.std() > 10:
        split = y + 1
        break
if split is not None and split <= ys_all.max():
    subj[split:, :] = False

ys, xs = np.where(subj)
bbox = (xs.min(), ys.min(), xs.max(), ys.max())

if probe:
    print('source      ', im.size)
    print('bg fraction ', round(bg.mean(), 4))
    print('shadow cut  ', split)
    print('subject bbox', bbox, 'w', bbox[2]-bbox[0], 'h', bbox[3]-bbox[1])
    vis = np.array(a)
    vis[bg] = (255, 0, 0)
    Image.fromarray(vis).resize((im.width // 3, im.height // 3), Image.LANCZOS).save(
        os.path.join(ROOT, 'probe-mask.png'))
    sys.exit(0)

# --- erode past the contaminated ring, then feather
m = Image.fromarray((subj * 255).astype('uint8'))
m = m.filter(ImageFilter.MinFilter(5))        # erode ~2px: kills the white fringe
m = m.filter(ImageFilter.GaussianBlur(1.2))   # feather
alpha = np.asarray(m).astype(np.float32) / 255.0

# --- composite at FULL resolution so the downscale anti-aliases against ground
ground = np.zeros_like(a, dtype=np.float32)
ground[:] = GROUND
comp = a.astype(np.float32) * alpha[..., None] + ground * (1 - alpha[..., None])
comp = Image.fromarray(np.clip(comp, 0, 255).astype('uint8'))

# --- crop to the subject, then frame it like the rest of the catalog
x0, y0, x1, y1 = bbox
sw, sh = x1 - x0, y1 - y0

if bleed:
    CW, CH = 900, 600
    WIDTH_FRAC = 0.49                       # corpus median for the bleed plates
    scale = (CW * WIDTH_FRAC) / sw
    # the watch head sits on the widest row of the mask — the line through the
    # case and crown. Centring the bbox instead would centre the BRACELET, which
    # is what pushes the head off-centre on a portrait source.
    roww = subj[y0:y1 + 1].sum(axis=1)
    head_y = y0 + int(np.argmax(roww))
    comp = comp.crop((x0, 0, x1, comp.height)).resize(
        (max(1, round(sw * scale)), max(1, round(comp.height * scale))), Image.LANCZOS)
    canvas = Image.new('RGB', (CW, CH), GROUND)
    ox = (CW - comp.width) // 2
    oy = round(CH / 2 - (head_y * scale))   # head on the frame's horizon
    canvas.paste(comp, (ox, oy))
else:
    target = OUT * SUBJECT_FRAC
    scale = target / max(sw, sh)
    comp = comp.crop((x0, y0, x1, y1)).resize(
        (max(1, round(sw * scale)), max(1, round(sh * scale))), Image.LANCZOS)
    canvas = Image.new('RGB', (OUT, OUT), GROUND)
    canvas.paste(comp, ((OUT - comp.width) // 2, (OUT - comp.height) // 2))

dst = os.path.join(ROOT, 'data', 'img-catalog', out_id + '.jpg')
canvas.save(dst, 'JPEG', quality=92)
print('wrote', dst, canvas.size, 'subject', comp.size)
