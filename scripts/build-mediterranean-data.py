"""Rebuild the checked-in Mediterranean geographic layers.
See dev/mediterranean-map/README.md for source provenance and dependencies.
"""
from pathlib import Path
import csv
import hashlib
import io
import json
import math
import zipfile

import h5netcdf
import numpy as np
import openpyxl
from PIL import Image, ImageDraw
from scipy.ndimage import distance_transform_edt, gaussian_filter, map_coordinates
from scipy.spatial import cKDTree

REPO = Path(__file__).resolve().parents[1]
ROOT = REPO / 'scratch/2026-11-04-mediterranean-integration/data'
SRC = REPO / 'scratch/2026-11-04-mediterranean-200bc/source'
WEST, EAST, SOUTH, NORTH = -12., 42., 27., 49.
STANDARD_PARALLEL = 38.
WIDTH = 864
HEIGHT = round(WIDTH * (NORTH-SOUTH) / ((EAST-WEST)*math.cos(math.radians(STANDARD_PARALLEL))))
COLORS = np.array([
    [24, 67, 83], [56, 115, 126], [67, 104, 64], [117, 139, 75],
    [166, 160, 98], [191, 171, 118], [218, 192, 139], [145, 150, 133],
    [97, 143, 101],
], dtype=np.uint8)
CLASSES = ['sea', 'lake', 'woodland', 'open_woodland', 'scrub_grassland',
           'dry_steppe', 'desert', 'alpine', 'riverine_mosaic']
GAME_COLORS = np.array([[3,138,171],[43,196,169],[63,102,49],[133,166,67],
                       [201,178,102],[201,178,102],[201,178,102],[133,166,67],[133,166,67]],dtype=np.uint8)


def load_geo(name):
    return json.loads((SRC/name).read_text())['features']


def in_bounds(coords):
    a = np.asarray(coords)
    return (a[:, 0].max() >= WEST and a[:, 0].min() <= EAST
            and a[:, 1].max() >= SOUTH and a[:, 1].min() <= NORTH)


def xy(coords, w, h):
    return [((p[0]-WEST)/(EAST-WEST)*w, (NORTH-p[1])/(NORTH-SOUTH)*h) for p in coords]


def polygon_mask(features, w, h, lakes=False):
    # Supersampling reduces fill-rounding effects at tiny islands and coasts.
    scale = 4
    image = Image.new('L', (w*scale, h*scale))
    draw = ImageDraw.Draw(image)
    for feature in features:
        if lakes and feature['properties'].get('featurecla') not in ('Lake', 'Alkaline Lake'):
            continue  # exclude explicitly identified modern reservoirs
        g = feature['geometry']
        polygons = [g['coordinates']] if g['type'] == 'Polygon' else g['coordinates']
        for rings in polygons:
            if not in_bounds(rings[0]):
                continue
            draw.polygon(xy(rings[0], w*scale, h*scale), fill=255)
            for hole in rings[1:]:
                draw.polygon(xy(hole, w*scale, h*scale), fill=0)
    return np.asarray(image.resize((w, h), Image.Resampling.BOX)) >= 128


def read_pollen():
    workbook = openpyxl.load_workbook(SRC/'GC_quality_by_TW.xlsx', read_only=True, data_only=True)
    values = iter(workbook['GC_quality_by_TW'].values)
    header = next(values)
    quality_col = header.index('1700-2200')
    quality = {str(row[0]): row[quality_col] for row in values}
    workbook.close()
    with zipfile.ZipFile(SRC/'LANDCLIMII.RV.results.JUN2021.zip') as z:
        def rows(name):
            return list(csv.DictReader(io.StringIO(z.read(name).decode('utf-8-sig'))))
        estimates = rows('LANDCLIMII.RV.means.JUN2021/TW6.RV.estimates.jun21.csv')
        errors = {r['LCGRID_ID']: r for r in rows('LANDCLIMII.RV.standarderrors.JUN2021/TW6.RV.standarderrors.jun21.csv')}
    result = []
    for r in estimates:
        if r['lonDD'] == '#N/A' or r['latDD'] == '#N/A':
            continue
        lon, lat = float(r['lonDD']), float(r['latDD'])
        q = quality.get(r['LCGRID_ID'])
        if q not in (1, 2):
            continue
        total = sum(float(r[k]) for k in ['ET', 'ST', 'OL'])
        assert abs(total-100) < .001, (r['LCGRID_ID'], total)
        # Buffer supplies nearby constraints beyond the edge without truncation artifacts.
        if not WEST-4 <= lon <= EAST+4 or not SOUTH-4 <= lat <= NORTH+4:
            continue
        result.append(dict(id=int(r['LCGRID_ID']), longitude=lon, latitude=lat, quality=int(q),
                           **{k:float(r[k])/100 for k in ['ET','ST','OL','AL']},
                           **{k+'_se':float(errors[r['LCGRID_ID']][k])/100 for k in ['ET','ST','OL','AL']}))
    return result


