#!/usr/bin/env python3
"""Arena1 resource server. Demos are read only inside the visitor's browser.

Reuses the installed Wolfcam game packages and its Steam Workshop identifiers.
No demo upload endpoint, game installation or server video rendering is involved.
"""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import struct
import ssl
import subprocess
import threading
import time
from urllib.parse import unquote, urlparse
from urllib.request import Request, urlopen
import zipfile

ROOT = Path(__file__).resolve().parent
PREFIX = '/demo-viewer'
SAFE_MAP = re.compile(r'[a-zA-Z0-9_-]{1,64}\Z')
IMAGE_EXT = ('.tga', '.jpg', '.png', '.jpeg', '.dds')
TLS = ssl.create_default_context(cafile='/etc/ssl/cert.pem' if Path('/etc/ssl/cert.pem').is_file() else None)


def valid_map(value):
    if not isinstance(value, str) or not SAFE_MAP.fullmatch(value):
        raise ValueError('Invalid map name')
    return value.lower()


def safe_member(name):
    p = PurePosixPath(name)
    return bool(name) and not p.is_absolute() and '..' not in p.parts and '\\' not in name


def shader_blocks(text):
    text = re.sub(r'/\*.*?\*/|//[^\n]*', '', text, flags=re.S)
    tokens = re.findall(r'[^\s{}]+|[{}]', text)
    i = 0
    while i + 1 < len(tokens):
        name = tokens[i].strip('"').lower()
        if tokens[i + 1] != '{':
            i += 1
            continue
        i += 2
        depth, body = 1, []
        while i < len(tokens) and depth:
            token = tokens[i]
            depth += (token == '{') - (token == '}')
            body.append(token.strip('"').lower())
            i += 1
        yield name, body


