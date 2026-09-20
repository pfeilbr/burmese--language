#!/usr/bin/env -S uv run --with edge-tts --script
"""
Renders every phrase in data/phrases.json to MP3 at two speaking rates using
Microsoft's neural Burmese voices (via edge-tts -- free, no API key), captures
per-word timing data, and emits web/data/phrases.js for the front-end.

Usage:
    ./scripts/build.py              # only render what's missing
    ./scripts/build.py --force      # re-render everything
"""

import argparse
import asyncio
import json
import re
import sys
from pathlib import Path

import edge_tts

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "data" / "phrases.json"
AUDIO_DIR = ROOT / "web" / "audio"
OUT_JS = ROOT / "web" / "data" / "phrases.js"

CONCURRENCY = 6

# ── Burmese syllable segmentation ────────────────────────────────────────
#
# Burmese is written without spaces between words, so the phrase has to be cut
# into syllables here rather than read off the source text. A syllable starts
# at a consonant, except where that consonant is a final (carries the asat ်)
# or is stacked under the previous one (virama ္) -- in both cases it closes
# the syllable already in progress instead of opening a new one.
#
# The dot-below ့ needs its own mention: in canonical order it sits *before*
# the asat, so မုန့် is မ ု န ့ ် and a naive "is the next character an asat?"
# lookahead sees the dot, misses the asat, and splits မုန့် into two.

MY_CONSONANT = "က-အ"        # က-အ
STANDALONE = "ဣ-ဧဩဪဿ"   # independent vowels, great sa
DIGITS = "၀-၉"
PUNCT = "၊။,.?!"            # ၊ ။ -- display only, never sounded
ASAT = "်"
VIRAMA = "္"
DOT_BELOW = "့"

SYLLABLE_START = re.compile(
    f"((?<!{VIRAMA})[{MY_CONSONANT}](?!{DOT_BELOW}?[{ASAT}{VIRAMA}])"
    f"|[{STANDALONE}{DIGITS}a-zA-Z])"
)


def syllabify(text: str) -> list[str]:
    """Split Burmese text into written syllables. Punctuation and spaces are
    display-only and never come back as syllables."""
    marked = SYLLABLE_START.sub("\u0001\\1", text)
    out = []
    for chunk in marked.split("\u0001"):
        chunk = "".join(c for c in chunk if c not in PUNCT).strip()
        if chunk:
            out.append(chunk)
    return out


# ── Tone ─────────────────────────────────────────────────────────────────
#
# Burmese has four tones, and the transcription marks three of them with a
# trailing symbol, the way pinyin marks tone with a diacritic:
#
#   (none)  1  low      level, medium length            nei   "day"
#   :       2  high     starts high and falls, long     nei:  "near"
#   .       3  creaky   short and sharp, snapped off    nei.  "stay"
#   q       4  checked  clipped by a glottal stop       neiq  "press"
#
# Deriving the tone from the transcription rather than from the Burmese script
# is deliberate: the script encodes tone across several different mechanisms
# (bare form, visarga း, dot-below ့, killed final consonant), and reading it
# back out correctly is harder than writing the tone down once, in the one
# field a learner is going to read anyway.

TONE_SUFFIX = {":": 2, ".": 3, "q": 4}


def tone_of(syllable: str) -> int:
    return TONE_SUFFIX.get(syllable[-1:], 1) if syllable else 1


# ── Juncture voicing ─────────────────────────────────────────────────────
#
# Burmese softens the consonant at the front of a syllable when it runs on from
# the one before: ကျေးဇူးတင်ပါတယ် is said "...tin ba de", never "...tin pa te".
# It is the single biggest gap between how Burmese is written and how it is
# said, and a learner who reads the citation form off the page is immediately
# audibly wrong.
#
# Where it applies is lexically conditioned -- a blanket rule gets a good
# fraction of phrases wrong -- so this is driven by the `voiced` list in the
# source data rather than guessed. The mapping itself is regular, so only the
# *positions* have to be written down.

VOICING = [
    ("hky", "gy"), ("ky", "gy"), ("ch", "j"),
    ("hk", "g"), ("hs", "z"), ("ht", "d"), ("hp", "b"),
    ("th", "dh"),
    ("k", "g"), ("s", "z"), ("t", "d"), ("p", "b"),
]