def gaussian(lon, lat, x, y, sx, sy):
    return np.exp(-.5*(((lon-x)/sx)**2+((lat-y)/sy)**2))


def prior(lon, lat, elevation, distance_sea):
    """Authored broad ecological prior, deliberately explicit and reproducible."""
    # Wet northern woodlands to dry southern/eastern interiors; broad gradients.
    moisture = .20 + .66/(1+np.exp(-(lat-38)/2.0))
    moisture += .15*np.exp(-distance_sea/100)
    moisture -= .18*gaussian(lon,lat,-3,39.5,3,1.7)  # Iberian interior
    moisture -= .28*gaussian(lon,lat,33,39,3.5,2)    # Anatolian interior
    moisture -= .37*gaussian(lon,lat,40,32,5,3.5)*(1-.8*np.exp(-distance_sea/75))  # Syrian interior; retain coastal moisture
    moisture -= .27*gaussian(lon,lat,18,30,15,2.8)   # Sahara
    moisture += .24*gaussian(lon,lat,-3,34,5,1.5)   # Atlas belt
    moisture += .20*gaussian(lon,lat,21.5,32.4,1.4,.65)  # Cyrenaican uplands
    moisture += .22*gaussian(lon,lat,35.6,33.7,.8,2.4)   # Levant coast
    moisture += .08*np.clip(elevation/1500,0,1)
    moisture = np.clip(moisture, .035, .95)
    woody = np.clip((moisture-.18)*.95, .015, .78)
    woody *= np.clip((2900-elevation)/900, .02, 1)  # approximate treeline prior
    return moisture, woody


def river_mask(features, w, h):
    image = Image.new('L', (w,h))
    draw = ImageDraw.Draw(image)
    for f in features:
        p=f['properties']
        if p.get('featurecla') != 'River' or float(p.get('scalerank',10)) > 5:
            continue
        g=f['geometry']
        lines=[g['coordinates']] if g['type']=='LineString' else g['coordinates']
        for line in lines:
            if in_bounds(line):
                draw.line(xy(line,w,h),fill=255,width=1)
    return np.asarray(image)>0


