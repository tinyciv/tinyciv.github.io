"""Render browser maps from prepared terrain and entity data, without a game run."""
from pathlib import Path
import base64
import gzip
import json
import struct
import sys
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
FLOAT_FIELDS = {'elevation', 'moisture', 'temperature', 'rainfall', 'fertility', 'flow', 'rockResistance', 'sediment', 'variation', 'channelWidth'}
COLORS = {'ocean': '#038aab', 'coast': '#2bc4a9', 'river': '#2bc4a9', 'lake': '#2bc4a9', 'grassland': '#85a643', 'plains': '#c4b253', 'desert': '#c9b266', 'tundra': '#94a99d'}
SIZES = {'palace': (2, 2), 'shipyard': (3, 3), 'library': (2, 2), 'whalingPost': (2, 2), 'fort': (3, 3), 'granary': (2, 2), 'forum': (2, 2), 'colosseum': (2, 2)}


def tiles(saved):
    for chunk in saved['terrain']:
        numbers = memoryview(base64.b64decode(chunk['tileFloats']))
        cursor = 0
        for row in chunk['tiles']:
            tile = {}
            values = iter(row[1:])
            for key in chunk['tileSchemas'][row[0]]:
                if key in FLOAT_FIELDS:
                    tile[key] = struct.unpack_from('<d', numbers, cursor)[0]
                    cursor += 8
                else:
                    tile[key] = next(values)
            yield tile


def is_cliff(terrain, cell, width, height):
    tile = terrain[cell]
    if tile.get('waterfall'):
        return True
    ridge = tile.get('ridge')
    if not ridge or tile.get('stair'):
        return False
    tier = tile.get('ridgeTier', 1)
    x, y = cell % width, cell // width
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            if not (dx or dy):
                continue
            nx, ny = x + dx, y + dy
            if not (0 <= nx < width and 0 <= ny < height):
                return True
            neighbor = terrain[ny * width + nx]
            if neighbor.get('ridge') != ridge or neighbor.get('ridgeTier', 1) < tier:
                return True
    return False


def render(scenario):
    saved = json.loads(gzip.decompress((ROOT / 'public/scenarios' / f'{scenario}.json.gz').read_bytes()))
    state = saved['state']
    world = state['world']
    width, height = world['width'], world['height']
    scale = max(3, min(10, 1200 // width))
    image = Image.new('RGB', (width, height))
    terrain = list(tiles(saved))
    for index, tile in enumerate(terrain):
        color = COLORS.get(tile['terrain'], '#849858')
        if is_cliff(terrain, index, width, height):
            color = '#807d73'
        elif tile.get('overlay') in {'forest', 'jungle'}:
            color = '#446647'
        elif tile.get('marsh'):
            color = '#598b7c'
        image.putpixel((index % width, index // width), tuple(bytes.fromhex(color[1:])))
    image = image.resize((width * scale, height * scale), Image.Resampling.NEAREST)
    draw = ImageDraw.Draw(image)
    factions = {faction['id']: faction['color'] for faction in state['factions']}
    for building in state['buildings']:
        if building.get('hp', 0) <= 0:
            continue
        x, y = building['x'] * scale, building['y'] * scale
        w, h = SIZES.get(building['kind'], (1, 1))
        color = factions.get(building['faction'], '#ad8a54')
        if building['kind'] in {'house', 'camp', 'shack', 'cottage'}:
            color = '#b69663' if building['kind'] != 'house' else color
        if building['kind'] in {'road', 'bridge', 'irrigation'}:
            color = '#bea579' if building['kind'] != 'irrigation' else '#3b8b95'
        draw.rectangle((x, y, x + w * scale - 1, y + h * scale - 1), fill=color)
    for building in state['buildings']:
        if building['kind'] == 'palace' and building.get('hp', 0) > 0:
            x, y = (building['x'] + 1) * scale, (building['y'] + 1) * scale
            radius = max(4, scale)
            draw.ellipse((x - radius - 2, y - radius - 2, x + radius + 2, y + radius + 2), fill='#2c261b')
            draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=factions[building['faction']], outline='#ffe5a0', width=max(1, scale // 3))
    for unit in state['units']:
        if unit.get('warship') and unit.get('hp', 0) > 0:
            x, y = unit['x'] * scale, unit['y'] * scale
            radius = max(3, scale // 2)
            draw.polygon([(x - radius, y), (x, y - radius), (x + radius, y), (x, y + radius)], fill=factions[unit['faction']], outline='#ffe5a0')
    destination = ROOT / 'public/scenarios' / f'{scenario}-map.png'
    image.save(destination, optimize=True)
    print(f'Rendered {destination.relative_to(ROOT)} ({image.width}×{image.height})')


if __name__ == '__main__':
    ids = sys.argv[1:] or [path.name[:-8] for path in sorted((ROOT / 'public/scenarios').glob('*.json.gz'))]
    for scenario in ids:
        render(scenario)
