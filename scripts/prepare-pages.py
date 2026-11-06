#!/usr/bin/env python3
"""Package the tested browser build as a GitHub Pages deployment artifact."""
import hashlib
import json
from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / 'output/tinyciv-pages'
SOURCE = ROOT / 'dist'
if not (SOURCE / 'index.html').is_file():
    raise SystemExit('Run npm run build before preparing Pages.')
if TARGET.exists():
    shutil.rmtree(TARGET)
TARGET.mkdir(parents=True)
for path in sorted(SOURCE.rglob('*')):
    if path.is_symlink():
        raise SystemExit(f'Refusing symlink: {path}')
    if path.is_file():
        dest = TARGET / path.relative_to(SOURCE)
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, dest)
(TARGET / 'README.md').write_text('''# TinyCiv

[Play TinyCiv](https://tinyciv.github.io/)

A pixel-art civilization game with settlement building, research, trade, exploration,
and real-time battles. Play solo or create a two-player multiplayer match from the main menu.

Use WASD to move the Leader, B to build, F for fortifications, and Escape for the menu.
Click once to start a road, wall, bridge, or ditch, then again to finish it.
On mobile, play in landscape: move with the joystick, tap to command or open a
building, and use two fingers to pan or zoom. Boats use Q/E steering or the touch
turn buttons and retain momentum. Controls and settings are available in the game.

This site contains the deployed browser build. Multiplayer uses a separate
server at https://d120onxzjgx6ss.cloudfront.net. GitHub Pages hosts the static game.

Artwork and fonts retain their individual licenses; see [asset provenance](ASSETS.md)
and the license files alongside the assets. The game is not an asset redistribution pack.
''')
shutil.copy2(ROOT / 'ASSETS.md', TARGET / 'ASSETS.md')
files=[]
for path in sorted(TARGET.rglob('*')):
    if path.is_file():
        data=path.read_bytes()
        files.append({'path':str(path.relative_to(TARGET)), 'size':len(data), 'sha256':hashlib.sha256(data).hexdigest(),
                      'git_sha':hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest()})
manifest={'files':files,'bytes':sum(f['size'] for f in files)}
(ROOT / 'output/tinyciv-pages-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(f'Prepared {len(files)} public browser files ({manifest["bytes"]:,} bytes) at {TARGET}.')