def prepare():
    lon1 = WEST+(np.arange(WIDTH)+.5)*(EAST-WEST)/WIDTH
    lat1 = NORTH-(np.arange(HEIGHT)+.5)*(NORTH-SOUTH)/HEIGHT
    lon,lat = np.meshgrid(lon1,lat1)
    with h5netcdf.File(SRC/'earth_relief_06m_p.grd') as f:
        x,y=f['lon'][:],f['lat'][:]
        z=f['z'][:].astype(float)*float(f['z'].attrs['scale_factor'])
        elevation=map_coordinates(z,[(lat-y[0])/(y[1]-y[0]),(lon-x[0])/(x[1]-x[0])],order=1,mode='nearest')
    land=polygon_mask(load_geo('ne_10m_land.geojson'),WIDTH,HEIGHT)
    lakes=polygon_mask(load_geo('ne_10m_lakes.geojson'),WIDTH,HEIGHT,lakes=True)&land
    land &= ~lakes
    km_x=(EAST-WEST)*111.2*math.cos(math.radians(STANDARD_PARALLEL))/WIDTH
    km_y=(NORTH-SOUTH)*111.2/HEIGHT
    distance_sea=distance_transform_edt(land|lakes,sampling=(km_y,km_x))
    moisture,woody_prior=prior(lon,lat,elevation,distance_sea)
    records=read_pollen()
    points=np.array([[r['longitude'],r['latitude']] for r in records])
    px=np.clip((points[:,0]-WEST)/(EAST-WEST)*WIDTH-.5,0,WIDTH-1)
    py=np.clip((NORTH-points[:,1])/(NORTH-SOUTH)*HEIGHT-.5,0,HEIGHT-1)
    pz=map_coordinates(z,[(points[:,1]-y[0])/(y[1]-y[0]),(points[:,0]-x[0])/(x[1]-x[0])],order=1)
    ps=map_coordinates(distance_sea,[py,px],order=1)
    _,pprior=prior(points[:,0],points[:,1],pz,ps)
    pwood=np.array([r['ET']+r['ST'] for r in records])
    # Interpolate departures from broad ecology, rather than forests across deserts.
    metric=np.array([111.2*math.cos(math.radians(STANDARD_PARALLEL)),111.2])
    tree=cKDTree(points*metric)
    dist,ids=tree.query(np.column_stack([lon.ravel(),lat.ravel()])*metric,k=12)
    quality=np.array([1 if r['quality']==1 else .45 for r in records])
    weights=np.exp(-.5*(dist/140)**2)*quality[ids]
    weights[dist>350]=0
    residual=(weights*(pwood-pprior)[ids]).sum(axis=1)/np.maximum(weights.sum(axis=1),1e-9)
    influence=.8*np.exp(-.5*(dist[:,0]/180)**2)
    woody=np.clip(woody_prior+residual.reshape(lat.shape)*influence.reshape(lat.shape),0,.95)
    # Suppress imported forest in ecologically very dry/alpine areas.
    woody=np.minimum(woody,np.clip((moisture-.04)*2,0,.95))
    woody*=np.clip((3100-elevation)/1000,0,1)
    support=np.zeros(lon.shape,np.uint8)
    raw_woody=np.full(lon.shape,np.nan,np.float32)
    features=[]
    for r in records:
        x0,y0=r['longitude']-.5,r['latitude']-.5
        mask=(lon>=x0)&(lon<x0+1)&(lat>=y0)&(lat<y0+1)&land
        support[mask]=r['quality']; raw_woody[mask]=r['ET']+r['ST']
        if WEST<=r['longitude']<EAST and SOUTH<=r['latitude']<NORTH:
            features.append(dict(type='Feature',properties=r,geometry=dict(type='Polygon',coordinates=[[[x0,y0],[x0+1,y0],[x0+1,y0+1],[x0,y0+1],[x0,y0]]])))
    (ROOT/'pollen-cells.geojson').write_text(json.dumps(dict(type='FeatureCollection',features=features),indent=2)+'\n')
    rivers=river_mask(load_geo('ne_10m_rivers_lake_centerlines.geojson'),WIDTH,HEIGHT)&land
    river_distance=distance_transform_edt(~rivers,sampling=(km_y,km_x))
    # A narrow corridor is a landscape proxy, not reconstructed field boundaries.
    riverine=(river_distance<9)&(elevation<450)&land
    # Explicit broad Nile delta prior (its ancient branches are not traced).
    delta=gaussian(lon,lat,31.1,30.8,1.0,.65)>.36
    riverine|=delta&land&(elevation<160)
    rng=np.random.default_rng(200)
    texture=gaussian_filter(rng.standard_normal(lon.shape),2.4)
    texture=texture/max(texture.std(),1e-9)
    # Scale patch variation down in deserts; random texture must not invent oases.
    patch=np.clip(woody+texture*.105*(.2+.8*np.minimum(woody/.4,1)),0,1)
    classes=np.full(lon.shape,4,np.uint8)
    classes[(moisture<.37)&(patch<.25)]=5
    classes[(moisture<.19)&(patch<.12)]=6
    classes[patch>=.30]=3
    classes[patch>=.57]=2
    classes[elevation>2200]=7
    classes[riverine]=8
    classes[~land]=0; classes[lakes]=1
    return dict(longitude=lon1,latitude=lat1,elevation_m=elevation.astype(np.float32),land=land,lakes=lakes,
                moisture_prior=moisture.astype(np.float32),woody_fraction=woody.astype(np.float32),
                pollen_woody_fraction=raw_woody,pollen_quality=support,landscape_class=classes,
                rivers=rivers,records=records,riverine=riverine,km_x=km_x,km_y=km_y)


def simplify(points, tolerance=.025):
    if len(points)<3: return points
    a,b=np.asarray(points[0]),np.asarray(points[-1]);v=b-a
    intermediate=np.asarray(points[1:-1]);length=float(v@v)
    t=np.clip(((intermediate-a)@v)/length,0,1) if length else np.zeros(len(intermediate))
    distance=np.linalg.norm(intermediate-(a+t[:,None]*v),axis=1)
    k=int(distance.argmax())+1
    if distance[k-1]<=tolerance:return [points[0],points[-1]]
    return simplify(points[:k+1],tolerance)[:-1]+simplify(points[k:],tolerance)


def clip_segment(a,b):
    dx,dy=b[0]-a[0],b[1]-a[1];lo,hi=0.,1.
    for p,q in [(-dx,a[0]-WEST),(dx,EAST-a[0]),(-dy,a[1]-SOUTH),(dy,NORTH-a[1])]:
        if p==0:
            if q<0:return None
        elif p<0:lo=max(lo,q/p)
        else:hi=min(hi,q/p)
    if lo>hi:return None
    return [[a[0]+lo*dx,a[1]+lo*dy],[a[0]+hi*dx,a[1]+hi*dy]]


