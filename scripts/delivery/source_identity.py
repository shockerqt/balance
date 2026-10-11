"""Verify the explicit artifact source against the packaging checkout."""
import os
import re
import subprocess


def verified_source_sha():
    expected = os.environ.get("BALANCE_SOURCE_SHA", "")
    if re.fullmatch(r"[0-9a-fA-F]{40}", expected) is None:
        raise ValueError("BALANCE_SOURCE_SHA must be a full 40-character hexadecimal SHA")
    actual = subprocess.check_output(
        ["git", "rev-parse", "HEAD"], text=True
    ).strip()
    if actual != expected.lower():
        raise ValueError("BALANCE_SOURCE_SHA does not match checkout HEAD")
    return actual
