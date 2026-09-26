"""Shared fixtures. build.py is a uv script rather than a package, so it is
loaded by path."""

import importlib.util
import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent

_spec = importlib.util.spec_from_file_location("build", ROOT / "scripts" / "build.py")
build = importlib.util.module_from_spec(_spec)
sys.modules["build"] = build
_spec.loader.exec_module(build)


@pytest.fixture(scope="session")
def source() -> dict:
    return json.loads((ROOT / "data" / "phrases.json").read_text())


@pytest.fixture(scope="session")
def generated() -> dict:
    """The payload the front-end actually loads."""
    text = (ROOT / "web" / "data" / "phrases.js").read_text()
    start = text.index("window.PHRASE_DATA = ") + len("window.PHRASE_DATA = ")
    return json.loads(text[start:].rstrip().rstrip(";"))
