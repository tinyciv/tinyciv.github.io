#!/usr/bin/env python3
"""Build the Puny art field guide as one self-contained, offline HTML file."""
from pathlib import Path
import base64
import json
import mimetypes
import struct

ROOT = Path(__file__).resolve().parents[1]
DIRECTORY = ROOT / 'output/puny-world-gallery'


def resolve_path(path, base=DIRECTORY):
    path = Path(path)
    for candidate in (path if path.is_absolute() else ROOT / path, base / path, DIRECTORY / 'generated' / path):
        if candidate.exists():
            return candidate
    raise FileNotFoundError(path)


def embed(path, base=DIRECTORY):
    source = resolve_path(path, base)
    data = source.read_bytes()
    mime = mimetypes.guess_type(source.name)[0] or 'application/octet-stream'
    return 'data:' + mime + ';base64,' + base64.b64encode(data).decode('ascii')


catalog = json.loads((DIRECTORY / 'source-catalog.json').read_text())
for source in catalog['sources']:
    source['path'] = source.get('relativePath', source['path'])
    source['dataUrl'] = embed(source['path'])

generated_file = DIRECTORY / 'generated/manifest.json'
generated = json.loads(generated_file.read_text()) if generated_file.exists() else {'items': []}
if isinstance(generated, list):
    generated = {'items': generated}
if 'items' not in generated:
    generated['items'] = generated.get('assets', generated.get('concepts', []))
for item in generated['items']:
    item['path'] = item.get('path', item.get('sheet', item.get('file')))
    source = resolve_path(item['path'], generated_file.parent)
    item['dataUrl'] = embed(source)
    if source.suffix.lower() == '.png':
        width, height = struct.unpack('>II', source.read_bytes()[16:24])
        item.setdefault('width', width)
        item.setdefault('height', height)
    item.setdefault('columns', 4)
    item.setdefault('rows', 4)
    item.setdefault('frameWidth', item['width'] // item['columns'])
    item.setdefault('frameHeight', item['height'] // item['rows'])
    if not item.get('animations'):
        names = [('idle-south', 'Idle · south'), ('move-south', 'Move · south'), ('move-east', 'Move · east'), ('action-east', 'Action · east')]
        item['animations'] = [
            {'id': animation_id, 'label': label, 'fps': 5, 'frames': [
                {'x': col * item['frameWidth'], 'y': row * item['frameHeight'], 'width': item['frameWidth'], 'height': item['frameHeight']}
                for col in range(item['columns'])]}
            for row, (animation_id, label) in enumerate(names[:item['rows']])
        ]
    if item.get('previewPath'):
        item['previewDataUrl'] = embed(item['previewPath'], generated_file.parent)

farm_file = DIRECTORY / 'farm-structures/manifest.json'
if not farm_file.exists():
    farm_file = DIRECTORY / 'farm-overlays/manifest.json'
farms = json.loads(farm_file.read_text()) if farm_file.exists() else {'items': []}
if isinstance(farms, list):
    farms = {'items': farms}
for item in farms.get('items', []):
    item['path'] = item.get('path', item.get('file'))
    source = resolve_path(item['path'], farm_file.parent)
    item['dataUrl'] = embed(source)
    if source.suffix.lower() == '.png':
        width, height = struct.unpack('>II', source.read_bytes()[16:24])
        item.setdefault('width', width)
        item.setdefault('height', height)
    item.setdefault('tileWidth', item.get('nativeWidth', 32))
    item.setdefault('tileHeight', item.get('nativeHeight', 32))

village_file = DIRECTORY / 'chapels-campfires/manifest.json'
village = json.loads(village_file.read_text()) if village_file.exists() else {'churches': [], 'campfires': [], 'references': []}
for group in ('churches', 'campfires', 'references'):
    village.setdefault(group, [])
    for item in village[group]:
        if item.get('path'):
            source = resolve_path(item['path'], village_file.parent)
            item['dataUrl'] = embed(source)
            if source.suffix.lower() == '.png':
                width, height = struct.unpack('>II', source.read_bytes()[16:24])
                item.setdefault('width', width)
                item.setdefault('height', height)
        elif item.get('sourceId'):
            original = next(source for source in catalog['sources'] if source['id'] == item['sourceId'])
            for key in ('path', 'dataUrl', 'width', 'height'):
                item.setdefault(key, original[key])
        if group == 'campfires':
            item.setdefault('columns', 4)
            item.setdefault('rows', 2)
            item.setdefault('fps', 8)
            if item.get('gifPath'):
                gif_source = resolve_path(item['gifPath'], village_file.parent)
                item['gifDataUrl'] = embed(gif_source)
            if item.get('apngPath'):
                apng_source = resolve_path(item['apngPath'], village_file.parent)
                item['apngDataUrl'] = embed(apng_source)

wooden_file = DIRECTORY / 'wooden-buildings/manifest.json'
wooden = json.loads(wooden_file.read_text()) if wooden_file.exists() else {'items': []}
wooden_sources = []


def embed_wooden_parts(node, identifier):
    if isinstance(node, list):
        for index, part in enumerate(node):
            embed_wooden_parts(part, f'{identifier}-{index}')
    elif isinstance(node, dict):
        if node.get('path'):
            source = resolve_path(node['path'], wooden_file.parent)
            node['imageId'] = identifier
            data_url = embed(source)
            if source.suffix.lower() == '.png':
                width, height = struct.unpack('>II', source.read_bytes()[16:24])
                node.setdefault('width', width)
                node.setdefault('height', height)
            wooden_sources.append({'id': identifier, 'path': node['path'], 'width': node.get('width'), 'height': node.get('height'), 'dataUrl': data_url})
        for key, part in list(node.items()):
            if isinstance(part, (dict, list)):
                embed_wooden_parts(part, f'{identifier}-{key}')


for item in wooden.get('items', []):
    embed_wooden_parts(item, item['id'])
    for kind in ('apng', 'gif'):
        if item.get(f'{kind}Path'):
            item[f'{kind}DataUrl'] = embed(resolve_path(item[f'{kind}Path'], wooden_file.parent))
wooden['sources'] = wooden_sources

payload = json.dumps({'catalog': catalog, 'generated': generated, 'farmOverlays': farms, 'village': village, 'woodenBuildings': wooden}, ensure_ascii=False, separators=(',', ':')).replace('</', '<\\/')
template = (DIRECTORY / 'gallery-template.html').read_text()
if template.count('__GALLERY_DATA__') != 1:
    raise ValueError('Template needs exactly one __GALLERY_DATA__ placeholder')
output = ROOT / 'output/btv-puny-world-gallery.html'
output.write_text(template.replace('__GALLERY_DATA__', payload))
print(f'Built {output.relative_to(ROOT)} ({output.stat().st_size:,} bytes; {len(catalog["sources"])} original sheets, {len(generated["items"])} concepts, {len(farms.get("items", []))} farm parts, {len(village["churches"])} churches, {len(village["campfires"])} campfires, {len(wooden.get("items", []))} wooden building assets)')
