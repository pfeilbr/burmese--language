"""Unit tests for the build pipeline's pure logic: segmentation, tone,
voicing, alignment, timing, and whole-dataset validation."""

import copy

import pytest

from conftest import build


# ── Segmentation ─────────────────────────────────────────────────────────

@pytest.mark.parametrize("text, expected", [
    ("ချစ်တယ်", ["ချစ်", "တယ်"]),
    ("ကျေးဇူးတင်ပါတယ်", ["ကျေး", "ဇူး", "တင်", "ပါ", "တယ်"]),
    # Dot-below sits before the asat in canonical order and must not split.
    ("မုန့်", ["မုန့်"]),
    # Kinzi: one written syllable that holds two spoken ones.
    ("မင်္ဂလာပါ", ["မင်္ဂ", "လာ", "ပါ"]),
    # Stacked consonant under a virama belongs to the syllable before it.
    ("ကိစ္စ", ["ကိစ္စ"]),
    # Independent vowels start a syllable of their own.
    ("နမ်းပါဦး", ["နမ်း", "ပါ", "ဦး"]),
    # Punctuation and spaces are display-only.
    ("ဟုတ်ကဲ့။", ["ဟုတ်", "ကဲ့"]),
    ("ဟုတ် ကဲ့", ["ဟုတ်", "ကဲ့"]),
])
def test_syllabify(text, expected):
    assert build.syllabify(text) == expected


# ── Tone ─────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("rom, tone", [
    ("te", 1), ("yan:", 2), ("ma.", 3), ("chiq", 4), ("", 1),
])
def test_tone_of(rom, tone):
    assert build.tone_of(rom) == tone


@pytest.mark.parametrize("chunk, tone", [
    ("ကျေး", 2),   # visarga
    ("နေ့", 3),     # dot below
    ("ချစ်", 4),    # stop final
    ("တင်", 1),     # nasal final
    ("အံ့", 3),     # dot below beats the anusvara
    ("ပြော", 2),    # bare -aw is the high tone
    ("သော်", 1),
    ("လဲ", 2),
    ("သိ", 3),      # short i is creaky
    ("ကို", 1),
    ("ပါ", 1),
    ("မ", None),    # inherent vowel: ambiguous, not checked
    ("ကိစ္စ", None),  # stacked cluster: two spoken syllables
])
def test_script_tone(chunk, tone):
    assert build.script_tone(chunk) == tone


# ── Voicing ──────────────────────────────────────────────────────────────

@pytest.mark.parametrize("rom, soft", [
    ("pa", "ba"), ("te", "de"), ("kaun:", "gaun:"), ("hkin", "gin"),
    ("kya", "gya"), ("hkya", "gya"), ("chin", "jin"), ("hsa", "za"),
    ("htaq", "daq"), ("hpyiq", "byiq"), ("tha", "dha"),
    ("sa.", "za."),
    ("ma.", None), ("la", None), ("a", None),
    ("sho.", None),   # ရှ never voices, even though it starts with "s"
])
def test_voice_onset(rom, soft):
    assert build.voice_onset(rom) == soft


def _phrase(**kw):
    base = {"id": "t", "cat": "c", "en": "Thank you", "my": "ကျေးဇူးတင်ပါတယ်",
            "rom": "kyei: zu: tin pa te", "phon": "CHAY zoo tin bah deh"}
    base.update(kw)
    return base


def test_build_syllables_applies_voicing():
    syls = build.build_syllables(_phrase(voiced=[3, 4]))
    assert [s.get("say_rom") for s in syls] == [None, None, None, "ba", "de"]
    assert [s["tone"] for s in syls] == [2, 2, 1, 1, 1]
    assert syls[3]["voiced"] and "voiced" not in syls[2]


@pytest.mark.parametrize("voiced, msg", [
    ([0], "nothing before it"),
    ([9], "out of range"),
    ([1], "no consonant that voices"),   # zu: already starts voiced
])
def test_build_syllables_rejects_bad_voicing(voiced, msg):
    with pytest.raises(ValueError, match=msg):
        build.build_syllables(_phrase(voiced=voiced))


def test_build_syllables_rejects_misalignment():
    with pytest.raises(ValueError, match="transcribed"):
        build.build_syllables(_phrase(rom="kyei: zu: tin pa"))
    with pytest.raises(ValueError, match="respelled"):
        build.build_syllables(_phrase(phon="CHAY zoo tin bah"))


def test_build_syllables_rejects_tone_contradicting_script():
    with pytest.raises(ValueError, match="written with tone 2"):
        build.build_syllables(_phrase(rom="kyei zu: tin pa te"))


# ── Timing ───────────────────────────────────────────────────────────────

def test_fit_to_audio_stretches_onto_measured_span():
    words = [{"t": 0.1, "d": 0.4, "text": "a"}, {"t": 0.5, "d": 0.5, "text": "b"}]
    fitted = build.fit_to_audio(words, 0.2, 2.0)
    assert fitted[0]["t"] == pytest.approx(0.2)
    assert fitted[-1]["t"] + fitted[-1]["d"] == pytest.approx(2.0)


def test_map_words_to_syllables_subdivides_and_pads():
    words = [{"t": 0.0, "d": 1.0, "text": "ကျေးဇူး"}]
    out = build.map_words_to_syllables(words, 3)
    assert len(out) == 3
    assert [s["t"] for s in out[:2]] == [0.0, 0.5]
    assert out[2]["t"] == pytest.approx(1.0)   # padded after the last span


# ── Dataset ──────────────────────────────────────────────────────────────

def test_source_data_is_valid(source):
    assert build.validate(source) == []


def test_validate_catches_duplicates_and_unknown_categories(source):
    cfg = copy.deepcopy(source)
    cfg["phrases"].append(dict(cfg["phrases"][0]))
    cfg["phrases"].append(dict(cfg["phrases"][1], id="new-one", cat="nope"))
    errors = "\n".join(build.validate(cfg))
    assert "duplicate id" in errors
    assert "unknown category" in errors


def test_validate_rejects_ids_that_break_audio_filenames(source):
    cfg = copy.deepcopy(source)
    cfg["phrases"][0]["id"] = "Bad.Id"
    assert any("lowercase words" in e for e in build.validate(cfg))


def test_every_category_has_phrases(source):
    used = {p["cat"] for p in source["phrases"]}
    assert [c["id"] for c in source["categories"] if c["id"] not in used] == []
