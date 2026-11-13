#!/usr/bin/env python3
"""Bind API promotion envelopes to the selected build and actual host evidence."""
import argparse
import gzip
import hashlib
import io
import json
from pathlib import Path
import re
import sys
import tarfile

MAX_ARCHIVE = 100 * 1024 * 1024
MAX_JSON = 32768
SHA = re.compile(r'[0-9a-f]{40}')
DIGEST = re.compile(r'[0-9a-f]{64}')
RUN_ID = re.compile(r'[1-9][0-9]{0,19}')


def bounded_read(path, limit):
    with Path(path).open('rb') as stream:
        data = stream.read(limit + 1)
    if len(data) > limit:
        raise ValueError('Input exceeds size limit')
    return data


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('Duplicate JSON key')
        result[key] = value
    return result


def reject_constant(value):
    raise ValueError(f'Invalid JSON constant: {value}')


def document(data):
    if len(data) > MAX_JSON:
        raise ValueError('JSON exceeds size limit')
    value = json.loads(data, object_pairs_hook=unique_object,
                       parse_constant=reject_constant)
    if not isinstance(value, dict):
        raise ValueError('Expected JSON object')
    return value


def token(value, pattern, label):
    if not isinstance(value, str) or not pattern.fullmatch(value):
        raise ValueError(f'Invalid {label}')
    return value


def run_id(value):
    # bool is an int subclass; accepting it would bind true to run 1.
    if type(value) is int:
        value = str(value)
    return token(value, RUN_ID, 'build run ID')


def expected_current(value):
    if value == 'none':
        return value
    return token(value, SHA, 'expected current')


def artifact_identity(archive_path, digest_path, build, selected_run):
    selected_run = run_id(selected_run)
    source = token(build.get('head_sha'), SHA, 'build source')
    if run_id(build.get('id')) != selected_run:
        raise ValueError('Selected build run mismatch')
    digest_line = bounded_read(digest_path, 128).decode('ascii')
    if not re.fullmatch(r'[0-9a-f]{64}  api\.tar\.gz\n?', digest_line):
        raise ValueError('Invalid artifact digest manifest')
    digest = digest_line[:64]
    data = bounded_read(archive_path, MAX_ARCHIVE)
    if hashlib.sha256(data).hexdigest() != digest:
        raise ValueError('Artifact digest mismatch')
    with gzip.GzipFile(fileobj=io.BytesIO(data)) as compressed:
        expanded = compressed.read(MAX_ARCHIVE + 1)
    if len(expanded) > MAX_ARCHIVE:
        raise ValueError('Expanded archive exceeds limit')
    with tarfile.open(fileobj=io.BytesIO(expanded), mode='r:') as archive:
        members = archive.getmembers()
        if len(members) != 2 or {m.name for m in members} != {'server', 'api-release.json'}:
            raise ValueError('Unexpected or duplicate archive members')
        if any(not m.isfile() or m.linkname or m.issparse() or m.size < 0
               or m.size > MAX_ARCHIVE for m in members):
            raise ValueError('Unsafe archive member')
        member = archive.getmember('api-release.json')
        if member.size > MAX_JSON:
            raise ValueError('Metadata exceeds limit')
        with archive.extractfile(member) as stream:
            metadata = document(stream.read(MAX_JSON + 1))
    if token(metadata.get('source_sha'), SHA, 'metadata source') != source:
        raise ValueError('Artifact source mismatch')
    if run_id(metadata.get('run_id')) != selected_run:
        raise ValueError('Artifact build run mismatch')
    return {'source_sha': source, 'build_run_id': selected_run, 'artifact_sha256': digest}


def normalize_plan(identity, plan, approved_current=None):
    if (plan.get('status') != 'plan' or plan.get('schema_compatible') is not True
            or plan.get('source_sha') != identity['source_sha']
            or plan.get('artifact_sha256') != identity['artifact_sha256']):
        raise ValueError('Host plan does not match compatible artifact')
    if 'current' not in plan:
        raise ValueError('Host plan missing current')
    current = plan['current']
    if current is None:
        observed = 'none'
    elif isinstance(current, dict):
        observed = token(current.get('source_sha'), SHA, 'host current source')
    else:
        raise ValueError('Invalid host current')
    if approved_current is not None and expected_current(approved_current) != observed:
        raise ValueError('Approved current differs from observed host current')
    return {**identity, 'status': 'plan', 'schema_compatible': True, 'expected_current': observed}


def normalize_delivery(identity, plan, receipt, approved_current):
    validated = normalize_plan(identity, plan, expected_current(approved_current))
    if (receipt.get('status') != 'published'
            or receipt.get('source_sha') != identity['source_sha']
            or receipt.get('artifact_sha256') != identity['artifact_sha256']
            or run_id(receipt.get('run_id')) != identity['build_run_id']):
        raise ValueError('Host receipt does not match published artifact')
    # Idempotent receipts retain an earlier invocation's previous state. The
    # validated predeploy observation, approved above, binds THIS invocation.
    return {**identity, 'status': 'published', 'expected_current': validated['expected_current']}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['artifact', 'plan', 'delivery'])
    parser.add_argument('--archive', default='api.tar.gz')
    parser.add_argument('--digest-file', default='api.sha256')
    parser.add_argument('--build-run', default='build-run.json')
    parser.add_argument('--build-run-id', required=True)
    parser.add_argument('--plan', default='api-plan.raw.json')
    parser.add_argument('--receipt', default='api-delivery.raw.json')
    parser.add_argument('--expected-current')
    args = parser.parse_args()
    try:
        build = document(bounded_read(args.build_run, MAX_JSON))
        identity = artifact_identity(args.archive, args.digest_file, build, args.build_run_id)
        if args.command == 'artifact':
            print(identity['artifact_sha256'])
            return
        plan = document(bounded_read(args.plan, MAX_JSON))
        if args.command == 'plan':
            output = normalize_plan(identity, plan, args.expected_current)
        else:
            if args.expected_current is None:
                raise ValueError('Delivery requires approved expected current')
            receipt = document(bounded_read(args.receipt, MAX_JSON))
            output = normalize_delivery(identity, plan, receipt, args.expected_current)
        print(json.dumps(output, sort_keys=True))
    except (ValueError, OSError, EOFError, tarfile.TarError, RecursionError) as error:
        parser.exit(1, f'Promotion evidence rejected: {error}\n')


if __name__ == '__main__':
    main()
