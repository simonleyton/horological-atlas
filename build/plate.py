#!/usr/bin/env python3
"""General watch plater -> 900x600 on the #0D1117 catalog ground.
Usage: plate.py <src> <out> [--bg white|dark|auto] [--casew 0.60]
Knocks out the background by border flood-fill (interior whites/lume preserved),
scales so the CASE width fills ~casew of the frame, centers the case, band bleeds."""
import sys, numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage as ndi

src_path, out_path = sys.argv[1], sys.argv[2]
args = sys.argv[3:]
def opt(name, d):
    return args[args.index(name)+1] if name in args else d
BGMODE = opt('--bg','auto'); CASEW = float(opt("--casew","0.48"))
DESPIKE = opt('--despike', None)          # override the auto despike iterations
CROPTOP = float(opt('--croptop','0'))     # fraction of source height to trim off the top
CW, CH = 900, 600
GROUND = np.array([13,17,23],float); LIFT = np.array([233,237,242],float)

def ground(W,H):
    yy,xx = np.mgrid[0:H,0:W]
    d = np.sqrt((xx-W*.5)**2+(yy-H*.46)**2)/(W*.62)
    lift = np.clip(1-d,0,1)**1.6*.035
    return Image.fromarray((GROUND[None,None]+(LIFT-GROUND)[None,None]*lift[...,None]).astype('uint8'),'RGB')

im = Image.open(src_path).convert('RGB')
if CROPTOP > 0:
    im = im.crop((0, int(im.height*CROPTOP), im.width, im.height))
arr = np.asarray(im,float); H,W = arr.shape[:2]
lum = arr.mean(2)
mx,mn = arr.max(2),arr.min(2); sat = np.where(mx>0,(mx-mn)/np.maximum(mx,1),0)

# decide bg from corners if auto
if BGMODE=='auto':
    corners = np.concatenate([lum[:20,:20].ravel(),lum[:20,-20:].ravel(),lum[-20:,:20].ravel(),lum[-20:,-20:].ravel()])
    BGMODE = 'white' if corners.mean()>170 else 'dark'

if BGMODE=='white':
    bgmask = (lum>float(opt('--wthr','216'))) & (sat<0.10)
elif BGMODE=='dark':
    bgmask = (lum<60)
elif BGMODE=='key':  # sample the border's median colour, mask by colour distance
    bpx = np.concatenate([arr[:10].reshape(-1,3), arr[-10:].reshape(-1,3),
                          arr[:,:10].reshape(-1,3), arr[:,-10:].reshape(-1,3)])
    bgc = np.median(bpx,0)
    dist = np.sqrt(((arr-bgc)**2).sum(2))
    thr = float(opt('--keythr','55'))
    bgmask = dist < thr
else:  # 'edge' — barrier flood-fill; bg = flat/low-gradient region touching the border
    emag = np.zeros_like(lum)
    for ch in range(3):
        gy,gx = np.gradient(arr[:,:,ch]); emag = np.maximum(emag, np.hypot(gx,gy))
    ethr = float(opt('--ethr','7'))
    barrier = ndi.binary_dilation(emag>ethr, iterations=int(opt('--edilate','3')))
    bgmask = ~barrier

# keep only bg connected to the border (preserves interior white lume/text, dial)
lbl,n = ndi.label(bgmask)
border = set(lbl[0]) | set(lbl[-1]) | set(lbl[:,0]) | set(lbl[:,-1]); border.discard(0)
bg = np.isin(lbl,list(border))
fg = ~bg
fg = ndi.binary_fill_holes(fg)
fg = ndi.binary_opening(fg, iterations=2)      # snap thin bridges (fuzzy strap edges, reflections)
# largest fg component (drops the mirror reflection + stray specks)
l2,n2 = ndi.label(fg)
if n2>1:
    fg = l2==(1+int(np.argmax(ndi.sum(np.ones_like(l2),l2,range(1,n2+1)))))
fg = ndi.binary_closing(fg, iterations=2)
fg = ndi.binary_fill_holes(fg)

ys,xs = np.where(fg)
if len(xs)==0:
    raise SystemExit('no foreground found')
# case width = widest horizontal run; case center = median of near-max-width rows
rows = np.where(fg.any(1))[0]
width_at = np.array([ (np.where(fg[y])[0].max()-np.where(fg[y])[0].min()) for y in rows ])
casew_px = np.percentile(width_at, 99)
caserows = rows[width_at > 0.90*casew_px]
cyc = int(np.median(caserows))
cxc = int(np.mean([ (np.where(fg[y])[0].max()+np.where(fg[y])[0].min())/2 for y in caserows ]))

scale = (CASEW*CW)/casew_px
# soft anti-aliased alpha: opaque interior, edges follow the true watch/strap
# boundary from the image itself (no despike jaggies, no paint rectangles)
core = ndi.binary_erosion(fg, iterations=2)
region = ndi.binary_dilation(fg, iterations=3)
if BGMODE=='white':
    khi, klo = float(opt('--khi','245')), float(opt('--klo','200'))
    edge = np.clip((khi - lum)/max(1.0, khi-klo), 0, 1)      # 1=watch, 0=white bg
elif BGMODE=='dark':
    klo, khi = float(opt('--klo','28')), float(opt('--khi','72'))
    edge = np.clip((lum - klo)/max(1.0, khi-klo), 0, 1)      # 1=watch, 0=dark bg
else:
    edge = fg.astype(float)
a = np.where(core, 1.0, edge) * region
alpha = Image.fromarray((np.clip(a,0,1)*255).astype('uint8'),'L').filter(ImageFilter.GaussianBlur(0.6))
rgba = im.convert('RGBA'); rgba.putalpha(alpha)
nw,nh = round(W*scale),round(H*scale)
rgba = rgba.resize((nw,nh),Image.LANCZOS)
cx2,cy2 = cxc*scale, cyc*scale
g = ground(CW,CH)
g = g.convert('RGBA')
g.alpha_composite(rgba, (round(CW/2-cx2), round(CH/2-cy2)))
g.convert('RGB').save(out_path,'JPEG',quality=92)
print(f'{BGMODE} casew_px={casew_px:.0f} scale={scale:.3f} center=({cxc},{cyc}) -> {out_path}')
