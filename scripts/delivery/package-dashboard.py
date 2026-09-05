#!/usr/bin/env python3
import gzip
import hashlib
import json
import os
from pathlib import Path
import tarfile

sha = os.environ['GITHUB_SHA']
root = Path('apps/dashboard/dist')
(root / 'release.json').write_text(json.dumps({'source_sha': sha, 'component': 'dashboard'}) + '\n')
with Path('dashboard.tar.gz').open('wb') as raw:
    with gzip.GzipFile(fileobj=raw, mode='wb', filename='', mtime=0) as compressed:
        with tarfile.open(fileobj=compressed, mode='w') as archive:
            for path in sorted(root.rglob('*')):
                if path.is_symlink():
                    raise ValueError('Artifact cannot contain symlinks')
                if path.is_file():
                    info = archive.gettarinfo(str(path), arcname=str(path.relative_to(root)))
                    info.uid = info.gid = info.mtime = 0
                    info.uname = info.gname = ''
                    info.mode = 0o644
                    with path.open('rb') as file:
                        archive.addfile(info, file)
digest = hashlib.sha256(Path('dashboard.tar.gz').read_bytes()).hexdigest()
Path('dashboard.sha256').write_text(f'{digest}  dashboard.tar.gz\n')
