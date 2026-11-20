#!/usr/bin/env python3
"""Bundle browser-only overrides; stock UI already ships in the core pack."""
from pathlib import Path
import hashlib
import io
import json
import re
import zipfile


def build_profile_bundle(dest):
    members = [p for p in sorted(dest.rglob('*')) if p.is_file()
               and p.name != 'manifest.json' and p.suffix != '.pk3'
               and p.relative_to(dest).parts[0] != 'ui'
               and not re.search(r' \d+\.', p.name)]
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for p in members:
            info = zipfile.ZipInfo(str(p.relative_to(dest)), date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, p.read_bytes(), compresslevel=6)
    body = output.getvalue()
    name = 'arena-profile-' + hashlib.sha256(body).hexdigest()[:24] + '.pk3'
    (dest/name).write_bytes(body)
    files = [{'src': '/demo-viewer/profile/'+name, 'dst': '/baseq3/'+name, 'size': len(body)}]
    (dest/'manifest.json').write_text(json.dumps(files, indent=2))
    print('Browser profile bundled:', len(members), 'files,', len(body), 'bytes')


if __name__ == '__main__':
    build_profile_bundle(Path(__file__).resolve().parents[1]/'public/profile')
