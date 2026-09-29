"""The behaviour that matters most, driven through the UI."""

import re


def cards(page):
    return page.locator(".card")


def open_phrase(page, text):
    """Search the whole library, not just the current filter, and open the hit."""
    page.click('.chip[data-cat="all"]')
    page.fill("#search", text)
    page.click(".card-open >> nth=0")


def test_boots_on_starter_set(page):
    assert page.locator('.chip[aria-pressed="true"]').get_attribute("data-cat") == "start"
    n = cards(page).count()
    assert n > 0
    assert page.locator(".list-intro").inner_text().startswith(f"{n} to learn first")


def test_stale_filter_falls_back(browser, base_url):
    ctx = browser.new_context(base_url=base_url)
    ctx.add_init_script("localStorage.setItem('sib.filter', '\"no-such-category\"')")
    pg = ctx.new_page()
    pg.goto("./")
    assert pg.locator('.chip[aria-pressed="true"]').get_attribute("data-cat") == "start"
    ctx.close()


def test_search_ignores_accents_and_escape_clears(page):
    page.click('.chip[data-cat="all"]')
    total = cards(page).count()
    page.fill("#search", "yá")
    accented = cards(page).count()
    page.fill("#search", "ya")
    assert cards(page).count() == accented > 0
    page.press("#search", "Escape")
    assert page.input_value("#search") == ""
    assert cards(page).count() == total


def test_open_phrase_and_play(page):
    open_phrase(page, "send me a photo")
    assert page.locator("#detail").is_visible()
    assert page.locator("#d-en").inner_text() == "Send me a photo"
    page.click("#play-btn")
    page.wait_for_function("document.querySelector('#play-btn').classList.contains('playing')")
    page.wait_for_function(
        "!document.querySelector('#play-btn').classList.contains('playing')", timeout=15000)


def test_stop_works_in_shadow_gap(page):
    open_phrase(page, "text me back")
    page.click("#mode-shadow")
    page.click("#play-btn")
    # Well past the clip itself, so this lands in the silent gap -- where the
    # audio element is paused but the sequence is still running.
    page.wait_for_timeout(3500)
    assert "playing" in page.get_attribute("#play-btn", "class")
    page.click("#play-btn")
    page.wait_for_timeout(300)
    assert "playing" not in page.get_attribute("#play-btn", "class")


def test_favourites_round_trip(page):
    page.click(".card-open >> nth=0")
    page.click("#fav-btn")
    page.go_back()
    assert page.locator('.chip[data-cat="fav"]').count() == 1
    page.click("#menu-btn")
    page.click("#clear-favs-btn")
    page.go_back()
    assert page.locator('.chip[data-cat="fav"]').count() == 0


def test_show_her_and_back(page):
    page.click(".card-open >> nth=0")
    page.click("#show-btn")
    assert page.locator("#present").is_visible()
    page.go_back()
    assert not page.locator("#present").is_visible()
    assert page.locator("#detail").is_visible()


def test_live_mode_moves_through_deck(page):
    page.click("#live-btn")
    first = page.inner_text("#live-en")
    count = page.inner_text("#live-count")
    assert re.fullmatch(r"1/\d+", count)
    page.click("#live-next")
    assert page.inner_text("#live-en") != first
    assert page.inner_text("#live-count").startswith("2/")


def test_ear_drill_never_repeats(page):
    page.click("#ear-btn")
    seen = []
    for _ in range(12):
        seen.append(page.inner_text("#drill-meaning"))
        page.click(".drill-choice >> nth=0")
        page.click("#drill-next")
    assert all(a != b for a, b in zip(seen, seen[1:]))


def test_service_worker_serves_audio_ranges(page):
    """Safari only plays media from a service worker if range requests get a
    real 206 -- including from the cache, which is the offline case."""
    page.wait_for_function("navigator.serviceWorker.controller", timeout=15000) \
        if page.evaluate("!!navigator.serviceWorker.controller") else None
    page.reload()
    page.wait_for_function("!!navigator.serviceWorker.controller", timeout=15000)
    result = page.evaluate("""async () => {
        const url = 'audio/hello.natural.mp3';
        const full = await fetch(url);                         // miss: fills the cache
        const size = (await full.arrayBuffer()).byteLength;
        const cached = !!(await (await caches.open('sib-audio')).match(new URL(url, location.href).href));
        const part = await fetch(url, { headers: { Range: 'bytes=0-1' } });
        const tail = await fetch(url, { headers: { Range: 'bytes=10-' } });
        return {
          size, cached,
          partStatus: part.status, partLen: (await part.arrayBuffer()).byteLength,
          partRange: part.headers.get('Content-Range'),
          tailStatus: tail.status, tailLen: (await tail.arrayBuffer()).byteLength,
        };
    }""")
    assert result["cached"]
    assert result["partStatus"] == 206 and result["partLen"] == 2
    assert result["partRange"] == f"bytes 0-1/{result['size']}"
    assert result["tailStatus"] == 206 and result["tailLen"] == result["size"] - 10


def test_send_hands_burmese_to_share_sheet(browser, base_url):
    ctx = browser.new_context(base_url=base_url)
    # Desktop Chromium has no share sheet; stand one in to see what it's given.
    ctx.add_init_script("navigator.share = async d => { window.__shared = d; };")
    pg = ctx.new_page()
    pg.goto("./")
    pg.click(".card-open >> nth=0")
    burmese = pg.inner_text("#d-my")
    pg.click("#share-btn")
    assert pg.evaluate("window.__shared") == {"text": burmese}
    ctx.close()


def test_send_hidden_without_share_sheet(page):
    page.click(".card-open >> nth=0")
    assert not page.locator("#share-btn").is_visible()


def test_review_page_marks_and_reports(browser, base_url):
    ctx = browser.new_context(base_url=base_url)
    errors = []
    pg = ctx.new_page()
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("./")
    pg.click("#menu-btn")
    pg.click("#review-link")
    pg.wait_for_selector(".item")
    total = pg.locator(".item").count()
    assert pg.inner_text("#count").startswith(f"0 of {total} checked")

    first, second = pg.locator(".item").nth(0), pg.locator(".item").nth(1)
    first.locator('[data-v="ok"]').click()
    second.locator('[data-v="fix"]').click()
    second.locator(".fix-note").fill("should be X")
    assert pg.inner_text("#count").startswith(f"2 of {total} checked · 1 to fix")

    # Survives a reload, and "only unchecked" hides what's done.
    pg.reload()
    assert pg.inner_text("#count").startswith(f"2 of {total} checked")
    pg.check("#only-todo")
    assert pg.locator(".item").count() == total - 2

    ctx.add_init_script("navigator.share = async d => { window.__shared = d; };")
    pg.reload()
    pg.click("#send-report")
    text = pg.evaluate("window.__shared.text")
    second_id = pg.evaluate("Object.entries(JSON.parse(localStorage.getItem('sib.review'))).find(([,m]) => m.v === 'fix')[0]")
    assert f"[{second_id}]" in text and "fix: should be X" in text
    assert "2 of" in text and "1 to fix" in text
    ctx.close()
    assert not errors, errors


def test_search_finds_chat_spelling(page):
    """Chat romanisations live in the notes; pasting one should find the phrase."""
    page.click('.chip[data-cat="all"]')
    page.fill("#search", "nan chin tel")
    assert page.locator(".card-en").all_inner_texts() == ["I want to kiss you"]
