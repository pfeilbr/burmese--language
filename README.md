# Say It In Burmese

An in-ear phrase prompter for speaking Burmese to someone you actually live with.

Pick an English phrase, hear it spoken in Burmese at whatever speed you need, say it
back. Built for the case where you have AirPods in, your phone is in your pocket, and
your partner is in the next room.

**Live app:** https://pfeilbr.github.io/burmese--language/

It is a direct sibling of [Say It In Mandarin][mandarin] — same shape, same
interaction model, same build pipeline — retargeted at a language that works
very differently, which is where all the interesting differences are.

## Install it on your phone

Open the link in **Safari** on iPhone, tap the Share button, and choose
**Add to Home Screen**. It then launches full screen with no browser chrome.

Open the **☰ menu → Offline audio → Save all audio** once, and it works with no
signal at all.

(On Android or desktop Chrome the menu offers a one-tap **Install** button
instead. iOS has no programmatic install — Safari's Share sheet is the only
route — so the app just tells you where to tap.)

## What it does

- **Live mode** — the one built for actually being in front of her. See below.
- **144 phrases** across affection, sweet talk, dating and flirting, getting
  serious, comforting her, texts and voice notes, meeting the family, occasions
  and blessings, the tea shop, meals, coming and going, checking in, chores, and
  the "I'm still learning, say it slower" repair kit.
- **Record yourself and hear it back** against the native clip, so you don't
  drill a wrong tone in without noticing.
- **Continuous speed control**, 40% to 110% of native pace.
- **Written in English you can just read.** Every phrase is respelled
  syllable-by-syllable the way it actually sounds — `CHAY zoo tin bah deh`,
  with CAPITALS marking the stressed syllable. The Burmese script and the
  transcription are both off by default: two spellings you can't read yet are
  noise around the one line you're trying to say. Turn either back on in
  Settings.
- **Tone colouring and contour marks** on every syllable, riding on the English
  respelling so they work with both scripts hidden.
