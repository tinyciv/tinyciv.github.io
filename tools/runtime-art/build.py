#!/usr/bin/env python3
"""Build compact, losslessly encoded runtime derivatives of the original art.

Original artwork stays in public/assets for authoring. Profiles specify the few
oversized images that need a crop/native raster/resize. Other bitmaps retain
their pixels and dimensions and are redirected only when encoding is smaller.
Native PNGs with partial alpha stay PNG so browser Canvas decoding is stable.
"""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import io
import json
from pathlib import Path
import shutil
import struct
import subprocess
import tempfile
import zlib

ROOT = Path(__file__).resolve().parents[2]
PUBLIC = ROOT / 'public'
HERE = Path(__file__).resolve().parent
MANIFEST = HERE / 'manifest.json'
URLS = ROOT / 'src/generated/runtime-art.json'
VERSION = 2


def partial_alpha_png(source: Path) -> bool:
    if source.suffix.lower() != '.png':
        return False
    from PIL import Image
    with Image.open(source) as image:
        return any(image.convert('RGBA').getchannel('A').histogram()[1:255])


def png_chunks(data: bytes) -> list[tuple[bytes, bytes, bytes]]:
    if not data.startswith(b'\x89PNG\r\n\x1a\n'):
        raise ValueError('Expected PNG artwork')
    chunks, offset = [], 8
    while offset < len(data):
        length = struct.unpack_from('>I', data, offset)[0]
        end = offset + length + 12
        chunks.append((data[offset + 4:offset + 8], data[offset + 8:end - 4], data[offset:end]))
        offset = end
    return chunks


def optimize_png(source: Path, destination: Path) -> None:
    """Change only IDAT compression; keep all original color/metadata chunks."""
    from PIL import Image
    original = source.read_bytes()
    chunks = png_chunks(original)
    header = next(payload for kind, payload, _ in chunks if kind == b'IHDR')
    source_idat = b''.join(payload for kind, payload, _ in chunks if kind == b'IDAT')
    candidates = [zlib.compress(zlib.decompress(source_idat), level=9)]
    with Image.open(source) as image:
        encoded = io.BytesIO()
        image.save(encoded, format='PNG', optimize=True, compress_level=9)
    optimized = png_chunks(encoded.getvalue())
    # Pillow may choose a different PNG storage layout. Reuse its filtered
    # scanlines only when the unchanged source IHDR describes them exactly.
    if next(payload for kind, payload, _ in optimized if kind == b'IHDR') == header:
        candidates.append(b''.join(payload for kind, payload, _ in optimized if kind == b'IDAT'))
    smallest = original
    for idat in candidates:
        crc = zlib.crc32(b'IDAT' + idat) & 0xffffffff
        replacement = struct.pack('>I', len(idat)) + b'IDAT' + idat + struct.pack('>I', crc)
        result, inserted = [original[:8]], False
        for kind, _, raw in chunks:
            if kind == b'IDAT':
                if not inserted:
                    result.append(replacement)
                    inserted = True
            else:
                result.append(raw)
        candidate = b''.join(result)
        if len(candidate) < len(smallest):
            smallest = candidate
    destination.write_bytes(smallest)


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_json(path: Path, value) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2) + '\n')


def profiles() -> list[dict]:
    records = []
    for path in sorted(HERE.glob('*.json')):
        if path.name == MANIFEST.name:
            continue
        value = json.loads(path.read_text())
        if isinstance(value, list):
            records.extend(value)
    return records


def fingerprint(profile: dict) -> str:
    parts = [str(VERSION), json.dumps(profile, sort_keys=True), digest(PUBLIC / profile['source'])]
    if profile.get('transform'):
        parts.append(digest(HERE / (profile['transform'].removesuffix('-atlas') + '.mjs')))
    if profile.get('transform') == 'relief-atlas':
        parts.append(digest(ROOT / 'src/game/relief-shapes.json'))
    return hashlib.sha256('\n'.join(parts).encode()).hexdigest()


def check() -> None:
    manifest = json.loads(MANIFEST.read_text())
    configured = {p['output']: p for p in profiles()}
    aliases = {}
    for entry in manifest['files']:
        source, output = PUBLIC / entry['source'], PUBLIC / entry['output']
        profile = configured.pop(entry['output'], {'source': entry['source'], 'output': entry['output']})
        if fingerprint(profile) != entry['fingerprint']:
            raise SystemExit(f'Stale runtime artwork: {entry["source"]}; run npm run build:art')
        if not output.is_file() or digest(output) != entry['sha256']:
            raise SystemExit(f'Missing or changed runtime artwork: {entry["output"]}')
        if entry['alias']:
            aliases[entry['source']] = entry['output']
    if configured:
        raise SystemExit(f'Unbuilt artwork profiles: {", ".join(configured)}')
    if json.loads(URLS.read_text()) != dict(sorted(aliases.items())):
        raise SystemExit('Runtime artwork URL map is stale')
    print(f'Runtime artwork verified: {len(manifest["files"])} derivatives, {manifest["outputBytes"]:,} bytes.')


