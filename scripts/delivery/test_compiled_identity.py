"""API-only native compilation checks; inspect artifacts without executing them."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

from compiled_identity import START, END, verify_compiled_identity

SCRIPTS = Path(__file__).resolve().parent


class CompileIdentityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix='balance-build-identity-test-')
        cls.addClassCleanup(cls.temp.cleanup)
        cls.program = Path(cls.temp.name) / 'build-identity'
        subprocess.run(['rustc', '--edition=2024', str(SCRIPTS.parents[1] / 'apps/server/build.rs'),
                        '-o', str(cls.program)], check=True, capture_output=True, timeout=60)

    def run_build(self, source=None, run=None):
        env = os.environ.copy()
        for key in ('BALANCE_BUILD_SOURCE_SHA', 'BALANCE_BUILD_RUN_ID'):
            env.pop(key, None)
        if source is not None:
            env['BALANCE_BUILD_SOURCE_SHA'] = source
        if run is not None:
            env['BALANCE_BUILD_RUN_ID'] = run
        return subprocess.run([str(self.program)], env=env, capture_output=True, text=True, timeout=10)

    def test_compile_inputs_rerun_tracking_and_unknown_local_identity(self):
        result = self.run_build()
        self.assertEqual(result.returncode, 0)
        self.assertIn('BALANCE_API_IDENTITY_V1[unknown:unknown]BALANCE_API_IDENTITY_END', result.stdout)
        self.assertIn('rerun-if-env-changed=BALANCE_BUILD_SOURCE_SHA', result.stdout)
        self.assertIn('rerun-if-env-changed=BALANCE_BUILD_RUN_ID', result.stdout)
        result = self.run_build('a' * 40, '123456')
        self.assertEqual(result.returncode, 0)
        self.assertIn(f'BALANCE_API_IDENTITY_V1[{"a" * 40}:123456]BALANCE_API_IDENTITY_END', result.stdout)
        for source, run in ((None, '1'), ('a' * 40, None), ('SOURCE_SECRET', '1'),
                            ('A' * 40, '1'), ('a' * 40, ''), ('a' * 40, '0'),
                            ('a' * 40, '1' * 21), ('a' * 40, '12\n')):
            result = self.run_build(source, run)
            self.assertNotEqual(result.returncode, 0)
            self.assertNotIn('SOURCE_SECRET', result.stderr)

    def test_real_compiled_identity_module_retains_one_unambiguous_record(self):
        # Compile the actual runtime module into a tiny native artifact and only
        # inspect bytes. This catches adjacent delimiter literals in rodata;
        # the ARM production package independently repeats the same verification.
        root = Path(self.temp.name)
        module = SCRIPTS.parents[1] / 'apps/server/src/build_identity.rs'
        source = root / 'identity-probe.rs'
        source.write_text(f'#[path = {json.dumps(str(module))}] mod build_identity;\n'
                          'fn main() { let id = build_identity::compiled_identity(); '
                          'std::hint::black_box((id.source_sha, id.build_run)); }\n')
        env = os.environ.copy()
        env['BALANCE_COMPILED_IDENTITY'] = (START + f'{"a" * 40}:123456'.encode() + END).decode()
        binary = root / 'identity-probe'
        subprocess.run(['rustc', '--edition=2024', '-C', 'opt-level=2', '-C', 'debuginfo=0',
                        str(source), '-o', str(binary)], env=env, check=True,
                       capture_output=True, timeout=60)
        verify_compiled_identity(binary.read_bytes(), 'a' * 40, '123456')


if __name__ == '__main__':
    unittest.main()
