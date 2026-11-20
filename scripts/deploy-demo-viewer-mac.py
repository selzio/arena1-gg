#!/usr/bin/env python3
"""Deploy the clean, committed player checkout to the existing Mac service."""
from pathlib import Path
import datetime
import hashlib
import json
import os
import shutil
import subprocess
import time
import urllib.request

repo = Path(__file__).resolve().parents[1]
revision = subprocess.check_output(['git', '-C', str(repo), 'rev-parse', 'HEAD'], text=True).strip()
if subprocess.check_output(['git', '-C', str(repo), 'status', '--porcelain'], text=True).strip():
    raise SystemExit('Deploy a clean checkout after committing and pushing the release.')
source = repo/'services/demo-viewer'
target = Path.home()/'Library/Application Support/Arena1DemoViewer'
if not (target/'server.py').is_file():
    raise SystemExit('Existing Mac demo-viewer service not found; no unrelated service changed.')
backup = target/'deploy-backups'/(datetime.datetime.now().strftime('%Y%m%d-%H%M%S')+'-'+revision[:12])
backup.mkdir(parents=True)
files = [source/'server.py', *(p for p in (source/'public').rglob('*') if p.is_file())]
for p in files:
    relative = p.relative_to(source); dst = target/relative
    if dst.exists():
        saved = backup/relative; saved.parent.mkdir(parents=True, exist_ok=True); shutil.copyfile(dst, saved)
    dst.parent.mkdir(parents=True, exist_ok=True)
    staged = dst.with_name(dst.name+'.deploy-new'); shutil.copyfile(p, staged); staged.replace(dst)
(target/'deployment.json').write_text(json.dumps({'gitRevision':revision,'backup':str(backup)}, indent=2))
subprocess.run(['launchctl','kickstart','-k',f'gui/{os.getuid()}/com.selzio.arena1.demo-viewer'],check=True)
expected=hashlib.sha256((source/'public/engine/arena-wolfcam_opengl2.wasm').read_bytes()).hexdigest()[:16]
for _ in range(40):
    try:
        with urllib.request.urlopen('http://127.0.0.1:8766/demo-viewer/api/manifest', timeout=2) as response: manifest=json.load(response)
        if manifest.get('engineVersion') == expected:
            print(json.dumps({'deployedRevision':revision,'engineVersion':expected,'coreBytes':manifest['files'][0]['size'],'backup':str(backup)},indent=2));break
    except OSError: pass
    time.sleep(.5)
else: raise SystemExit('Service health check failed. Rollback files: '+str(backup))
