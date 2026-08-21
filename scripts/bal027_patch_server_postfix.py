from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MCP = ROOT / 'apps/server/src/modules/mcp/mod.rs'
text = MCP.read_text()
text = text.replace('"pattern": "^(?:[01]\\d|2[0-3]):[0-5]\\d$"', '"pattern": "^(?:[01]\\\\d|2[0-3]):[0-5]\\\\d$"')
MCP.write_text(text)
