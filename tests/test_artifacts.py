"""The generated files are committed, so they can drift from the source if
someone edits data/phrases.json and forgets to run the build. These catch that
before it ships."""

from conftest import ROOT, build

FIELDS = ("id", "cat", "en", "my", "rom", "phon", "note", "starter")


def test_generated_data_matches_source(source, generated):
    assert generated["categories"] == source["categories"]
    assert generated["tracks"] == source["tracks"]
    src = [{k: p.get(k) for k in FIELDS} for p in source["phrases"]]
    gen = [{k: p.get(k) for k in FIELDS} for p in generated["phrases"]]
    assert gen == src, "web/data/phrases.js is stale -- run ./scripts/build.py"


def test_generated_syllables_match_source(source, generated):
    by_id = {p["id"]: p for p in generated["phrases"]}
    for p in source["phrases"]:
        assert by_id[p["id"]]["syllables"] == build.build_syllables(p), p["id"]


def test_every_phrase_has_audio_and_timing(generated):
    audio = ROOT / "web" / "audio"
    for p in generated["phrases"]:
        n = len(p["syllables"])
        for track in generated["tracks"]:
            assert (audio / f"{p['id']}.{track}.mp3").is_file(), f"{p['id']}.{track}.mp3"
            assert len(p["timing"][track]) == n, p["id"]
            assert p["end"][track] > 0, p["id"]


def test_no_orphaned_audio(source):
    orphans = build.orphaned_audio({p["id"] for p in source["phrases"]})
    assert orphans == [], "run ./scripts/build.py --prune"
