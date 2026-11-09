"""Inspect a compiled identity record; never execute the cross-built binary."""
import re

START = b'BALANCE_API_IDENTITY_V1['
END = b']BALANCE_API_IDENTITY_END'
RECORD = re.compile(re.escape(START) + rb'([^\x00]{0,128}?)' + re.escape(END))


def verify_compiled_identity(binary, source_sha, run_id):
    if re.fullmatch(r'[1-9][0-9]{0,19}', run_id) is None:
        raise ValueError('API build run must be a bounded positive decimal ID')
    records = RECORD.findall(binary)
    expected = f'{source_sha}:{run_id}'.encode('ascii')
    if records != [expected]:
        raise ValueError('API compiled source/build identity is absent, ambiguous or mismatched')