def voice_onset(rom: str) -> str | None:
    """Soften a syllable's initial consonant. None if nothing there voices."""
    for hard, soft in VOICING:
        if rom.startswith(hard):
            return soft + rom[len(hard):]
    return None


def apply_voicing(syllables: list[dict], positions: list[int], pid: str) -> None:
    """Record the spoken form in `say_rom` and keep the citation form in `rom`,
    mirroring how the tone fields work."""
    for i in positions:
        if not 0 <= i < len(syllables):
            raise ValueError(
                f"[{pid}] voiced index {i} is out of range "
                f"(phrase has {len(syllables)} syllables)"
            )
        if i == 0:
            raise ValueError(f"[{pid}] syllable 0 has nothing before it to voice after")
        soft = voice_onset(syllables[i]["rom"])
        if soft is None:
            raise ValueError(
                f"[{pid}] syllable {i} ({syllables[i]['rom']!r}) has no consonant "
                "that voices -- write it in its citation form, or drop the index"
            )
        syllables[i]["say_rom"] = soft
        syllables[i]["voiced"] = True


def build_syllables(phrase: dict) -> list[dict]:
    """Zip the Burmese script against the transcription and the English
    respelling. Mismatches are a hard error -- a silent misalignment would
    attach the wrong tone and the wrong pronunciation to every later syllable
    in the phrase."""
    chars = syllabify(phrase["my"])
    roms = phrase["rom"].split()
    phons = phrase.get("phon", "").split()
    if len(chars) != len(roms):
        raise ValueError(
            f"[{phrase['id']}] {len(chars)} written syllables but {len(roms)} transcribed\n"
            f"    my:  {phrase['my']}  -> {' · '.join(chars)}\n"
            f"    rom: {phrase['rom']}"
        )
    if len(phons) != len(chars):
        raise ValueError(
            f"[{phrase['id']}] {len(chars)} syllables but {len(phons)} respelled\n"
            f"    my:   {phrase['my']}\n"
            f"    phon: {phrase.get('phon', '')}\n"
            "    The respelling is what gets read aloud, so it needs one\n"
            "    space-separated chunk per syllable."
        )
    syllables = [
        {"my": c, "rom": r, "tone": tone_of(r), "say": s}
        for c, r, s in zip(chars, roms, phons)
    ]
    apply_voicing(syllables, phrase.get("voiced", []), phrase["id"])
    return syllables


async def render(text: str, voice: str, rate: str, out_path: Path) -> list[dict]:
    """Synthesize to MP3, returning word-level timings in seconds."""
    comm = edge_tts.Communicate(text, voice, rate=rate, boundary="WordBoundary")
    audio = bytearray()
    words: list[dict] = []
    async for chunk in comm.stream():
        if chunk["type"] == "audio":
            audio.extend(chunk["data"])
        elif chunk["type"] == "WordBoundary":
            words.append(
                {
                    "t": round(chunk["offset"] / 1e7, 3),
                    "d": round(chunk["duration"] / 1e7, 3),
                    "text": chunk["text"],
                }
            )
    if not audio:
        raise RuntimeError(f"no audio returned for {text!r} @ {rate}")
    out_path.write_bytes(bytes(audio))
    return words


def map_words_to_syllables(words: list[dict], n_syllables: int) -> list[dict]:
    """Burmese is written without word spaces, so the TTS segmenter usually
    hands back whole words -- and often the whole phrase as a single span.
    Subdivide each span evenly across the syllables it covers so every syllable
    gets its own time range, which is what tap-a-syllable and syllable-by-
    syllable stepping need.

    Even subdivision is an approximation. It is a better one in Burmese than it
    looks: the checked tone is genuinely much shorter than the other three, so
    the boundaries drift inside a span. They are accurate to roughly 100ms,
    which is fine for highlighting and for hearing a sound in context, and is
    why the ear-training drill plays the whole phrase rather than a slice.

    Returns one entry per syllable: {t, d, word} where `word` groups syllables
    the segmenter considered a single word.
    """
    out: list[dict] = []
    cursor = 0
    for word_index, w in enumerate(words):
        length = len(syllabify(w["text"]))
        if length == 0 or cursor >= n_syllables:
            continue
        length = min(length, n_syllables - cursor)
        step = w["d"] / length
        for k in range(length):
            out.append(
                {
                    "t": round(w["t"] + k * step, 3),
                    "d": round(step, 3),
                    "word": word_index,
                }
            )
        cursor += length

    # Any syllable the segmenter never reported still needs a slot.
    while len(out) < n_syllables:
        last = out[-1] if out else {"t": 0.0, "d": 0.3, "word": 0}
        out.append({"t": round(last["t"] + last["d"], 3), "d": last["d"], "word": last["word"]})
    return out[:n_syllables]


