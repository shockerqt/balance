from pathlib import Path
import runpy
import re

ROOT = Path(__file__).resolve().parents[1]

def run(script: str) -> None:
    runpy.run_path(str(ROOT / 'scripts' / script), run_name='__main__')

server = (ROOT / 'apps/server/src/connectors/sync.rs').read_text()
if 'pub const FOOD_SCHEMA_VERSION: i32 = 1;' in server:
    for script in (
        'bal027_patch_server.py',
        'bal027_patch_server_fixups.py',
        'bal027_patch_server_consumers.py',
        'bal027_patch_server_postfix.py',
    ):
        run(script)
run('bal027_patch_existing_server_post.py')

original_subn = re.subn
def literal_subn(pattern, repl, string, count=0, flags=0):
    if isinstance(repl, str):
        return original_subn(pattern, lambda _match: repl, string, count=count, flags=flags)
    return original_subn(pattern, repl, string, count=count, flags=flags)

re.subn = literal_subn
try:
    mobile = (ROOT / 'apps/mobile/src/services/sync/types.ts').read_text()
    if "export type MealUnit = 'g' | 'ml' | 'unit' | 'portion' | 'cup';" in mobile:
        run('bal027_patch_mobile.py')
        run('bal027_patch_mobile_post.py')
        run('bal027_patch_mobile_test_fix.py')

    dashboard = (ROOT / 'apps/dashboard/src/types/meal-log.ts').read_text()
    if "export type MealUnit = 'g' | 'ml' | 'unit' | 'portion' | 'cup';" in dashboard:
        run('bal027_patch_dashboard.py')
finally:
    re.subn = original_subn