def build(jobs: int, force: bool) -> None:
    from PIL import Image

    encoder = shutil.which('cwebp')
    if not encoder:
        raise SystemExit('Install the WebP tools (cwebp) to rebuild runtime art.')
    specified = profiles()
    outputs = [p['output'] for p in specified]
    if len(outputs) != len(set(outputs)):
        raise SystemExit('Runtime artwork profiles must have unique output paths.')
    configured_sources = {p['source'] for p in specified}
    # Native sprite sheets are already sized for the game. Do not resample them.
    automatic = []
    for source in sorted((PUBLIC / 'assets').rglob('*')):
        if not source.is_file() or 'runtime' in source.relative_to(PUBLIC / 'assets').parts:
            continue
        if source.suffix.lower() not in {'.png', '.webp', '.jpg', '.jpeg'}:
            continue
        key = source.relative_to(PUBLIC).as_posix()
        if key in configured_sources:
            continue
        extension = '.png' if partial_alpha_png(source) else '.webp'
        output = (Path('assets/runtime') / source.relative_to(PUBLIC / 'assets')).with_suffix(extension).as_posix()
        if output not in outputs:
            automatic.append({'source': key, 'output': output})
    old_entries = {e['output']: e for e in json.loads(MANIFEST.read_text())['files']} if MANIFEST.exists() else {}
    previous = {} if force else old_entries

    def encode(item: tuple[dict, bool]) -> dict | None:
        profile, explicit = item
        source, output = PUBLIC / profile['source'], PUBLIC / profile['output']
        stamp = fingerprint(profile)
        old = previous.get(profile['output'])
        if old and old['fingerprint'] == stamp and output.is_file() and digest(output) == old['sha256']:
            return old
        with Image.open(source) as original:
            if getattr(original, 'n_frames', 1) != 1:
                raise ValueError(f'Animated files require a dedicated profile: {source}')
            source_size = list(original.size)
            reference = original.convert('RGBA')
        requested_size = (profile.get('width', source_size[0]), profile.get('height', source_size[1]))
        untouched = not profile.get('transform') and 'crop' not in profile and requested_size == tuple(source_size)
        keep_png = untouched and partial_alpha_png(source)
        if keep_png and output.suffix.lower() != '.png':
            raise ValueError(f'Unchanged PNG artwork with partial alpha must keep PNG output: {profile["source"]}')
        with tempfile.TemporaryDirectory(prefix='tinyciv-art-') as scratch:
            scratch = Path(scratch)
            intermediate, encoded = scratch / 'pixels.png', scratch / ('encoded.png' if keep_png else 'encoded.webp')
            if keep_png:
                optimize_png(source, encoded)
            elif profile.get('transform'):
                transform = profile['transform'].removesuffix('-atlas')
                extra = profile.get('family', profile.get('style'))
                subprocess.run(['node', str(HERE / f'{transform}.mjs'), str(source), str(intermediate), str(extra)],
                               check=True, cwd=ROOT, capture_output=True)
                with Image.open(intermediate) as baked:
                    reference = baked.convert('RGBA')
            else:
                if 'crop' in profile:
                    x, y, width, height = profile['crop']
                    reference = reference.crop((x, y, x + width, y + height))
                size = (profile.get('width', reference.width), profile.get('height', reference.height))
                if size != reference.size:
                    resample = Image.Resampling.NEAREST if profile.get('resample') == 'nearest' else Image.Resampling.LANCZOS
                    reference = reference.resize(size, resample)
                reference.save(intermediate, optimize=True)
            if not keep_png:
                subprocess.run([encoder, '-quiet', '-lossless', '-exact', '-m', '6', '-q', '100',
                                str(intermediate), '-o', str(encoded)], check=True, capture_output=True)
            # An existing WebP may already be a better lossless/visually encoded
            # representation. Reuse its bytes if no pixel transformation occurs.
            if untouched and source.suffix.lower() == '.webp' and source.stat().st_size < encoded.stat().st_size:
                shutil.copy2(source, encoded)
            with Image.open(encoded) as image:
                if image.size != reference.size or image.convert('RGBA').tobytes() != reference.tobytes():
                    raise ValueError(f'Lossless pixel verification failed: {profile["source"]}')
            if not explicit and encoded.stat().st_size >= source.stat().st_size:
                return None
            output.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(encoded, output)
        entry = {'source': profile['source'], 'output': profile['output'], 'alias': profile.get('alias', True),
                 'sourceSize': source_size, 'size': list(reference.size), 'sourceBytes': source.stat().st_size,
                 'bytes': output.stat().st_size, 'fingerprint': stamp, 'sha256': digest(output)}
        print(f'{entry["source"]}: {entry["sourceBytes"]:,} -> {entry["bytes"]:,} bytes', flush=True)
        return entry

    with ThreadPoolExecutor(max_workers=jobs) as pool:
        entries = [e for e in pool.map(encode, [(p, True) for p in specified] + [(p, False) for p in automatic]) if e]
    entries.sort(key=lambda e: e['output'])
    # Format changes retire earlier generated files rather than shipping stale
    # WebP copies alongside the PNG replacements, including forced rebuilds.
    current_outputs = {e['output'] for e in entries}
    for obsolete in old_entries.keys() - current_outputs:
        output = PUBLIC / obsolete
        if (PUBLIC / 'assets/runtime') in output.parents:
            output.unlink(missing_ok=True)
    aliases = dict(sorted((e['source'], e['output']) for e in entries if e['alias']))
    write_json(URLS, aliases)
    manifest = {'version': VERSION, 'sourceBytes': sum(e['sourceBytes'] for e in entries),
                'outputBytes': sum(e['bytes'] for e in entries), 'files': entries}
    write_json(MANIFEST, manifest)
    print(f'{len(entries)} derivatives: {manifest["sourceBytes"]:,} -> {manifest["outputBytes"]:,} bytes')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--force', action='store_true')
    parser.add_argument('--jobs', type=int, default=4)
    args = parser.parse_args()
    if args.check:
        check()
    else:
        build(args.jobs, args.force)