def river_lines():
    rivers=[]
    for feature in load_geo('ne_10m_rivers_lake_centerlines.geojson'):
        prop=feature['properties'];rank=float(prop.get('scalerank',10))
        if prop.get('featurecla') not in ('River','Lake Centerline') or rank>8:continue
        geo=feature['geometry'];lines=[geo['coordinates']] if geo['type']=='LineString' else geo['coordinates']
        for line in lines:
            if not in_bounds(line):continue
            chunks=[];current=[]
            for a,b in zip(line,line[1:]):
                clipped=clip_segment(a,b)
                if clipped:
                    if current and np.linalg.norm(np.array(current[-1])-clipped[0])>1e-6:
                        chunks.append(current);current=[]
                    if not current:current.append(clipped[0])
                    current.append(clipped[1])
                elif current:chunks.append(current);current=[]
            if current:chunks.append(current)
            for chunk in chunks:
                points=[[round(x,4),round(y,4)] for x,y in simplify(chunk)]
                if len(points)<2:continue
                rivers.append(dict(name=prop.get('name_en') or prop.get('name') or 'Unnamed tributary',rank=rank,points=points))
    return sorted(rivers,key=lambda r:(r['rank'],r['name'],r['points'][0]))


def main():
    import argparse
    import urllib.request
    global SRC
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-dir',type=Path,default=SRC)
    parser.add_argument('--download',action='store_true',help='Download missing public source files and verify pinned SHA-256 hashes.')
    args=parser.parse_args();SRC=args.source_dir
    ROOT.mkdir(parents=True,exist_ok=True);SRC.mkdir(parents=True,exist_ok=True)
    sources=json.loads((REPO/'dev/mediterranean-map/sources.json').read_text())
    for name,source in sources.items():
        path=SRC/name
        if not path.exists() and args.download:urllib.request.urlretrieve(source['url'],path)
        if not path.exists():raise FileNotFoundError(f'{path}: supply --source-dir or --download')
        if hashlib.sha256(path.read_bytes()).hexdigest()!=source['sha256']:raise ValueError(f'Source checksum mismatch: {name}')
    data=prepare();w,h=384,199
    xs=np.minimum(((np.arange(w)+.5)*WIDTH/w).astype(int),WIDTH-1)
    ys=np.minimum(((np.arange(h)+.5)*HEIGHT/h).astype(int),HEIGHT-1)
    sample=lambda a:a[ys[:,None],xs]
    classes=sample(data['landscape_class']).copy()
    # Preserve narrow navigable straits when the raster becomes coarser than them.
    for points in [[(-6,35.9),(-5.6,35.95),(-5.4,35.98),(-5.1,35.95)],
                   [(26,39.9),(26.2,40),(26.4,40.18),(26.7,40.4),(27,40.5)],
                   [(28.9,40.8),(29,41),(29.1,41.15),(29.15,41.3),(29.3,41.4)]]:
        for a,b in zip(points,points[1:]):
            x,y=int((a[0]-WEST)/(EAST-WEST)*w),int((NORTH-a[1])/(NORTH-SOUTH)*h)
            tx,ty=int((b[0]-WEST)/(EAST-WEST)*w),int((NORTH-b[1])/(NORTH-SOUTH)*h)
            classes[y,x]=0
            while (x,y)!=(tx,ty):
                if x!=tx:x+=1 if tx>x else -1;classes[y,x]=0
                if y!=ty:y+=1 if ty>y else -1;classes[y,x]=0
    rows=lambda a:[''.join(format(int(v),'x') for v in row) for row in a]
    packed=dict(width=w,height=h,bounds=dict(west=WEST,east=EAST,south=SOUTH,north=NORTH),
                classRows=rows(classes),elevationRows=(np.rint(sample(data['elevation_m'])/25)*25).astype(int).tolist(),
                woodyRows=rows(np.rint(sample(data['woody_fraction'])*15)),
                moistureRows=rows(np.rint(sample(data['moisture_prior'])*15)),rivers=river_lines())
    target=REPO/'src/world/data/mediterranean-data.ts'
    header='''// Generated by scripts/build-mediterranean-data.py. Do not hand-edit.
// Geographic sources, temporal limits, inference and attribution: dev/mediterranean-map/README.md.
export interface MediterraneanData {
  width: number; height: number;
  bounds: { west: number; east: number; south: number; north: number };
  classRows: string[]; elevationRows: number[][]; woodyRows: string[]; moistureRows: string[];
  rivers: { name: string; rank: number; points: [number, number][] }[];
}
export const MEDITERRANEAN_DATA: MediterraneanData = '''
    # One row per line avoids a giant unreviewable single line without bloating numbers.
    text=json.dumps(packed,separators=(',',':')).replace('],[','],\n[').replace('","','",\n"')
    target.write_text(header+text+';\n')
    print(f'Wrote {w}x{h} cells and {len(packed["rivers"])} river sections to {target} ({target.stat().st_size:,} bytes)')


if __name__=='__main__':main()

