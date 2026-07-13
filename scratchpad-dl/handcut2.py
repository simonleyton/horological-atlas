import sys
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

src_path, out_path = sys.argv[1], sys.argv[2]
img = Image.open(src_path).convert("RGB")
arr = np.asarray(img, dtype=np.float64)
lum = arr.mean(axis=2)
# broader white capture to swallow the bright gaps between mesh links
whiteish = (lum > 190) & (arr.max(axis=2) - arr.min(axis=2) < 40)
lbl, n = ndimage.label(whiteish)
border_labels = set(lbl[0,:]) | set(lbl[-1,:]) | set(lbl[:,0]) | set(lbl[:,-1])
border_labels.discard(0)
bg = np.isin(lbl, list(border_labels))
# grow background inward a touch to eat the bright mesh-gap slivers connected to it
bg = ndimage.binary_dilation(bg, iterations=2)
fg = ~bg
fg = ndimage.binary_fill_holes(fg)
fg = ndimage.binary_opening(fg, iterations=3)
fg = ndimage.binary_closing(fg, iterations=4)
lbl2, n2 = ndimage.label(fg)
if n2 > 0:
    sizes = ndimage.sum(np.ones_like(lbl2), lbl2, range(1, n2+1))
    fg = lbl2 == (np.argmax(sizes) + 1)
fg = ndimage.binary_fill_holes(fg)
alpha = (fg * 255).astype("uint8")
alpha_img = Image.fromarray(alpha, "L").filter(ImageFilter.GaussianBlur(1.2))
out = img.convert("RGBA"); out.putalpha(alpha_img); out.save(out_path)
print("fg fraction:", round(fg.mean(),4))
