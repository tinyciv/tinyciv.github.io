"""Package approved galley frames and split upright rig from the turning hull."""
from pathlib import Path
from PIL import Image
import json,hashlib
ROOT=Path(__file__).resolve().parents[1]
SOURCE=ROOT/'scratch/2026-11-06-galley-cleanup'
OUT=ROOT/'public/assets/naval'
OUT.mkdir(exist_ok=True)
full=Image.open(SOURCE/'exports/galley-rowing.png').convert('RGBA')
hulls=Image.new('RGBA',full.size);rigs=Image.new('RGBA',(32,128));masks=[]
for row,direction in enumerate('NESW'):
    # Native art cells use four perspectives. These masks lift sail, yard and
    # mast together; the small hidden deck is continued from adjacent columns.
    def is_rig(x,y):
        if direction=='N':return (11<=y<=12 and 9<=x<=22) or (13<=y<=15 and 10<=x<=21) or (y==16 and 10<=x<=20) or (17<=y<=20 and 15<=x<=16)
        if direction=='S':return (14<=y<=15 and 9<=x<=22) or (16<=y<=18 and 10<=x<=22) or (y==19 and 9<=x<=22) or (20<=y<=23 and 15<=x<=16)
        if direction=='W':x=31-x
        return (2<=y<=3 and 8<=x<=23) or (4<=y<=10 and 9<=x<=22) or (0<=y<=15 and 15<=x<=16)
    base=full.crop((0,row*32,32,row*32+32));rig=Image.new('RGBA',(32,32));mask=[]
    for y in range(32):
        for x in range(32):
            if is_rig(x,y) and base.getpixel((x,y))[3]:rig.putpixel((x,y),base.getpixel((x,y)));mask.append(y*32+x)
    rigs.alpha_composite(rig,(0,row*32));masks.append(mask)
    for frame in range(6):
        original=full.crop((frame*32,row*32,frame*32+32,row*32+32));hull=original.copy()
        for pixel in mask:
            x,y=pixel%32,pixel//32
            hull.putpixel((x,y),(0,0,0,0))
            if direction in 'NS' and 11<=x<=20:
                sx=x if x not in (15,16) else (14 if x==15 else 17)
                sy=21 if direction=='N' else 11
                hull.putpixel((x,y),base.getpixel((sx,sy)))
            elif direction in 'EW' and y>=13:
                hull.putpixel((x,y),base.getpixel((13 if x<16 else 18,y)))
        check=hull.copy();check.alpha_composite(rig);assert check.tobytes()==original.tobytes(),(direction,frame)
        hulls.alpha_composite(hull,(frame*32,row*32))
(OUT/'galley.png').write_bytes((SOURCE/'exports/galley-rowing.png').read_bytes())
hulls.save(OUT/'galley-hulls.png');rigs.save(OUT/'galley-rigs.png')
metadata={'selection':'Refined light-wood galley','source':str(SOURCE.relative_to(ROOT)),'cellSize':[32,32],'rows':list('NESW'),'frameCount':6,'frameSeconds':.14,'worldPixelScale':2,'physicalFootprint':[2,1],'pivot':[16,16],'rigAnchors':[[16,20],[16,15],[16,23],[16,15]],'captainFeet':[[16,26],[7,16],[16,10],[24,16]],'rigMasks':masks,'layering':'Hull turns continuously around its center. Leader and rig stay upright, following their projected deck positions. Rig is drawn over Leader. Layers recombine byte-exactly into approved frames at cardinal headings. Hidden deck pixels use adjacent existing wood pixels.','files':[]}
for name in ['galley.png','galley-hulls.png','galley-rigs.png']:
 p=OUT/name;im=Image.open(p);metadata['files'].append({'file':name,'size':im.size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()})
(OUT/'galley-source.json').write_text(json.dumps(metadata,indent=2)+'\n')
print('Packed approved24 galleyframes;all hull+rig layers recombine exactly.')
