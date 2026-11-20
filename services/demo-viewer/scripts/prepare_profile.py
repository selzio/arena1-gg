#!/usr/bin/env python3
"""Copy the existing QVA HUD and Wolfcam X-Ray assets; never edit originals."""
from pathlib import Path
import json
import shutil
import re
import zipfile

ROOT = Path(__file__).resolve().parents[1]
HOME = Path.home()
dest = ROOT/'public/profile'
dest.mkdir(parents=True, exist_ok=True)
sources = {
    'scripts/dud3_xray.shader': HOME/'Library/Application Support/wolfcamql/n8mare/scripts/dud3_xray.shader',
}
for rel, src in sources.items():
    target = dest/rel
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, target)
# Ship the original game defaults and UI byte-for-byte. Browser-specific
# overrides live in arena-viewer.cfg, never masquerading as stock default.cfg.
for rel in ['ui/dud.cfg', 'ui/dud.menu']:
    (dest/rel).unlink(missing_ok=True)
with zipfile.ZipFile(HOME/'wolfcamql-player/baseq3/pak00.pk3') as archive:
    for name in archive.namelist():
        if name == 'default.cfg' or (name.startswith('ui/') and not name.endswith('/')):
            target = dest/name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(archive.read(name))
# Only stock Wolfcam support assets, not personal skins/FX or OpenArena packs.
stock = HOME/'wolfcamql-player/wolfcam-ql'
for folder in ['gfx/wc', 'models/wc', 'sound/wc']:
    source = stock/folder
    if source.is_dir():
        shutil.copytree(source, dest/folder, dirs_exist_ok=True)
for old in (dest/'scripts').glob('wc*.shader'):
    old.unlink()  # Generated copies from earlier web builds, not source assets.
support = []
for src in sorted((stock/'scripts').glob('wc*.shader')):
    # Preserve line boundaries: animMap reads image names until end of line.
    source = re.sub(r'/\*.*?\*/|//[^\n]*', '', src.read_text(), flags=re.S)
    tokens = list(re.finditer(r'[^\s{}]+|[{}]', source))
    i = 0
    while i + 1 < len(tokens):
        name = tokens[i].group().strip('"').lower()
        if tokens[i + 1].group() != '{':
            i += 1
            continue
        start = tokens[i].start()
        i += 2
        depth = 1
        while i < len(tokens) and depth:
            depth += (tokens[i].group() == '{') - (tokens[i].group() == '}')
            i += 1
        if name.startswith(('wc/', 'gfx/wc/', 'adbox')):
            support.append(source[start:tokens[i - 1].end()])
(dest/'scripts/arena-wolfcam-support.shader').write_text('\n'.join(support))
for src in (HOME/'wolfcamql-player/wolfcam-ql/wcfonts').glob('*'):
    if src.is_file():
        target = dest/'wcfonts'/src.name
        target.parent.mkdir(exist_ok=True)
        shutil.copy2(src, target)
from build_profile_bundle import build_profile_bundle
build_profile_bundle(dest)
