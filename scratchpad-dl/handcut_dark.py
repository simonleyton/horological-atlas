import sys
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

src_path, out_path = sys.argv[1], sys.argv[2]
img = Image.open(src_path).convert("RGB")
# crop to the watch head + bracelet stubs (center vertical band)
w,h = img.size
img = img.crop((int(w*0.30), int(h*0.18), int(w*0.72), int(h*0.90)))
arr = np.asarray(img, dtype=np.float64)
lum = arr.mean(axis=2)
# watch = brighter than dark leather. Dark leather ~ lum<70. But orange dial is mid.
# Use: foreground = NOT (dark AND low-saturation-ish leather)
sat = arr.max(axis=2) - arr.min(axis=2)
dark_bg = (lum < 75) & (sat < 45)
fg = ~dark_bg
fg = ndimage.binary_fill_holes(fg)
fg = ndimage.binary_opening(fg, iterations=3)
fg = ndimage.binary_closing(fg, iterations=5)
fg = ndimage.binary_fill_holes(fg)
lbl,n = ndimage.label(fg)
if n>0:
    sizes = ndimage.sum(np.ones_like(lbl), lbl, range(1,n+1))
    fg = lbl == (np.argmax(sizes)+1)
fg = ndimage.binary_fill_holes(fg)
alpha = (fg*255).astype("uint8")
alpha_img = Image.fromarray(alpha,"L").filter(ImageFilter.GaussianBlur(1.2))
out = img.convert("RGBA"); out.putalpha(alpha_img); out.save(out_path)
print("fg fraction:", round(fg.mean(),4), "crop size", img.size)
