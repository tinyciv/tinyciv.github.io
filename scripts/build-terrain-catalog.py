"""Embed the researched original previews into one offline HTML file."""
import base64
import json
import hashlib
from pathlib import Path
from PIL import Image

PROJECT = Path(__file__).resolve().parent.parent
ROOT = PROJECT / 'output' / 'terrain-catalog'
entries = []
seen = set()
raw = []
for source in ['local.json', 'kenney-oga.json', 'itch.json', 'games.json']:
    raw.extend(json.loads((ROOT / source).read_text()))
# Puny World is mirrored on OpenGameArt and itch; count it as one collection.
mirror = next(e for e in raw if e['id'] == 'koa-oga-16x16-puny-world-tileset')
primary = next(e for e in raw if e['id'] == 'itch-puny')
primary['alternateSources'] = [mirror['url']]
primary['images'].extend(mirror['images'])
raw.remove(mirror)
for entry in raw:
    if entry['id'] in seen:
        raise ValueError('Duplicate catalog id: ' + entry['id'])
    seen.add(entry['id'])
    unique_images = []
    hashes = set()
    for image in entry['images']:
        path = Path(image['path'])
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        if digest in hashes:
            continue
        hashes.add(digest)
        with Image.open(path) as im:
            image['width'], image['height'] = im.size
            mime = Image.MIME.get(im.format, 'image/png')
            im.verify()
        image['data'] = f'data:{mime};base64,' + base64.b64encode(path.read_bytes()).decode()
        unique_images.append(image)
    entry['images'] = unique_images
    if not entry['images']:
        raise ValueError('Missing preview: ' + entry['title'])
    entries.append(entry)
payload = json.dumps(entries, ensure_ascii=False, separators=(',', ':')).replace('<', '\\u003c')
html = (ROOT / 'gallery-template.html').read_text().replace('__CATALOG_JSON__', payload)
dest = PROJECT / 'output' / 'btv-terrain-comparison.html'
dest.write_text(html)
# Lightweight source index remains useful outside the embedded gallery.
index = [{**e, 'images': [{k: v for k, v in im.items() if k != 'data'} for im in e['images']]} for e in entries]
(ROOT / 'catalog.json').write_text(json.dumps(index, ensure_ascii=False, indent=2))
print(f'{len(entries)} collections, {sum(len(e["images"]) for e in entries)} images, {dest.stat().st_size / 1024 / 1024:.1f} MiB')
print(dest)
