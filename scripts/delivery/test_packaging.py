"""Exercise real packagers in isolated, committed synthetic checkouts."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import unittest

SCRIPTS = Path(__file__).resolve().parent


class PackagingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='balance-packaging-test-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.binary = b'synthetic ARM executable fixture\n'
        self.migration = b'-- synthetic migration\nSELECT 1;\n'
        fixtures = {
            'target/aarch64-unknown-linux-gnu/release/server': self.binary,
            'apps/server/migrations/202610110001_fixture.sql': self.migration,
            'apps/dashboard/dist/index.html': b'<script src="/releases/fixture/app.js"></script>',
            'apps/dashboard/dist/app.js': b'console.log("synthetic");\n',
        }
        for name, content in fixtures.items():
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(content)
        self.git('init', '-q')
        self.git('add', '.')
        self.git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
                 'commit', '-qm', 'Synthetic packaging fixture')
        self.sha = self.git('rev-parse', 'HEAD').strip()

    def git(self, *args):
        return subprocess.check_output(['git', *args], cwd=self.root, text=True)

    def package(self, component, expected):
        env = os.environ.copy()
        env.pop('BALANCE_SOURCE_SHA', None)
        env['GITHUB_SHA'] = 'f' * 40 if self.sha != 'f' * 40 else 'e' * 40
        env['GITHUB_RUN_ID'] = '123456'
        if expected is not None:
            env['BALANCE_SOURCE_SHA'] = expected
        return subprocess.run([sys.executable, str(SCRIPTS / f'package-{component}.py')],
                              cwd=self.root, env=env, capture_output=True, text=True,
                              timeout=10)

    def assert_digest(self, component):
        archive = self.root / f'{component}.tar.gz'
        self.assertEqual((self.root / f'{component}.sha256').read_text(),
                         hashlib.sha256(archive.read_bytes()).hexdigest()
                         + f'  {component}.tar.gz\n')

    def test_api_archived_identity_binary_migrations_and_digest(self):
        result = self.package('api', self.sha)
        self.assertEqual(result.returncode, 0, result.stderr)
        with tarfile.open(self.root / 'api.tar.gz') as archive:
            metadata = json.load(archive.extractfile('api-release.json'))
            self.assertEqual(archive.extractfile('server').read(), self.binary)
        self.assertEqual(metadata, {
            'source_sha': self.sha, 'run_id': '123456',
            'binary_sha256': hashlib.sha256(self.binary).hexdigest(),
            'migrations': {'202610110001': hashlib.sha384(self.migration).hexdigest()},
        })
        self.assert_digest('api')

    def test_dashboard_archived_identity_content_digest_and_determinism(self):
        result = self.package('dashboard', self.sha)
        self.assertEqual(result.returncode, 0, result.stderr)
        original = (self.root / 'dashboard.tar.gz').read_bytes()
        with tarfile.open(self.root / 'dashboard.tar.gz') as archive:
            self.assertEqual(json.load(archive.extractfile('release.json')),
                             {'source_sha': self.sha, 'component': 'dashboard'})
            self.assertEqual(archive.extractfile('index.html').read(),
                             (self.root / 'apps/dashboard/dist/index.html').read_bytes())
        self.assert_digest('dashboard')
        for path in (self.root / 'apps/dashboard/dist').iterdir():
            os.utime(path, (123456789, 123456789))
        result = self.package('dashboard', self.sha)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.root / 'dashboard.tar.gz').read_bytes(), original)

    def test_rejected_identity_writes_no_outputs(self):
        for component in ('api', 'dashboard'):
            for expected in (None, '', 'a' * 39, 'g' * 40, 'a' * 41,
                             self.sha + '\n', '0' * 40):
                with self.subTest(component=component, expected=expected):
                    result = self.package(component, expected)
                    self.assertNotEqual(result.returncode, 0)
                    self.assertIn('BALANCE_SOURCE_SHA', result.stderr)
                    for output in ('api-release.json', 'api.tar.gz', 'api.sha256',
                                   'apps/dashboard/dist/release.json',
                                   'dashboard.tar.gz', 'dashboard.sha256'):
                        self.assertFalse((self.root / output).exists(), output)


if __name__ == '__main__':
    unittest.main()
