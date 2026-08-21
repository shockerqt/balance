from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MCP = ROOT / 'apps/server/src/modules/mcp/mod.rs'
text = MCP.read_text()
old = '''fn entry_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "enteredQuantity": positive_number_schema(),
            "portionSnapshot": { "anyOf": [portion_schema(), { "type": "null" }] }
        },
        "required": ["enteredQuantity"],
        "additionalProperties": false
    })
}
'''
new = '''fn portion_snapshot_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "portionId": { "type": "string", "minLength": 1, "maxLength": 80 },
            "name": { "type": "string", "minLength": 1, "maxLength": 120 },
            "portionQuantity": positive_number_schema(),
            "canonicalQuantity": positive_number_schema()
        },
        "required": ["name", "portionQuantity", "canonicalQuantity"],
        "additionalProperties": false
    })
}

fn entry_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "enteredQuantity": positive_number_schema(),
            "portionSnapshot": { "anyOf": [portion_snapshot_schema(), { "type": "null" }] }
        },
        "required": ["enteredQuantity"],
        "additionalProperties": false
    })
}
'''
if old in text:
    text = text.replace(old, new, 1)
elif 'fn portion_snapshot_schema() -> Value' not in text:
    raise RuntimeError('MCP entry schema marker not found')
MCP.write_text(text)
