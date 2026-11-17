# Usage (Pillow + numpy): python3 apps/gathering-mobile/scripts/generate-brand-assets.py [store-output-dir]
from pathlib import Path
import sys

from PIL import Image
import numpy as np

NAVY = (19, 15, 45)
OUT = Path(__file__).resolve().parent.parent / 'assets'
STORE_OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('./store-assets-out')
STORE_OUT.mkdir(parents=True, exist_ok=True)
src = Image.open(OUT / 'brand/jci-korea-logo-source.png').convert('RGB')
a = np.asarray(src).copy()
fg=np.abs(a.astype(int)-np.array(NAVY)).sum(2)>60
noTM=a.copy(); noTM[1750:1860,3165:3340]=NAVY   # erase TM
mark=Image.fromarray(noTM).crop((430,905,3180,2064))       # JCI + shield only
shield=Image.fromarray(fg[905:2064,2252:3180].astype(np.uint8)*255,'L')

def place(img,W,H,w=None,h=None,bg=NAVY,dy=0):
    r=img.width/img.height
    if w is None: w=int(h*r)
    h=int(w/r); c=Image.new('RGB',(W,H),bg)
    c.paste(img.resize((w,h),Image.LANCZOS),((W-w)//2,(H-h)//2+dy)); return c

icon=place(mark,1024,1024,w=760)                 # A: JCI + shield
icon.save(OUT / 'icon.png')
# adaptive foreground: safe zone circle d=61% of 1024 (=626px); mark diag<=600
r=mark.width/mark.height; w=int(600/np.sqrt(1+1/r**2))
adapt=place(mark,1024,1024,w=w); adapt.save(f'{OUT}/adaptive-icon.png')
splash=place(mark,1024,1024,w=760); splash.save(f'{OUT}/splash-icon.png')
# notification: white shield on transparent, 96x96
m=shield.resize((int(84*shield.width/shield.height),84),Image.LANCZOS)
n=Image.new('RGBA',(96,96),(0,0,0,0)); wht=Image.new('RGBA',m.size,(255,255,255,255))
n.paste(wht,((96-m.width)//2,6),m); n.save(f'{OUT}/notification-icon.png')
place(mark,1024,500,w=640).save(STORE_OUT / 'feature-graphic-1024x500.png')
icon.resize((512,512),Image.LANCZOS).save(STORE_OUT / 'play-icon-512.png')

