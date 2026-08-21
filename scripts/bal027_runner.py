from pathlib import Path
import runpy

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

mobile = (ROOT / 'apps/mobile/src/services/sync/types.ts').read_text()
if "export type MealUnit = 'g' | 'ml' | 'unit' | 'portion' | 'cup';" in mobile:
    run('bal027_patch_mobile.py')
    run('bal027_patch_mobile_post.py')

dashboard = (ROOT / 'apps/dashboard/src/types/meal-log.ts').read_text()
if "export type MealUnit = 'g' | 'ml' | 'unit' | 'portion' | 'cup';" in dashboard:
    run('bal027_patch_dashboard.py')