class Library:
    def __init__(self, home: Path, roots: list[Path], sources: dict | None = None):
        self.home = home
        self.roots = roots
        self.sources = sources or {}
        for name in ('packages', 'downloads', 'profiles'):
            (home / name).mkdir(parents=True, exist_ok=True)
        self.jobs = {}
        self.lock = threading.RLock()
        self.steam_lock = threading.Lock()
        self.pool = ThreadPoolExecutor(max_workers=2)
        self.packages = []
        self.members = {}
        self.shaders = {}
        self.core = None
        self.player_models = set()

    def index(self):
        self.packages = sorted({p.resolve() for root in self.roots if root.exists()
                                for p in root.rglob('*.pk3') if p.is_file()})
        self.members = {}
        self.shaders = {}
        for path in self.packages:
            try:
                with zipfile.ZipFile(path) as archive:
                    if path.name != 'pak00.pk3' and not any(
                        i.filename.lower().startswith('maps/') and i.filename.lower().endswith('.bsp')
                        for i in archive.infolist()
                    ):
                        # Standalone banner/skin/FX packs in the local install
                        # must not replace stock materials in this service.
                        continue
                    for info in archive.infolist():
                        if not info.is_dir() and safe_member(info.filename):
                            self.members[info.filename.lower()] = (path, info.filename)
                            if info.filename.lower().endswith('.shader') and info.file_size < 8_000_000:
                                self.shaders.update(shader_blocks(archive.read(info).decode('utf-8', 'replace')))
            except zipfile.BadZipFile:
                continue
        self.player_models = {n.split('/')[2] for n in self.members
                              if n.startswith('models/players/') and len(n.split('/')) > 3
                              and n.split('/')[2] not in {'characters', 'heads'}}

    def is_player_asset(self, name):
        return name.startswith('models/players/') or any(
            name.startswith('sound/player/' + model + '/') for model in self.player_models)

    def player_packs(self, models):
        if not isinstance(models, list) or len(models) > 4:
            raise ValueError('Invalid player model request')
        files = []
        for model in sorted(set(valid_map(m) for m in models)):
            prefixes = [f'models/players/{model}/', f'models/players/characters/{model}/',
                        f'models/players/heads/{model}/', f'sound/player/{model}/']
            names = [n for n in self.members if any(n.startswith(p) for p in prefixes)]
            if names:
                files.append(self.pack(names, 'player-' + model))
        return files

    def pack(self, names, label):
        entries = [(name, self.members[name]) for name in sorted(set(names)) if name in self.members]
        stamp = [(name, str(p), p.stat().st_size, p.stat().st_mtime_ns) for name, (p, _) in entries]
        key = hashlib.sha256(json.dumps(['deflate-6-v2', stamp]).encode()).hexdigest()[:24]
        dest = self.home / 'packages' / f'{label}-{key}.pk3'
        if not dest.exists():
            tmp = dest.with_suffix('.partial')
            opened = {}
            try:
                with zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as out:
                    for name, (p, original) in entries:
                        archive = opened.setdefault(p, None)
                        if archive is None:
                            archive = opened[p] = zipfile.ZipFile(p)
                        out.writestr(name, archive.read(original))
                tmp.replace(dest)
            finally:
                for archive in opened.values():
                    if archive is not None:
                        archive.close()
                tmp.unlink(missing_ok=True)
        return self.descriptor(dest)

    def descriptor(self, p):
        return {'src': f'{PREFIX}/resources/{p.name}', 'dst': f'/baseq3/{p.name}', 'size': p.stat().st_size}

    def image_dependencies(self, tokens):
        result = set()
        for token in tokens:
            token = token.lower()
            stem = token
            for extension in IMAGE_EXT:
                if token.endswith(extension):
                    stem = token[:-len(extension)]
                    break
            # Quake's renderer tries alternate image extensions. A shader may
            # request a TGA that is stored as JPEG in the stock game package.
            for image in (token, *(stem + extension for extension in IMAGE_EXT)):
                if image in self.members:
                    result.add(image)
        return result

    def build_core(self):
        names = [n for n in self.members if n.split('/')[0] not in
                 {'maps', 'levelshots', 'music', 'textures', 'demos', 'botfiles'}
                 and not n.endswith(('.qvm', '.dll', '.exe', '.dylib', '.so'))
                 and (not n.endswith('.cfg') or '/' in n or n == 'default.cfg')]
        # Wolfcam builds advertisement geometry at runtime, outside BSP shader
        # references. Its stock adbox shaders need these stock images as well.
        names.extend(n for n in self.members if n.startswith('textures/ad_content/'))
        # Weapon/player shaders reference images outside models/. Include those
        # dependencies rather than falling back to white/missing-image materials.
        for shader, tokens in self.shaders.items():
            if shader.startswith('textures/'):
                continue
            names.extend(self.image_dependencies(tokens))
        self.core = self.pack((n for n in names if not self.is_player_asset(n)), 'arena-core')

    def map_pack(self, name):
        bsp = f'maps/{name}.bsp'
        path, member = self.members[bsp]
        with zipfile.ZipFile(path) as z:
            data = z.read(member)
        if data[:4] != b'IBSP' or len(data) < 144:
            raise ValueError('Unsupported map BSP format')
        version = struct.unpack_from('<i', data, 4)[0]
        if version not in (46, 47):
            raise ValueError(f'Unsupported BSP version: {version}')
        offset, size = struct.unpack_from('<ii', data, 16)  # lump 1: shaders
        if offset < 0 or size < 0 or offset + size > len(data) or size % 72:
            raise ValueError('Corrupt map material list')
        wanted = {bsp}
        material_names = {data[i:i+64].split(b'\0')[0].decode('ascii', 'ignore').lower()
                          for i in range(offset, offset + size, 72)}
        # Reuse the game's shader declarations to find the map's actual images.
        for material in material_names:
            wanted.update(self.image_dependencies([material, *self.shaders.get(material, [])]))
        # External workshop packages can carry extra models, images and sounds.
        if path.name != 'pak00.pk3':
            with zipfile.ZipFile(path) as z:
                wanted.update(i.filename.lower() for i in z.infolist()
                              if not i.is_dir() and not i.filename.lower().startswith('maps/')
                              and safe_member(i.filename))
        return self.pack(wanted, 'map-' + name if SAFE_MAP.fullmatch(name) else 'map')

    def prepare(self, name, workshop_ids=''):
        name = valid_map(name)
        ids = sorted(set(re.findall(r'\b[0-9]{6,12}\b', str(workshop_ids))))[:8]
        # Same map/source request shares one download. Failed jobs may be retried.
        key = hashlib.sha256((name + ':' + ','.join(ids)).encode()).hexdigest()[:24]
        with self.lock:
            job = self.jobs.get(key)
            if job and job['state'] != 'error':
                return dict(job)
            if sum(j['state'] not in ('ready', 'error') for j in self.jobs.values()) >= 16:
                raise ValueError('The server is busy preparing maps. Please try again later.')
            job = {'id': key, 'map': name, 'state': 'checking', 'message': 'Checking map', 'files': []}
            self.jobs[key] = job
            self.pool.submit(self._prepare, job, ids)
            return dict(job)

    def _prepare(self, job, ids):
        name = job['map']
        try:
            if f'maps/{name}.bsp' not in self.members:
                job.update(state='downloading', message='Downloading map to server')
                self.download(name, ids)
                with self.lock:
                    self.index()
            if f'maps/{name}.bsp' not in self.members:
                raise ValueError(f'Map {name} was not found in the available sources')
            job.update(state='checking', message='Preparing map resources')
            with self.lock:
                resource = self.map_pack(name)
            job.update(state='ready', message='Map ready', files=[resource])
        except Exception as exc:
            job.update(state='error', message=str(exc), files=[])

    def download(self, name, ids):
        entry = self.sources.get('maps', {}).get(name, {})
        urls = list(entry.get('urls', []))
        urls += [template.replace('{map}', name) for template in self.sources.get('mirrors', [])]
        errors = []
        for url in urls:
            # URLs come only from the owner's configuration, never from a demo.
            if urlparse(url).scheme != 'https':
                errors.append('Map sources must use HTTPS')
                continue
            tmp = self.home/'downloads'/f'{name}.partial'
            try:
                with urlopen(Request(url, headers={'User-Agent': 'Arena1-DemoViewer/0.1'}), timeout=45, context=TLS) as response:
                    total = 0
                    with tmp.open('wb') as target:
                        while chunk := response.read(1024 * 1024):
                            total += len(chunk)
                            if total > 512 * 1024 * 1024:
                                raise ValueError('The map package exceeds 512 MB')
                            target.write(chunk)
                with zipfile.ZipFile(tmp) as archive:
                    if f'maps/{name}.bsp' not in {n.lower() for n in archive.namelist()}:
                        raise ValueError('The downloaded package does not contain the requested map')
                    if sum(i.file_size for i in archive.infolist()) > 2 * 1024**3:
                        raise ValueError('The extracted package exceeds 2 GB')
                    if archive.testzip():
                        raise ValueError('The map package is corrupt')
                tmp.replace(self.home/'downloads'/f'{name}.pk3')
                return
            except Exception as exc:
                errors.append(str(exc))
                tmp.unlink(missing_ok=True)
        bundled = ROOT/'.tools/steamcmd/steamcmd.sh'
        steamcmd = self.sources.get('steamcmd') or shutil.which('steamcmd') or (str(bundled) if bundled.is_file() else None)
        ids = list(dict.fromkeys([*entry.get('workshop_ids', []), *ids]))
        if steamcmd and ids:
            # Same mechanism already used by the installed Wolfcam.
            with self.steam_lock:
                for item in ids:
                    if not re.fullmatch(r'[0-9]{6,12}', str(item)):
                        continue
                    result = subprocess.run([str(steamcmd), '+login', 'anonymous',
                        '+workshop_download_item', '282440', str(item), '+quit'],
                        capture_output=True, text=True, timeout=240)
                    match = re.search(r'Downloaded item .*? to "([^"]+)"', result.stdout)
                    if match:
                        for package in Path(match[1]).rglob('*.pk3'):
                            with zipfile.ZipFile(package) as archive:
                                if f'maps/{name}.bsp' in {n.lower() for n in archive.namelist()}:
                                    shutil.copy2(package, self.home/'downloads'/f'{name}-{package.name}')
                                    return
        raise ValueError('Could not download the map automatically. ' +
                         ('; '.join(errors[-2:]) if errors else
                          'No configured source or available SteamCMD was found for this map.'))


