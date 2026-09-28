"""Browser tests against the real site, served from web/ exactly as deployed.

Kept apart from tests/ because they need a browser: run them with
    uv run --with pytest --with playwright==1.56.0 pytest -q e2e
(`playwright install chromium` once, if you don't already have one)."""

import functools
import http.server
import threading
from pathlib import Path

import pytest
from playwright.sync_api import sync_playwright

WEB = Path(__file__).resolve().parent.parent / "web"


class _Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


@pytest.fixture(scope="session")
def base_url():
    handler = functools.partial(_Quiet, directory=str(WEB))
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{server.server_address[1]}/"
    server.shutdown()


@pytest.fixture(scope="session")
def browser():
    with sync_playwright() as p:
        # Autoplay would otherwise need a real user gesture for every play().
        b = p.chromium.launch(args=["--autoplay-policy=no-user-gesture-required"])
        yield b
        b.close()


@pytest.fixture
def page(browser, base_url):
    """A fresh page -- its own storage, no service worker yet -- that fails
    the test on any uncaught error or console error."""
    ctx = browser.new_context(base_url=base_url)
    pg = ctx.new_page()
    errors = []
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.on("console", lambda m: m.type == "error" and errors.append(m.text))
    pg.goto("./")
    yield pg
    ctx.close()
    assert not errors, f"page errors: {errors}"