async def process(phrase: dict, cfg: dict, force: bool, sem: asyncio.Semaphore) -> dict:
    syllables = build_syllables(phrase)
    out = {
        "id": phrase["id"],
        "cat": phrase["cat"],
        "en": phrase["en"],
        "my": phrase["my"],
        "rom": phrase["rom"],
        "phon": phrase.get("phon", ""),
        "syllables": syllables,
        "timing": {},
    }
    if phrase.get("note"):
        out["note"] = phrase["note"]
    if phrase.get("starter") is not None:
        out["starter"] = phrase["starter"]

    async with sem:
        for track, rate in cfg["tracks"].items():
            mp3 = AUDIO_DIR / f"{phrase['id']}.{track}.mp3"
            cache = AUDIO_DIR / f"{phrase['id']}.{track}.json"
            if mp3.exists() and cache.exists() and not force:
                words = json.loads(cache.read_text())
            else:
                words = await render(phrase["my"], cfg["voice"], rate, mp3)
                cache.write_text(json.dumps(words, ensure_ascii=False))
                print(f"  ✓ {phrase['id']}.{track}", flush=True)
            out["timing"][track] = map_words_to_syllables(words, len(syllables))
    return out


async def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true", help="re-render existing audio")
    ap.add_argument("--check", action="store_true", help="validate only, no network")
    args = ap.parse_args()

    cfg = json.loads(SRC.read_text())
    AUDIO_DIR.mkdir(parents=True, exist_ok=True)
    OUT_JS.parent.mkdir(parents=True, exist_ok=True)

    # Validate every phrase up front so a typo fails fast, before any network work.
    errors = []
    seen = set()
    cat_ids = {c["id"] for c in cfg["categories"]}
    for p in cfg["phrases"]:
        try:
            build_syllables(p)
        except ValueError as e:
            errors.append(str(e))
        if p["id"] in seen:
            errors.append(f"[{p['id']}] duplicate id")
        seen.add(p["id"])
        if p["cat"] not in cat_ids:
            errors.append(f"[{p['id']}] unknown category {p['cat']!r}")
    starters = sorted(p["starter"] for p in cfg["phrases"] if p.get("starter") is not None)
    if starters != list(range(1, len(starters) + 1)):
        errors.append(f"starter numbers must run 1..n with no gaps or repeats, got {starters}")
    if errors:
        print("Validation failed:\n" + "\n".join(errors), file=sys.stderr)
        return 1
    if args.check:
        print(f"OK — {len(cfg['phrases'])} phrases, "
              f"{sum(len(build_syllables(p)) for p in cfg['phrases'])} syllables aligned.")
        return 0

    print(f"Rendering {len(cfg['phrases'])} phrases x {len(cfg['tracks'])} rates "
          f"as {cfg['voice']}...")
    sem = asyncio.Semaphore(CONCURRENCY)
    phrases = await asyncio.gather(
        *(process(p, cfg, args.force, sem) for p in cfg["phrases"])
    )

    payload = {
        "voice": cfg["voice"],
        "tracks": cfg["tracks"],
        "categories": cfg["categories"],
        "phrases": list(phrases),
    }
    OUT_JS.write_text(
        "// Generated by scripts/build.py -- do not edit by hand.\n"
        "window.PHRASE_DATA = "
        + json.dumps(payload, ensure_ascii=False, indent=1)
        + ";\n"
    )

    total_mb = sum(f.stat().st_size for f in AUDIO_DIR.glob("*.mp3")) / 1e6
    print(f"\nDone. {len(phrases)} phrases, {total_mb:.1f} MB of audio.")
    print(f"Wrote {OUT_JS.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