class Handler(BaseHTTPRequestHandler):
    library: Library

    def json(self, value, status=200):
        body = json.dumps(value, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = unquote(urlparse(self.path).path)
        if path == PREFIX + '/api/manifest':
            self.json({'engineReady': (ROOT/'public/engine/arena-wolfcam_opengl2.wasm').is_file(),
                       'engineVersion': self.engine_version,
                       'files': [self.library.core], 'profile': PREFIX + '/profile/manifest.json'})
            return
        if path.startswith(PREFIX + '/api/jobs/'):
            job = self.library.jobs.get(path.rsplit('/', 1)[-1])
            self.json(dict(job) if job else {'message': 'Job not found'}, 200 if job else 404)
            return
        for prefix, folder in [(PREFIX+'/resources/', self.library.home/'packages'),
                               (PREFIX+'/profile/', ROOT/'public/profile'),
                               (PREFIX+'/', ROOT/'public')]:
            if path.startswith(prefix):
                relative = path[len(prefix):] or 'index.html'
                if not safe_member(relative):
                    self.json({'message': 'Invalid path'}, 400)
                    return
                target = (folder/relative).resolve()
                if target.is_relative_to(folder.resolve()) and target.is_file():
                    self.file(target)
                    return
        self.json({'message': 'Not found'}, 404)

    def do_POST(self):
        endpoint = urlparse(self.path).path
        if endpoint not in (PREFIX + '/api/maps/prepare', PREFIX + '/api/players/prepare'):
            self.json({'message': 'Not found'}, 404)
            return
        # Only a map name/Workshop IDs are accepted. No demo or arbitrary URL upload.
        origin = self.headers.get('Origin')
        if origin and urlparse(origin).netloc != self.headers.get('Host'):
            self.json({'message': 'Request origin is not allowed'}, 403)
            return
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if not 0 < size <= 4096:
                raise ValueError('Invalid request size')
            data = json.loads(self.rfile.read(size))
            if endpoint.endswith('/players/prepare'):
                with self.library.lock:
                    self.json({'files': self.library.player_packs(data.get('models'))})
            else:
                self.json(self.library.prepare(data.get('map'), data.get('workshops', '')))
        except (ValueError, TypeError, AttributeError) as exc:
            self.json({'message': str(exc)}, 400)

    def file(self, path):
        import mimetypes
        self.send_response(200)
        mime = 'application/wasm' if path.suffix == '.wasm' else mimetypes.guess_type(path)[0] or 'application/octet-stream'
        self.send_header('Content-Type', mime)
        self.send_header('Content-Length', str(path.stat().st_size))
        versioned = bool(re.search(r'[?&]v=[a-f0-9]{16}(?:&|$)', self.path))
        self.send_header('Cache-Control', 'public, max-age=31536000, immutable' if path.suffix == '.pk3' or versioned else 'no-cache')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.end_headers()
        try:
            with path.open('rb') as source:
                shutil.copyfileobj(source, self.wfile)
        except (BrokenPipeError, ConnectionResetError):
            pass


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--host', default='127.0.0.1')
    parser.add_argument('--port', default=8766, type=int)
    parser.add_argument('--home', type=Path, default=Path.home()/'Quake Bank/Arena1 Demo Viewer')
    parser.add_argument('--sources', type=Path, default=ROOT/'sources.json')
    args = parser.parse_args()
    # Stock Quake Live assets only. Personal n8mare/Wolfcam skin and FX packs
    # must not override the standard textures in the browser service.
    roots = [Path.home()/'wolfcamql-player/baseq3', args.home/'downloads']
    sources = json.loads(args.sources.read_text()) if args.sources.exists() else {}
    roots.extend(Path(p).expanduser() for p in sources.get('local_roots', []))
    library = Library(args.home, roots, sources)
    print('Indexing existing Wolfcam packages...', flush=True)
    library.index()
    library.build_core()
    Handler.library = library
    engine = ROOT/'public/engine/arena-wolfcam_opengl2.wasm'
    Handler.engine_version = hashlib.sha256(engine.read_bytes()).hexdigest()[:16] if engine.exists() else ''
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f'Arena1 demo viewer: http://{args.host}:{args.port}{PREFIX}/', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        library.pool.shutdown(wait=False, cancel_futures=True)


if __name__ == '__main__':
    main()