- **Softened consonants are marked.** Where a syllable's opening consonant
  voices because of the one before it, it's underlined and explained — see
  [below](#the-thing-that-most-gives-a-learner-away).
- **Tap any syllable** to hear just that sound, in its real phrase context.
- **Syllable mode** steps through one sound at a time.
- **Shadow mode** plays the phrase, leaves a silent gap for you to say it out loud,
  then plays it again — indefinitely. This is the one to use with AirPods in.
- **Lock-screen and AirPods controls.** Squeeze the stem to replay without taking
  your phone out.
- **Favourites** and search across English, the transcription, and the Burmese.
- **Settings** (☰): install, updates, offline audio and storage, and display
  toggles.

## Live mode

Everything else in this app is for practising. Live mode is for the moment
itself: AirPods in, phone in a pocket, someone in front of you. It is built so
that using it doesn't read as using it.

- **The stem drives it.** Squeeze to hear the line again, double-squeeze for the
  next one. The phone never comes out. This is the whole feature — the rest is
  support for it.
- **The lock screen carries the line.** The English and the respelling go into
  the media metadata, so glancing at a dark phone looks like checking what track
  is playing, and you can read the line off it without unlocking anything.
- **Rehearse** plays the line, leaves a beat for you to murmur it back, then
  plays it once more. The version you say out loud is your second attempt, not
  your first.
- **Decks** are the queue: your saved phrases, your recent ones, or any
  category. Switching deck is one tap.
- **Dim** takes the screen to almost nothing, for when the phone is face-up on
  the table between you. The first tap brings it back rather than firing
  whatever was under your finger.
- **Swipe** the card to move through the deck; tap it to play. The "Say it"
  button is 78px tall and the full width of the screen, because it gets hit
  without looking.
- A **wake lock** keeps the screen alive while it's open. Unlocking a phone to
  find your next line is the tell.

`?live=1` opens it directly, and `&deck=dating` picks the deck — which is what
makes it bindable to Back Tap or the Action Button through a Shortcut.

## The four tones

Burmese tone is about length and how a syllable *ends* at least as much as
about pitch, which is why the contour marks look different from a Mandarin
app's:

| | | sounds like |
|---|---|---|
| 1 | **level** | level and unhurried, medium length — the plain one |
| 2 | **falling** | long and heavy, starting high and falling away, often breathy |
| 3 | **sharp** | short and high, snapped off with a catch in the throat |
| 4 | **stopped** | clipped dead by a glottal stop, with no vowel left to hear |

The transcription marks three of the four with a trailing symbol, the way
pinyin marks tone with a diacritic — `:` high, `.` creaky, `q` checked, nothing
for low. Tone numbers are derived from those marks at build time.

## The thing that most gives a learner away

Burmese softens the consonant at the front of a syllable when the syllable
before it runs on into it. ကျေးဇူးတင်ပါတယ် is written *kyei: zu: tin **pa te***
and said *kyei: zu: tin **ba de***. Reading the written form out loud is
instantly recognisable as someone reading off a page, and it happens in roughly
two thirds of the phrases here.

So the app treats it the way the Mandarin app treats third-tone sandhi: the
citation form is kept, the spoken form is what gets shown, and the syllables
that shift are underlined with a note explaining why.

Where it applies is **lexically conditioned** — it depends on how tightly two
words bind, not just on what sounds meet — so a blanket rule would get a good
fraction of phrases audibly wrong. The positions are therefore written down
per phrase in `data/phrases.json` (`"voiced": [3, 4]`) and only the mapping
itself is automatic. The build rejects an index that points at a syllable with
no consonant to soften.

## Checking your pronunciation

The phrase screen has **Record yourself**; when you stop, it plays the native
clip and your attempt back to back. Listen to the *length and the ending* of
each syllable — level, falling away, snapped short, or stopped dead.

It's a plain A/B rather than speech recognition on purpose: `SpeechRecognition`
is unreliable-to-absent in iOS Safari, which is the one browser this has to work
in, and has no meaningful Burmese model in any browser. Recordings live in
memory for the session only, and the mic stream is released the moment you
stop — iOS keeps showing the in-use indicator otherwise.

## A note on the phrase content

**The phrases have not been checked by a native speaker.** That matters more
here than it would for a bigger language: Burmese has far less material to
cross-check against, and the app is confident-looking in a way that the content
has not earned. Getting a Burmese speaker to read the list out loud is the
single highest-value change available to this project.

Specific things worth confirming before you lean on them:

- **Register.** Burmese marks politeness heavily, and the line between warm and
  presumptuous moves with who you're speaking to. The family phrases lean
  formal on purpose; the affection, dating and getting-serious ones assume a
  partner, and several of them use မင်း — the blunt-informal "you", which is
  normal between people who are close and rude to anyone older. If in doubt,
  drop the pronoun; Burmese does it constantly and none of these phrases need
  it.
- **Gendered forms.** "I" is ကျွန်တော် for a man and ကျွန်မ for a woman, and the
  polite sentence tag is ခင်ဗျာ for a man and ရှင် for a woman. The phrases here
  are written for a **male speaker**. Most of the time the pronoun is dropped
  entirely, which sidesteps the issue.
- **မင်္ဂလာပါ** is taught in every school and used in every speech, but it is
  stiffer in daily life than a phrasebook suggests. The everyday greeting is
  ထမင်းစားပြီးပြီလား — "have you eaten?" — which is in the app under Food.
- **The transcription** is a practical one, close to how Burmese names are
  spelled in English, plus explicit tone marks. It is not MLCTS, which
  transliterates the spelling rather than the sound and is close to useless for
  reading aloud.

## Burmese script

The app ships **Noto Sans Myanmar** rather than relying on the device. Windows
has no Myanmar font at all, older Androids draw Burmese as empty boxes, and a
large number of phones in Myanmar still carry a **Zawgyi** font, which maps the
same Unicode code points to different letters. Leaving it to the system means
the one line the other person is supposed to read is a coin toss.

The font is precached by the service worker for the same reason the audio is.
The `@font-face` declares a `unicode-range` covering only Burmese, so it leads
the body font stack without pulling any Latin text into it.

## Updates

The app checks for a new version on launch and offers it rather than applying it
silently: you get an **Update available** prompt with *Update* and *Later*. You
can also check by hand from **☰ menu → Updates**. Accepting swaps in the new
version and reloads; the downloaded audio is kept, so an update never costs you
the 4.9 MB again.

The mechanics are worth knowing if you change the deploy:

- The service worker deliberately does **not** call `skipWaiting()` on install.
  A new version parks in `waiting` until you accept it, so the app can't swap
  itself out mid-sentence. Accepting posts `SKIP_WAITING` and reloads.
- The deploy workflow stamps the commit SHA into `sw.js`. This is load-bearing:
  browsers decide an update exists by byte-comparing that one file, so without
  the stamp an unchanged `sw.js` would hide new versions no matter what else
  changed.
- Registration uses `updateViaCache: 'none'`, otherwise the browser may serve
  `sw.js` from its HTTP cache and miss updates for up to 24 hours.

## Audio

Every clip is pre-rendered to MP3 at two speaking rates by Microsoft's neural
Burmese voice (`my-MM-NilarNeural`) via [`edge-tts`][edge-tts] — free, and no
API key or account. (`my-MM-ThihaNeural` is the male voice, if you'd rather hear
that; change `voice` in `data/phrases.json` and rebuild with `--force`.)

Pre-rendering rather than synthesising in the browser is a deliberate choice.
The Web Speech API is the obvious shortcut, but it has no Burmese voice at all
on iOS, and shipping audio files also means correct AirPods routing, real
lock-screen controls, and genuine offline use.

The build measures each rendered clip to find where the speech actually starts
and stops, and stretches the TTS's reported word timings onto that. This is not
a refinement — the TTS under-reports its own durations, much worse at the slow
rate, and worst on the stacked clusters: it claims မင်္ဂလာပါ ends at 1.05s when
the voice is still going at 1.61s. Trusting it cut the last syllable off a quarter of
the clips, on the track a learner actually uses.

The **slow** track is synthesised at `-45%`, so the voice genuinely enunciates more
carefully rather than just being stretched. The speed slider picks whichever track
is closer to the requested pace and covers the remainder with `playbackRate`, with
`preservesPitch` on throughout — pitch is meaning in Burmese, so tone contours
must survive any speed change.

## Adding or changing phrases

1. Edit [`data/phrases.json`](data/phrases.json).
2. Run the build:

   ```sh
   ./scripts/build.py          # renders only what's missing
   ./scripts/build.py --force  # re-renders everything
   ./scripts/build.py --check  # validates the data, no network
   ```

3. Commit. Pushing to the default branch redeploys the site.

An entry looks like this:

```json
{
  "id": "thank-you",
  "cat": "compliments",
  "en": "Thank you",
  "my": "ကျေးဇူးတင်ပါတယ်",
  "rom": "kyei: zu: tin pa te",
  "phon": "CHAY zoo tin bah deh",
  "voiced": [3, 4],
  "note": "The two softened sounds at the end are not optional."
}
```

`my`, `rom` and `phon` must line up **one chunk per written syllable** — the
build fails loudly if they don't. That check is deliberate: a silent
misalignment would attach the wrong tone and the wrong pronunciation to every
later syllable in the phrase, which is exactly the kind of error that teaches
you to say something wrong without ever noticing.

- `my` — the Burmese, in ordinary orthography with no added spaces. Burmese is
  written without word breaks, so the build cuts it into syllables itself (see
  below). Run `--check` and it will print the split it got if the counts
  disagree.
- `rom` — the transcription, one space-separated chunk per written syllable, in
  **citation** form: write each syllable as it is on its own and let `voiced`
  handle the softening. Tone is carried by the trailing mark: `:` high, `.`
  creaky, `q` checked, nothing for low.
- `phon` — the English respelling, and the line the app shows biggest, because
  it's the one that gets read out loud. One chunk per syllable, written as
  actually **spoken** (softening included). Capitalise the syllable that takes
  the stress. Spell for an English reader who has never seen a transcription:
  `chay` not `kyei:`, `bike` not `baiq`.
- `voiced` — optional; indices of syllables whose opening consonant softens.
- A few written syllables are stacked clusters holding two spoken ones —
  မင်္ဂ is `min-ga`. Hyphenate them so they stay one chunk. The ear-training
  drill skips them, since "which tone is this?" has no single answer for a
  chunk with two.

### Syllable segmentation

`scripts/build.py` splits Burmese into syllables with a rule that is short but
not obvious: a syllable starts at a consonant, unless that consonant carries
the asat ် (it is closing the previous syllable) or is stacked under the one
before with the virama ္. The trap is the dot-below ့, which sits *before* the
asat in canonical order — so မုန့် is `မ ု န ့ ်` and a naive "is the next
character an asat?" test sees the dot, misses the asat, and splits one syllable
into two.

## Deploying your own copy

The site is static and pre-built, so the deploy just uploads `web/` as-is.
Two things need doing once on a fresh repository:

1. **Settings → Pages → Build and deployment → Source: GitHub Actions.** Until
   this is set, the deploy fails at `configure-pages` with *"Get Pages site
   failed: Not Found"*. It cannot be automated from inside the workflow — the
   default workflow token is not allowed to administer the repository.
2. Push to the default branch. The workflow deploys whatever is on it, so it
   keeps working if that branch is later renamed.

## Layout

```
data/phrases.json      source of truth — the only file you edit to add phrases
scripts/build.py       renders MP3s + timings, emits web/data/phrases.js
scripts/make_icons.py  regenerates the PWA icons
web/                   the deployed site (static, no build step, no dependencies)
  audio/               pre-rendered clips, two rates per phrase
  fonts/               Noto Sans Myanmar, shipped rather than assumed
  data/phrases.js      generated — do not edit by hand
```

Requires [`uv`](https://docs.astral.sh/uv/) to run the build scripts; the site
itself has no dependencies and no build step.

[edge-tts]: https://github.com/rany2/edge-tts
[mandarin]: https://github.com/pfeilbr/chinese-mandarin-language-app
