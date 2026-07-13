import sys
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

src_path, out_path = sys.argv[1], sys.argv[2]
img = Image.open(src_path).convert("RGB")
arr = np.asarray(img, dtype=np.float64)
h, w = arr.shape[:2]

# Background = near-white. Flood from borders through white-ish pixels.
lum = arr.mean(axis=2)
whiteish = (lum > 205) & (arr.max(axis=2) - arr.min(axis=2) < 30)
# label connected white regions, keep those touching border = background
lbl, n = ndimage.label(whiteish)
border_labels = set(lbl[0,:]) | set(lbl[-1,:]) | set(lbl[:,0]) | set(lbl[:,-1])
border_labels.discard(0)
bg = np.isin(lbl, list(border_labels))
# fill: watch alpha = not background
fg = ~bg
# clean up: fill small holes inside fg, remove speckles
fg = ndimage.binary_fill_holes(fg)
fg = ndimage.binary_opening(fg, iterations=2)
fg = ndimage.binary_closing(fg, iterations=3)
# keep largest component (the watch+bracelet)
lbl2, n2 = ndimage.label(fg)
if n2 > 0:
    sizes = ndimage.sum(np.ones_like(lbl2), lbl2, range(1, n2+1))
    keep = np.argmax(sizes) + 1
    fg = lbl2 == keep

alpha = (fg * 255).astype("uint8")
alpha_img = Image.fromarray(alpha, "L").filter(ImageFilter.GaussianBlur(1.2))
out = img.convert("RGBA")
out.putalpha(alpha_img)
out.save(out_path)
# report coverage
print("fg fraction:", round(fg.mean(),4))
