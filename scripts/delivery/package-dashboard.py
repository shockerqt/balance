#!/usr/bin/env python3
import hashlib
import json
import os
from pathlib import Path
import tarfile

sha = os.environ['GITHUB_SHA']
root = Path('apps/dashboard/dist')
(root / 'release.json').write_text(json.dumps({'source_sha': sha, 'run_id': os.environ['GITHUB_RUN_ID'], 'component': 'dashboard'}) + '\n')
with tarfile.open('dashboard.tar.gz', 'w:gz') as archive:
    for path in sorted(root.rglob('*')):
        if path.is_symlink():
            raise ValueError('Artifact cannot contain symlinks')
        if path.is_file():
            archive.add(path, arcname=str(path.relative_to(root)), recursive=False)
digest = hashlib.sha256(Path('dashboard.tar.gz').read_bytes()).hexdigest()
Path('dashboard.sha256').write_text(f'{digest}  dashboard.tar.gz\n')
