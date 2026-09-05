#!/usr/bin/env python3
import hashlib
import json
import os
from pathlib import Path
import tarfile

binary = Path('target/aarch64-unknown-linux-gnu/release/server')
metadata = {'source_sha': os.environ['GITHUB_SHA'], 'run_id': os.environ['GITHUB_RUN_ID'],
    'binary_sha256': hashlib.sha256(binary.read_bytes()).hexdigest(),
    'migrations': {p.name.split('_')[0]: hashlib.sha384(p.read_bytes()).hexdigest() for p in sorted(Path('apps/server/migrations').glob('*.sql'))}}
Path('api-release.json').write_text(json.dumps(metadata) + '\n')
with tarfile.open('api.tar.gz', 'w:gz') as archive:
    archive.add(binary, arcname='server')
    archive.add('api-release.json', arcname='api-release.json')
Path('api.sha256').write_text(hashlib.sha256(Path('api.tar.gz').read_bytes()).hexdigest() + '  api.tar.gz\n')
