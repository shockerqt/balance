from pathlib import Path
import runpy

ROOT = Path(__file__).resolve().parents[1]
for script in (
    'bal027_patch_server.py',
    'bal027_patch_server_fixups.py',
    'bal027_patch_server_consumers.py',
    'bal027_patch_server_postfix.py',
):
    runpy.run_path(str(ROOT / 'scripts' / script), run_name='__main__')
