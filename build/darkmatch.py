import sys, numpy as np
from PIL import Image
src,out=sys.argv[1],sys.argv[2]
args=sys.argv[3:]
def opt(n,d): return args[args.index(n)+1] if n in args else d
CW,CH=900,600; TARGET=np.array([13,17,23])
im=Image.open(src).convert('RGB'); a=np.asarray(im,np.int16); H,W=a.shape[:2]
c=np.concatenate([a[:24,:24].reshape(-1,3),a[:24,-24:].reshape(-1,3),a[-24:,:24].reshape(-1,3),a[-24:,-24:].reshape(-1,3)])
bg=np.median(c,0); off=(TARGET-bg).astype(np.int16)
sh=np.clip(a+off,0,255).astype('uint8')
img=Image.fromarray(sh)
# optional pre-crop (fractions L,T,R,B) then cover-fit to 900x600
if '--crop' in args:
    l,t,r,b=[float(x) for x in opt('--crop','0,0,1,1').split(',')]
    img=img.crop((int(W*l),int(H*t),int(W*r),int(H*b))); W,H=img.size
scale=float(opt('--scale','1.0'))
# cover-fit
s=max(CW/W,CH/H)*scale
nw,nh=round(W*s),round(H*s)
img=img.resize((nw,nh),Image.LANCZOS)
ox=float(opt('--ox','0.5')); oy=float(opt('--oy','0.5'))
canvas=Image.new('RGB',(CW,CH),tuple(int(v) for v in TARGET))
canvas.paste(img,(round(CW/2-nw*ox),round(CH/2-nh*oy)))
canvas.save(out,'JPEG',quality=92)
print(f"bg{tuple(int(v) for v in bg)} off{tuple(int(v) for v in off)} -> {out}")
