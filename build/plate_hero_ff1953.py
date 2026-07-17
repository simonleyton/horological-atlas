import sys, numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage as ndi
MODE=sys.argv[1]
H_WATCH, CW, CH = 500, 900, 600
BG=np.array([13,17,23],float); LIFT=np.array([233,237,242],float)
def ground(W,H):
    yy,xx=np.mgrid[0:H,0:W]; d=np.sqrt((xx-W*.5)**2+(yy-H*.46)**2)/(W*.62)
    lift=np.clip(1-d,0,1)**1.6*.035
    return Image.fromarray((BG[None,None,:]+(LIFT-BG)[None,None,:]*lift[...,None]).astype('uint8'),'RGB')
src=Image.open('scratchpad-dl/ff1953/phillips-001.jpg').convert('RGB')
crop=src.crop((120,210,1420,1490)); arr=np.asarray(crop,float); lum=arr.mean(2)
H,W=lum.shape
# --- bezel radius from the central BLACK disc (bezel ring + dial) ---
dark=ndi.binary_fill_holes(lum<95)
dl,dn=ndi.label(dark)
cyc,cxc=H//2,W//2
cid=dl[cyc,cxc]
if cid==0:
    sizes=ndi.sum(np.ones_like(dl),dl,range(1,dn+1)); cid=1+int(np.argmax(sizes))
bez=dl==cid
ys,xs=np.where(bez); cy0,cx0=ys.mean(),xs.mean()
Rb=0.5*((xs.max()-xs.min())+(ys.max()-ys.min()))/2   # bezel outer radius
yy,xx=np.mgrid[0:H,0:W]
dist=np.hypot(xx-cx0,yy-cy0); adeg=np.degrees(np.arctan2(yy-cy0,xx-cx0))
def sector(c,h): return np.abs(((adeg-c+180)%360)-180)<h
# full watch silhouette (for lugs/crown pixel presence)
gy,gx=np.gradient(lum); emag=np.hypot(gx,gy)
for c in range(3):
    cyg,cxg=np.gradient(arr[:,:,c]); emag=np.maximum(emag,np.hypot(cxg,cyg))
barrier=ndi.binary_dilation(emag>3.0,iterations=4)
lbl,n=ndi.label(~barrier)
b=(set(lbl[0])|set(lbl[-1])|set(lbl[:,0])|set(lbl[:,-1])); b.discard(0)
watch=ndi.binary_fill_holes(~np.isin(lbl,list(b)))
disc=dist<=Rb*1.055                       # bezel + thin knurled steel rim
crown=(dist>Rb*0.95)&(dist<Rb*1.42)&sector(0,19)&(lum>105)&watch
if MODE=='A':
    clean=disc|crown
else:
    lugs=np.zeros_like(disc)
    for d0 in (-57,-123,57,123):
        lugs|=(dist>Rb*0.98)&(dist<Rb*1.55)&sector(d0,20)&(lum>108)&watch
    clean=disc|crown|lugs
    clean=ndi.binary_closing(clean,iterations=3)
clean=ndi.binary_fill_holes(clean); clean=ndi.binary_opening(clean,iterations=2)
l3,n3=ndi.label(clean)
if n3>1: clean=l3==(1+int(np.argmax(ndi.sum(np.ones_like(l3),l3,range(1,n3+1)))))
alpha=Image.fromarray((clean*255).astype('uint8'),'L').filter(ImageFilter.GaussianBlur(1.5))
r=crop.convert('RGBA'); r.putalpha(alpha); bb=r.getbbox(); r=r.crop(bb)
case_cx=cx0-bb[0]; scale=H_WATCH/r.height; w2,h2=round(r.width*scale),round(r.height*scale)
r=r.resize((w2,h2),Image.LANCZOS); g=ground(CW,CH)
g.paste(r,(round(CW/2-case_cx*scale),round(CH*.5-h2/2)),r)
g.convert('RGB').save(f'scratchpad-dl/ff1953/plated-{MODE}2.jpg','JPEG',quality=90)
print(MODE,'Rb=%.0f'%Rb,'center=(%.0f,%.0f)'%(cx0,cy0))
