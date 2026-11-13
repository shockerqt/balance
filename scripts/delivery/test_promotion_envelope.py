"""Real producer shapes, hostile package metadata, and invocation-current binding."""
import copy
import hashlib
import io
import json
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch

import promotion_envelope as envelope

SOURCE = 'a' * 40
CURRENT = 'b' * 40
DIGEST = 'c' * 64
IDENTITY = {'source_sha': SOURCE, 'build_run_id': '123456', 'artifact_sha256': DIGEST}
PLAN = {'status': 'plan', 'source_sha': SOURCE, 'artifact_sha256': DIGEST,
        'schema_compatible': True, 'current': {'source_sha': CURRENT, 'artifact_sha256': 'd' * 64}}
RECEIPT = {'status': 'published', 'source_sha': SOURCE, 'run_id': '123456',
           'artifact_sha256': DIGEST, 'previous': {'source_sha': 'e' * 40, 'artifact_sha256': 'f' * 64}}


class PromotionEvidenceTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.archive = self.root / 'api.tar.gz'
        self.digest = self.root / 'api.sha256'
        self.build = {'id': 123456, 'head_sha': SOURCE}
        self.metadata = {'source_sha': SOURCE, 'run_id': '123456',
                         'binary_sha256': 'd' * 64, 'migrations': {'202610110001': 'e' * 96}}

    def package(self, metadata=None, member_type=tarfile.REGTYPE, duplicate=False, name='api-release.json'):
        content = json.dumps(self.metadata if metadata is None else metadata).encode()
        with tarfile.open(self.archive, 'w:gz') as archive:
            binary = tarfile.TarInfo('server')
            binary.size = 4
            archive.addfile(binary, io.BytesIO(b'\x7fELF'))
            for _ in range(2 if duplicate else 1):
                member = tarfile.TarInfo(name)
                member.type = member_type
                member.size = len(content) if member_type == tarfile.REGTYPE else 0
                if member_type in (tarfile.SYMTYPE, tarfile.LNKTYPE):
                    member.linkname = 'server'
                archive.addfile(member, io.BytesIO(content) if member.size else None)
        self.digest.write_text(hashlib.sha256(self.archive.read_bytes()).hexdigest() + '  api.tar.gz\n')

    def identity(self):
        return envelope.artifact_identity(self.archive, self.digest, self.build, '123456')

    def test_package_run_id_maps_to_selected_build(self):
        self.package()
        actual = self.identity()
        self.assertEqual(actual, {**IDENTITY, 'artifact_sha256': self.digest.read_text()[:64]})
        self.metadata['run_id'] = 123456
        self.package()
        self.assertEqual(self.identity(), {**IDENTITY, 'artifact_sha256': self.digest.read_text()[:64]})

    def test_conflicting_artifact_source_run_digest_and_build_are_rejected(self):
        for key, value in [('source_sha', CURRENT), ('run_id', '987654'), ('run_id', True),
                           ('run_id', ''), ('run_id', 0), ('run_id', 1.0), ('run_id', '0123456')]:
            with self.subTest(key=key, value=value):
                metadata = {**self.metadata, key: value}
                self.package(metadata)
                with self.assertRaises(ValueError):
                    self.identity()
        self.package()
        self.digest.write_text('0' * 64 + '  api.tar.gz\n')
        with self.assertRaisesRegex(ValueError, 'digest mismatch'):
            self.identity()
        self.package()
        for bad_id in (True, None, '', 0, '654321'):
            with self.subTest(build_id=bad_id):
                self.build['id'] = bad_id
                with self.assertRaises(ValueError):
                    self.identity()

    def test_unsafe_missing_duplicate_and_oversized_metadata_rejected(self):
        for member_type in (tarfile.SYMTYPE, tarfile.LNKTYPE, tarfile.DIRTYPE, tarfile.FIFOTYPE):
            with self.subTest(member_type=member_type):
                self.package(member_type=member_type)
                with self.assertRaises(ValueError):
                    self.identity()
        for kwargs in ({'duplicate': True}, {'name': './api-release.json'},
                       {'metadata': {'padding': 'x' * envelope.MAX_JSON}}):
            with self.subTest(kwargs=list(kwargs)):
                self.package(**kwargs)
                with self.assertRaises(ValueError):
                    self.identity()
        self.package()
        with patch.object(envelope, 'MAX_ARCHIVE', 100):
            with self.assertRaisesRegex(ValueError, 'size limit'):
                self.identity()
        with patch.object(envelope, 'MAX_ARCHIVE', 1000):
            with self.assertRaisesRegex(ValueError, 'Expanded archive'):
                self.identity()

    def test_json_is_bounded_object_without_duplicate_keys_or_nonfinite_values(self):
        for data in (b'[]', b'null', b'{', b'{"run_id":1,"run_id":2}',
                     b'{"value":NaN}', b'{"value":Infinity}', b' ' * (envelope.MAX_JSON + 1)):
            with self.subTest(data=data[:40]):
                with self.assertRaises(ValueError):
                    envelope.document(data)

    def test_plan_uses_observed_current_and_explicit_null_bootstrap(self):
        self.assertEqual(envelope.normalize_plan(IDENTITY, PLAN),
                         {**IDENTITY, 'status': 'plan', 'schema_compatible': True, 'expected_current': CURRENT})
        self.assertEqual(envelope.normalize_plan(IDENTITY, {**PLAN, 'current': None})['expected_current'], 'none')
        self.assertEqual(envelope.normalize_plan(IDENTITY, {**PLAN, 'current': None}, 'none')['expected_current'], 'none')

    def test_bad_host_plan_shape_or_identity_cannot_create_envelope(self):
        invalid = [('status', 'published'), ('source_sha', CURRENT), ('artifact_sha256', 'f' * 64),
                   ('schema_compatible', 1), ('schema_compatible', False), ('schema_compatible', 'true'),
                   ('current', {}), ('current', []), ('current', False), ('current', ''),
                   ('current', {'source_sha': None}), ('current', {'source_sha': 'none'}),
                   ('current', {'source_sha': CURRENT + '\n'})]
        for key, value in invalid:
            with self.subTest(key=key, value=value):
                with self.assertRaises(ValueError):
                    envelope.normalize_plan(IDENTITY, {**PLAN, key: value})
        for key in PLAN:
            plan = copy.deepcopy(PLAN)
            del plan[key]
            with self.subTest(missing=key), self.assertRaises(ValueError):
                envelope.normalize_plan(IDENTITY, plan)

    def test_approved_current_mismatch_or_invalid_token_prevents_preparation(self):
        for requested in ('none', SOURCE, '', 'B' * 40, CURRENT + '\n', True, 123):
            with self.subTest(requested=requested), self.assertRaises(ValueError):
                envelope.normalize_plan(IDENTITY, PLAN, requested)
        self.assertEqual(envelope.normalize_plan(IDENTITY, PLAN, CURRENT)['expected_current'], CURRENT)

    def test_receipt_bindings_fail_closed(self):
        for key, value in [('status', 'ok'), ('source_sha', CURRENT), ('artifact_sha256', 'f' * 64),
                           ('run_id', '654321'), ('run_id', True), ('run_id', None)]:
            with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                envelope.normalize_delivery(IDENTITY, PLAN, {**RECEIPT, key: value}, CURRENT)
        with self.assertRaises(ValueError):
            envelope.normalize_delivery(IDENTITY, PLAN, RECEIPT, SOURCE)

    def test_idempotent_receipt_previous_is_not_invocation_current(self):
        # Existing release returned by host's idempotent branch: previous is old,
        # while this invocation observed the source already live before deploy.
        plan = {**PLAN, 'current': {'source_sha': SOURCE, 'artifact_sha256': DIGEST}}
        result = envelope.normalize_delivery(IDENTITY, plan, RECEIPT, SOURCE)
        self.assertEqual(result, {**IDENTITY, 'status': 'published', 'expected_current': SOURCE})
        self.assertNotEqual(result['expected_current'], RECEIPT['previous']['source_sha'])

    def test_cli_reads_actual_files_and_emits_no_envelope_on_conflict(self):
        self.package()
        digest = self.digest.read_text()[:64]
        (self.root / 'build-run.json').write_text(json.dumps(self.build))
        (self.root / 'api-plan.raw.json').write_text(json.dumps({**PLAN, 'artifact_sha256': digest}))
        command = [sys.executable, str(Path(envelope.__file__).resolve()), 'plan', '--build-run-id', '123456']
        success = subprocess.run(command, cwd=self.root, capture_output=True, text=True, timeout=5)
        self.assertEqual(success.returncode, 0, success.stderr)
        self.assertEqual(json.loads(success.stdout)['expected_current'], CURRENT)
        failure = subprocess.run(command + ['--expected-current', SOURCE], cwd=self.root,
                                 capture_output=True, text=True, timeout=5)
        self.assertNotEqual(failure.returncode, 0)
        self.assertEqual(failure.stdout, '')
        self.assertIn('Approved current differs', failure.stderr)
        (self.root / 'api-delivery.raw.json').write_text(json.dumps({**RECEIPT, 'artifact_sha256': digest}))
        command[2] = 'delivery'
        delivered = subprocess.run(command + ['--expected-current', CURRENT], cwd=self.root,
                                   capture_output=True, text=True, timeout=5)
        self.assertEqual(delivered.returncode, 0, delivered.stderr)
        self.assertEqual(json.loads(delivered.stdout),
                         {**IDENTITY, 'artifact_sha256': digest, 'status': 'published', 'expected_current': CURRENT})
        (self.root / 'api-delivery.raw.json').write_text(json.dumps(RECEIPT))
        conflict = subprocess.run(command + ['--expected-current', CURRENT], cwd=self.root,
                                  capture_output=True, text=True, timeout=5)
        self.assertNotEqual(conflict.returncode, 0)
        self.assertEqual(conflict.stdout, '')


if __name__ == '__main__':
    unittest.main()
