/* Say It In Burmese — phrase prompter for spoken practice. */

(() => {
'use strict';

const DATA = window.PHRASE_DATA;
const BY_ID = new Map(DATA.phrases.map(p => [p.id, p]));
const CATS  = new Map(DATA.categories.map(c => [c.id, c]));

/* Two rendered tracks exist: `natural` (+0%) and `slow` (-45%, where the voice
   actually enunciates more carefully rather than just stretching). The speed
   slider is continuous, so we pick whichever track is closer to the requested
   pace and cover the remainder with playbackRate. preservesPitch keeps the tone
   contours intact — pitch is meaning in Burmese, so this is non-negotiable. */
const SLOW_TRACK_CUTOFF = 0.72;   // at or below this, prefer the slow rendering
const RATE_MIN = 0.5, RATE_MAX = 2.0;

const store = {
  get(k, fallback) {
    try { const v = localStorage.getItem('sib.' + k); return v === null ? fallback : JSON.parse(v); }
    catch { return fallback; }
  },
  set(k, v) { try { localStorage.setItem('sib.' + k, JSON.stringify(v)); } catch {} },
};

let favs   = new Set(store.get('favs', []));
let speed  = store.get('speed', 55);          // percent of native speaking pace
let modes  = Object.assign({ step: false, loop: false, shadow: false }, store.get('modes', {}));
let recent = store.get('recent', []);         // phrase ids, most recently played first
// A hundred phrases is a lot to face cold, so a first-time visitor lands on the
// starter set rather than the full list.
let filter = store.get('filter', 'start');
let query  = '';
let current = null;                            // phrase object shown in the sheet

const $ = sel => document.querySelector(sel);
const el = {
  list: $('#list'), chips: $('#chips'), search: $('#search'), empty: $('#empty'),
  sheet: $('#detail'), dEn: $('#d-en'), dNote: $('#d-note'), dScript: $('#d-script'),
  dPhon: $('#d-phon'), dVoicing: $('#d-voicing'),
  playBtn: $('#play-btn'), speed: $('#speed'), speedVal: $('#speed-val'),
  favBtn: $('#fav-btn'), toast: $('#toast'), shadowHint: $('#shadow-hint'),
};

/* ── Audio engine ────────────────────────────────────────────────────────
   One shared <audio> element, reused for every clip. This matters on iOS:
   once the element has been started by a user gesture it stays unlocked, so
   later programmatic plays inside a sequence are allowed. A fresh element per
   clip would be blocked. It also keeps AirPods routing and the lock-screen
   controls attached to a single stable source. */

const audio = new Audio();
audio.preload = 'auto';
for (const k of ['preservesPitch', 'mozPreservesPitch', 'webkitPreservesPitch']) {
  if (k in audio) audio[k] = true;
}

let generation = 0;      // bumped to cancel any in-flight sequence
let rafId = null;

const trackFor = target => (target <= SLOW_TRACK_CUTOFF ? 'slow' : 'natural');

/** Where a clip's speech ends, in seconds.
 *
 *  Measured from the rendered audio at build time, not inferred from the last
 *  syllable's timing. The TTS under-reports its own word durations -- badly at
 *  the slow rate, and worst on the stacked clusters -- so deriving the end from
 *  the timing data cut the final syllable off a quarter of the library. `end`
 *  is the authoritative value; the fallback is only for data built before it
 *  existed. */
const endOf = (phrase, track) => {
  if (phrase.end && phrase.end[track] != null) return phrase.end[track];
  const t = phrase.timing[track];
  const last = t[t.length - 1];
  return last.t + last.d + 0.25;
};

/** How fast a track speaks relative to the natural rendering, measured from
 *  its own timing data rather than assumed from the requested TTS percentage. */
function pace(phrase, track) {
  return track === 'natural' ? 1 : endOf(phrase, 'natural') / endOf(phrase, track);
}

function playbackPlan(phrase, targetPct) {
  const target = targetPct / 100;
  const track = trackFor(target);
  const rate = Math.min(RATE_MAX, Math.max(RATE_MIN, target / pace(phrase, track)));
  return { track, rate, src: `audio/${phrase.id}.${track}.mp3` };
}

const sleep = (ms, gen) => new Promise(res => setTimeout(() => res(gen === generation), ms));

let cancelActive = null;   // aborts the clip currently in flight

/** Surface a playback failure instead of failing silently. Defined here and
 *  assigned below, once the toast helper exists. */
let playbackFailed = () => {};

/** Play [from, to) of the current source, resolving true if it ran to the end
 *  and false if it was cancelled.
 *
 *  Sequencing is driven by the audio element's own `timeupdate`/`ended` events,
 *  never by requestAnimationFrame. rAF is suspended in a backgrounded or
 *  screen-off tab, but media events keep firing — and phone-in-pocket with
 *  AirPods in is the main way this app gets used, so loop and shadow mode have
 *  to survive it. rAF is used only to paint the highlight, which nobody can see
 *  in that state anyway. */
function playRange(from, to, gen, onTick) {
  return new Promise(resolve => {
    let settled = false;
    let timer = null;
    let loadTimer = null;

    const cleanup = () => {
      audio.removeEventListener('timeupdate', check);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('canplay', start);
      audio.removeEventListener('error', onLoadFail);
      clearTimeout(timer);
      clearTimeout(loadTimer);
      if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
      if (cancelActive === finish) cancelActive = null;
    };
    function finish(ok) {
      if (settled) return;
      settled = true;
      cleanup();
      audio.pause();
      resolve(ok);
    }
    function check() {
      if (gen !== generation) return finish(false);
      if (audio.currentTime >= to) finish(true);
    }
    function onEnded() { finish(gen === generation); }

    const paint = () => {
      if (settled || gen !== generation) return;
      if (onTick) onTick(audio.currentTime);
      rafId = requestAnimationFrame(paint);
    };

    function onLoadFail() {
      playbackFailed('That clip could not be loaded');
      finish(false);
    }

    function start() {
      if (gen !== generation) return finish(false);
      cancelActive = finish;
      clearTimeout(loadTimer);
      try { audio.currentTime = from; } catch {}
      audio.addEventListener('timeupdate', check);
      audio.addEventListener('ended', onEnded);
      audio.play().then(() => {
        // Backstop in case timeupdate is coarser than the segment is short.
        const ms = ((to - from) / (audio.playbackRate || 1)) * 1000 + 140;
        timer = setTimeout(() => finish(gen === generation), ms);
        if (!document.hidden) rafId = requestAnimationFrame(paint);
      }).catch(err => {
        // Autoplay blocked, decode failure, or the element was torn down.
        if (err && err.name !== 'AbortError') playbackFailed('Tap play again to start audio');
        finish(false);
      });
    }

    if (audio.readyState >= 2) {
      start();
    } else {
      audio.addEventListener('canplay', start, { once: true });
      audio.addEventListener('error', onLoadFail, { once: true });
      // A clip that never loads must not leave the player hanging on "stop"
      // forever with nothing playing.
      loadTimer = setTimeout(onLoadFail, 8000);
      audio.load();
    }
  });
}

function stopPlayback() {
  generation++;
  if (cancelActive) cancelActive(false);
  if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
  audio.pause();
  setPlayingUI(false);
  setLiveSaying(false);   // every path out of playback, not just livePlay's own
  highlight(-1);
}

/** Run one pass of a phrase, honouring step mode. */
async function playOnce(phrase, plan, gen) {
  const timing = phrase.timing[plan.track];
  if (modes.step) {
    for (let i = 0; i < timing.length; i++) {
      highlight(i);
      const ok = await playRange(timing[i].t, timing[i].t + timing[i].d, gen);
      if (!ok) return false;
      if (!(await sleep(340 / plan.rate, gen))) return false;
    }
    highlight(-1);
    return true;
  }
  const ok = await playRange(0, endOf(phrase, plan.track), gen, t => {
    let idx = -1;
    for (let i = 0; i < timing.length; i++) if (t >= timing[i].t - 0.02) idx = i;
    highlight(idx);
  });
  highlight(-1);
  return ok;
}

async function play(phrase) {
  stopPlayback();
  noteUsed(phrase.id);
  const gen = ++generation;
  const plan = playbackPlan(phrase, speed);

  if (!audio.src.endsWith(plan.src)) audio.src = plan.src;
  audio.playbackRate = plan.rate;
  setMediaSession(phrase);
  setPlayingUI(true);

  try {
    do {
      audio.playbackRate = plan.rate;   // Safari resets this when src reloads
      const ok = await playOnce(phrase, plan, gen);
      if (!ok) return;

      if (modes.shadow) {
        // Silence roughly as long as the phrase, so you can say it back.
        const spoken = (endOf(phrase, plan.track) / plan.rate) * 1000;
        if (!(await sleep(Math.max(900, spoken * 1.15), gen))) return;
      } else if (modes.loop) {
        if (!(await sleep(700, gen))) return;
      }
    } while (modes.loop || modes.shadow);
  } finally {
    // Covers every exit: finished, cancelled, or play() rejected (autoplay
    // blocked, missing file). Without this the button stays stuck on "stop"
    // with nothing playing. Skipped if a newer playback already took over.
    if (gen === generation) {
      setPlayingUI(false);
      highlight(-1);
    }
  }
}

/** Play a single syllable in its real phrase context (tap-a-syllable). */
async function playSyllable(phrase, index) {
  stopPlayback();
  const gen = ++generation;
  const plan = playbackPlan(phrase, speed);
  if (!audio.src.endsWith(plan.src)) audio.src = plan.src;
  audio.playbackRate = plan.rate;

  const t = phrase.timing[plan.track][index];
  highlight(index);
  setPlayingUI(true);
  await playRange(t.t, t.t + t.d, gen);
  if (gen === generation) { highlight(-1); setPlayingUI(false); }
}

/* AirPods stem-squeeze and lock-screen controls map onto play/pause, which is
   the whole point of this app: replay without taking your phone out. */
function setMediaSession(phrase) {
  if (!('mediaSession' in navigator)) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: phrase.en,
    artist: `${phrase.my}  ·  ${spokenRom(phrase)}`,
    album: 'Say It In Burmese',
    artwork: [{ src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' }],
  });
  /* In live mode the deck is the thing being navigated, so the stem moves
     through it: squeeze to hear the line again, double-squeeze for the next
     one. That is the whole point of live mode -- it works with the phone still
     in your pocket. Outside live mode there is nowhere to go, so both track
     buttons just replay. */
  const handlers = live ? {
    play:  () => livePlay(),
    pause: () => stopPlayback(),
    stop:  () => stopPlayback(),
    previoustrack: () => liveGo(-1),
    nexttrack:     () => liveGo(1),
  } : {
    play:  () => play(phrase),
    pause: () => stopPlayback(),
    stop:  () => stopPlayback(),
    previoustrack: () => play(phrase),
    nexttrack:     () => play(phrase),
  };
  for (const [action, fn] of Object.entries(handlers)) {
    try { navigator.mediaSession.setActionHandler(action, fn); } catch {}
  }
}

/* ── Rendering ───────────────────────────────────────────────────────── */

/* Burmese tone is as much about length and how a syllable *ends* as about
   pitch, so the contour marks show both: how long the stroke runs, and what
   happens at its right-hand end.

     1 level    a full-width line, held steady
     2 falling  starts high and slides away — the long, heavy one
     3 sharp    short and high, snapped off with a flick
     4 stopped  barely there, cut dead by a bar (the glottal stop) */
const TONE_PATH = {
  1: '<path d="M1 4.5h13"/>',
  2: '<path d="M1.5 2L13.5 7.5"/>',
  3: '<path d="M3 2.5h7l2 3.5"/>',
  4: '<path d="M3 3.5h5"/><path d="M11 1.5v6"/>',
};
const toneSvg = tone => `<svg class="syl-tone" viewBox="0 0 15 9" aria-hidden="true">${TONE_PATH[tone]}</svg>`;

const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** The transcription as actually spoken, with juncture voicing applied. The
 *  `rom` field on the phrase is the citation form — correct per syllable, and
 *  wrong as a line to read out loud. Anywhere a whole phrase is transcribed for
 *  someone to say or to follow along with, it has to be this one. */
const spokenRom = phrase => phrase.syllables.map(s => s.say_rom || s.rom).join(' ');

/** One column per syllable. The English respelling is the headline: it's the
 *  thing you actually read out loud. The Burmese script and the transcription
 *  sit underneath as optional reference — useful to show someone, useless to
 *  read from if you can't read either. Tone shows as colour plus a contour
 *  mark, so it survives even with both scripts switched off. */
function syllablesHtml(phrase, { interactive }) {
  const timing = phrase.timing.slow;
  return phrase.syllables.map((s, i) => {
    const wordEnd = timing[i + 1] && timing[i + 1].word !== timing[i].word;
    const tag = interactive ? 'button' : 'span';
    return `<${tag} class="syl t${s.tone}${wordEnd ? ' word-end' : ''}${s.voiced ? ' voiced' : ''}"` +
           (interactive ? ` data-syl="${i}" aria-label="${esc(s.say)}"` : '') + '>' +
             `<span class="syl-say">${esc(s.say)}</span>` +
             toneSvg(s.tone) +
             `<span class="syl-my">${esc(s.my)}</span>` +
             // `say_rom` is the softened form the voice actually produces; the
             // citation form in `rom` is what a dictionary would give you, and
             // is not what you want to read out loud.
             `<span class="syl-rom">${esc(s.say_rom || s.rom)}</span>` +
           `</${tag}>`;
  }).join('');
}

/** Compact preview for list cards — respelling first, script second. */
function inlineMy(phrase) {
  return `<span class="card-say">`
       + phrase.syllables.map(s => `<span class="t${s.tone}">${esc(s.say)}</span>`).join(' ')
       + `</span>`
       + `<span class="card-script"> ${esc(phrase.my)}</span>`;
}

const PLAY_ICON = '<svg viewBox="0 0 24 24"><path d="M8 5.5v13l11-6.5z"/></svg>';
const STAR_ICON = '<svg class="card-fav" viewBox="0 0 24 24"><path d="M12 3.5l2.6 5.3 5.9.9-4.2 4.1 1 5.8-5.3-2.8-5.3 2.8 1-5.8L3.5 9.7l5.9-.9z"/></svg>';

const VIRTUAL_FILTERS = {
  all:    () => true,
  start:  p => p.starter != null,
  recent: p => recent.includes(p.id),
  fav:    p => favs.has(p.id),
};

function matches(p) {
  const virtual = VIRTUAL_FILTERS[filter];
  if (virtual ? !virtual(p) : p.cat !== filter) return false;
  if (!query) return true;
  const hay = `${p.en} ${p.rom} ${p.my} ${p.phon}`.toLowerCase();
  return query.split(/\s+/).every(w => hay.includes(w));
}

/** Remember what's been played so the Recent filter reflects real use. */
function noteUsed(id) {
  const wasEmpty = recent.length === 0;
  recent = [id, ...recent.filter(x => x !== id)].slice(0, 12);
  store.set('recent', recent);
  // The Recent chip only exists once there's something in it, so its first
  // appearance needs the strip rebuilt. Later plays just reorder the list.
  if (wasEmpty) renderChips();
  renderQuickbar();
}

function cardHtml(p) {
  return `<button class="card" data-id="${p.id}">
    <span class="card-text">
      <span class="card-en">${esc(p.en)}${favs.has(p.id) ? ' ' + STAR_ICON : ''}</span>
      <span class="card-my">${inlineMy(p)}</span>
    </span>
    <span class="card-play" data-play="${p.id}" role="button" aria-label="Play ${esc(p.en)}">${PLAY_ICON}</span>
  </button>`;
}

function renderList() {
  let hits = DATA.phrases.filter(matches);
  el.empty.hidden = hits.length > 0;

  if (filter === 'start') hits.sort((a, b) => a.starter - b.starter);
  if (filter === 'recent') hits.sort((a, b) => recent.indexOf(a.id) - recent.indexOf(b.id));

  const intro = (filter === 'start' && !query)
    ? `<p class="list-intro">Twelve to learn first — the ones you'll use nearly every day.
       Once these feel easy, work through the categories.</p>`
    : '';

  // Group under headings only when browsing everything; a filtered or searched
  // view is short enough that headings would be more noise than signal.
  if (filter === 'all' && !query) {
    el.list.innerHTML = DATA.categories.map(c => {
      const items = hits.filter(p => p.cat === c.id);
      if (!items.length) return '';
      return `<h2 class="cat-head">${c.emoji} ${esc(c.name)}</h2>` + items.map(cardHtml).join('');
    }).join('');
  } else {
    el.list.innerHTML = intro + hits.map(cardHtml).join('');
  }
}

function renderChips() {
  const all = [
    { id: 'start', name: 'Start here', emoji: '🌱' },
    { id: 'all', name: 'All', emoji: '' },
    // Only worth offering once there's something in them.
    ...(recent.length ? [{ id: 'recent', name: 'Recent', emoji: '🕘' }] : []),
    ...(favs.size ? [{ id: 'fav', name: 'Favourites', emoji: '★' }] : []),
    ...DATA.categories,
  ];
  el.chips.innerHTML = all.map(c =>
    `<button class="chip" data-cat="${c.id}" aria-pressed="${filter === c.id}">${c.emoji} ${esc(c.name)}</button>`
  ).join('');
}

function highlight(index) {
  const nodes = el.dScript.querySelectorAll('.syl');
  nodes.forEach((n, i) => n.classList.toggle('active', i === index));
}

function setPlayingUI(on) {
  el.playBtn.classList.toggle('playing', on);
  el.playBtn.setAttribute('aria-label', on ? 'Stop' : 'Play');
  document.querySelectorAll('.card-play.playing').forEach(n => n.classList.remove('playing'));
  if (on && current) {
    const node = el.list.querySelector(`[data-play="${current.id}"]`);
    if (node) node.classList.add('playing');
  }
}

function updateSpeedUI() {
  el.speed.value = speed;
  el.speedVal.textContent = speed + '%';
  const pct = ((speed - el.speed.min) / (el.speed.max - el.speed.min)) * 100;
  el.speed.style.setProperty('--fill', pct + '%');
}

function updateModeUI() {
  for (const m of ['step', 'loop', 'shadow']) {
    $('#mode-' + m).setAttribute('aria-pressed', String(modes[m]));
  }
  el.shadowHint.hidden = !modes.shadow;
}

/* ── Sheet ───────────────────────────────────────────────────────────── */

/* Sheets (phrase detail, settings) are modal and back-dismissable. Only one is
   ever open, so a single slot plus one history entry is enough. */
let activeSheet = null;

function showSheet(node) {
  if (activeSheet) hideSheet();
  activeSheet = node;
  renderQuickbar();
  node.hidden = false;
  node.scrollTop = 0;
  document.body.style.overflow = 'hidden';
  history.pushState({ sheet: true }, '');
}

function hideSheet() {
  if (!activeSheet) return;
  const wasDrill = activeSheet === $('#drill');
  const wasDetail = activeSheet === el.sheet;
  const wasLive = activeSheet === $('#live');
  if (wasDrill) { stopPlayback(); drill = null; }
  if (wasLive) { stopPlayback(); live = null; releaseWakeLock(); }
  activeSheet.hidden = true;
  activeSheet = null;
  document.body.style.overflow = '';
  if (wasDetail) {
    stopRecording();   // never leave the mic live behind a closed sheet
    stopPlayback();
    current = null;
    renderList();
  }
  renderQuickbar();
}

function openSheet(phrase) {
  current = phrase;
  el.dEn.textContent = phrase.en;
  el.dNote.textContent = phrase.note || '';
  el.dNote.hidden = !phrase.note;
  el.dScript.innerHTML = syllablesHtml(phrase, { interactive: true });
  el.dPhon.innerHTML = phrase.phon
    ? `Read it out loud: <b>${esc(phrase.phon)}</b> &nbsp;·&nbsp; CAPITALS get the stress`
    : '';
  const softened = phrase.syllables.filter(s => s.voiced);
  el.dVoicing.hidden = !softened.length;
  if (softened.length) {
    el.dVoicing.innerHTML =
      `<b>${softened.map(s => esc(s.say_rom)).join(', ')}</b> ` +
      `${softened.length === 1 ? 'is' : 'are'} underlined because the consonant softens here. ` +
      `A hard sound at the front of a syllable goes soft when the syllable before it runs on into it — ` +
      `so ကျေးဇူးတင်ပါတယ် is said <b>…tin ba de</b>, never <b>…tin pa te</b>. ` +
      `Skipping this is the single thing that most marks out someone reading off a page.`;
  }
  el.favBtn.setAttribute('aria-pressed', String(favs.has(phrase.id)));
  refreshCompareUI();
  showSheet(el.sheet);
  setMediaSession(phrase);
}

function toast(msg) {
  el.toast.textContent = msg;
  el.toast.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { el.toast.hidden = true; }, 2200);
}

/* ── Events ──────────────────────────────────────────────────────────── */

el.list.addEventListener('click', e => {
  const playNode = e.target.closest('[data-play]');
  if (playNode) {
    e.stopPropagation();
    const p = BY_ID.get(playNode.dataset.play);
    if (current && current.id === p.id && !audio.paused) stopPlayback();
    else { current = p; play(p); }
    return;
  }
  const card = e.target.closest('[data-id]');
  if (card) openSheet(BY_ID.get(card.dataset.id));
});

el.chips.addEventListener('click', e => {
  const chip = e.target.closest('[data-cat]');
  if (!chip) return;
  filter = chip.dataset.cat;
  store.set('filter', filter);
  renderChips();
  renderList();
  el.list.scrollIntoView({ block: 'start' });
});

el.search.addEventListener('input', () => {
  query = el.search.value.trim().toLowerCase();
  renderList();
});

el.dScript.addEventListener('click', e => {
  const node = e.target.closest('[data-syl]');
  if (node && current) playSyllable(current, Number(node.dataset.syl));
});

el.playBtn.addEventListener('click', () => {
  if (!current) return;
  if (!audio.paused || rafId) stopPlayback();
  else play(current);
});

el.speed.addEventListener('input', () => {
  speed = Number(el.speed.value);
  updateSpeedUI();
});
el.speed.addEventListener('change', () => {
  store.set('speed', speed);
  // Re-start at the new speed so the change is immediately audible.
  if (current && (!audio.paused || rafId)) play(current);
});

for (const m of ['step', 'loop', 'shadow']) {
  $('#mode-' + m).addEventListener('click', () => {
    modes[m] = !modes[m];
    // Loop and shadow both repeat; running them together is ambiguous.
    if (m === 'loop' && modes.loop) modes.shadow = false;
    if (m === 'shadow' && modes.shadow) modes.loop = false;
    store.set('modes', modes);
    updateModeUI();
    if (current && (!audio.paused || rafId)) play(current);
  });
}

el.favBtn.addEventListener('click', () => {
  if (!current) return;
  favs.has(current.id) ? favs.delete(current.id) : favs.add(current.id);
  store.set('favs', [...favs]);
  el.favBtn.setAttribute('aria-pressed', String(favs.has(current.id)));
  renderChips();
  renderQuickbar();
  toast(favs.has(current.id) ? 'Saved to favourites' : 'Removed from favourites');
});

for (const btn of document.querySelectorAll('.close-btn')) {
  btn.addEventListener('click', () => history.back());
}

window.addEventListener('popstate', hideSheet);

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !$('#present').hidden) return closePresent();
  if (e.key === 'Escape' && activeSheet) history.back();
  if (e.key === ' ' && current && activeSheet === el.sheet && e.target === document.body) {
    e.preventDefault();
    (!audio.paused || rafId) ? stopPlayback() : play(current);
  }
});

/* ── Ear training ────────────────────────────────────────────────────
   Listening-only tone identification. This is the best-evidenced intervention
   for a speaker of a non-tonal language: training perception alone measurably
   improves *production* too, without any speaking practice, because the
   bottleneck is an ear that doesn't yet treat pitch as meaning.

   The whole phrase is played rather than a sliced-out syllable. That's partly
   pedagogy — tones behave differently in connected speech than in isolation —
   and partly honesty: the per-syllable timings here are even subdivisions of
   TTS word spans, accurate to only ~100ms, so a sliced syllable could clip and
   mark a correct answer wrong. */

const TONE_LABEL = { 1: 'level', 2: 'falling', 3: 'sharp', 4: 'stopped' };
const TONE_HINT = {
  1: 'level and unhurried, medium length — the plain one, with nothing done to it',
  2: 'long and heavy, starting high and falling away, often with a breathy edge',
  3: 'short and high, snapped off with a catch — the voice tightens at the end',
  4: 'clipped dead short by a stop in the throat, with no vowel left to hear',
};

let drill = null;          // { phrase, index, answered }
let drillScore = { right: 0, asked: 0 };

/** Every Burmese syllable carries one of the four tones, so all of them drill
 *  — except the stacked clusters. မင်္ဂ is a single written syllable holding two
 *  spoken ones ("min-ga"), and asking for *the* tone of a chunk that has two
 *  would be marking a fair answer wrong. Those are respelled with a hyphen, so
 *  that is what identifies them. */
const drillable = p => p.syllables
  .map((s, i) => ({ s, i }))
  .filter(({ s }) => s.tone >= 1 && s.tone <= 4 && !s.say.includes('-'));

function nextQuestion() {
  const pool = DATA.phrases.filter(p => drillable(p).length);
  const phrase = pool[Math.floor(Math.random() * pool.length)];
  const opts = drillable(phrase);
  const pick = opts[Math.floor(Math.random() * opts.length)];
  drill = { phrase, index: pick.i, answered: false };

  const total = phrase.syllables.length;
  const ord = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th'][pick.i] || `${pick.i + 1}th`;
  $('#drill-meaning').textContent = phrase.en;
  $('#drill-syl').textContent = pick.s.say;
  $('#drill-where').textContent = total > 1 ? `the ${ord} of ${total} sounds` : 'the whole phrase';

  $('#drill-choices').innerHTML = [1, 2, 3, 4].map(t =>
    `<button class="drill-choice" data-tone="${t}">
       <svg viewBox="0 0 15 9" aria-hidden="true">${TONE_PATH[t]}</svg>
       ${t} ${TONE_LABEL[t]}
     </button>`).join('');

  $('#drill-feedback').hidden = true;
  $('#drill-next').hidden = true;
  renderDrillScore();
  playDrillPhrase();
}

function renderDrillScore() {
  $('#drill-score').textContent = drillScore.asked
    ? `${drillScore.right}/${drillScore.asked}` : '';
}

/** Play a phrase straight through, ignoring loop/shadow/syllable modes. */
async function playDrillPhrase() {
  if (!drill) return;
  stopPlayback();
  const gen = ++generation;
  const plan = playbackPlan(drill.phrase, speed);
  if (!audio.src.endsWith(plan.src)) audio.src = plan.src;
  audio.playbackRate = plan.rate;
  await playRange(0, endOf(drill.phrase, plan.track), gen);
}

function answerDrill(tone) {
  if (!drill || drill.answered) return;
  drill.answered = true;
  const syl = drill.phrase.syllables[drill.index];
  const right = syl.tone;
  const ok = tone === right;

  drillScore.asked++;
  if (ok) drillScore.right++;
  renderDrillScore();

  for (const btn of $('#drill-choices').querySelectorAll('.drill-choice')) {
    const t = Number(btn.dataset.tone);
    btn.disabled = true;
    if (t === right) btn.classList.add('correct');
    else if (t === tone) btn.classList.add('wrong');
  }

  const fb = $('#drill-feedback');
  fb.innerHTML = ok
    ? `Yes — <b>${esc(syl.say)}</b> is tone ${right}, ${TONE_HINT[right]}.`
    : `Not quite. <b>${esc(syl.say)}</b> is tone ${right} (${TONE_LABEL[right]}), ` +
      `${TONE_HINT[right]} — you picked ${tone} (${TONE_LABEL[tone]}).` +
      (right === 4 ? ` The stopped tone is the easiest to spot once you know it: the sound just ends.` : '');
  fb.hidden = false;
  $('#drill-next').hidden = false;
  playDrillPhrase();
}

$('#ear-btn').addEventListener('click', () => {
  drillScore = { right: 0, asked: 0 };
  showSheet($('#drill'));
  nextQuestion();
});
$('#drill-choices').addEventListener('click', e => {
  const btn = e.target.closest('[data-tone]');
  if (btn) answerDrill(Number(btn.dataset.tone));
});
$('#drill-next').addEventListener('click', nextQuestion);
$('#drill-replay').addEventListener('click', playDrillPhrase);

/* ── Present mode ────────────────────────────────────────────────────
   Hands the phone to the other person. The Burmese is shown as large as the
   viewport allows, because it's what a Burmese reader actually reads — and the
   one part of the phrase this app otherwise keeps hidden. Flip rotates the
   text 180° so the phone can just be slid across a table. */

function openPresent() {
  if (!current) return;
  $('#present-en').textContent = current.en;
  $('#present-my').textContent = current.my;
  $('#present-rom').textContent = spokenRom(current);
  $('#present').hidden = false;
  document.body.style.overflow = 'hidden';
}

function closePresent() {
  $('#present').hidden = true;
  if (!activeSheet) document.body.style.overflow = '';
}

$('#show-btn').addEventListener('click', openPresent);
$('#present-close').addEventListener('click', closePresent);
$('#present-play').addEventListener('click', () => current && play(current));
$('#present-flip').addEventListener('click', e => {
  const on = $('#present').classList.toggle('flipped');
  e.currentTarget.setAttribute('aria-pressed', String(on));
});

/* ── Live mode ───────────────────────────────────────────────────────
   For the moment you are actually in: AirPods in, phone in a pocket, someone
   in front of you. Everything here is built so that using it does not read as
   using it.

   - One deck, one line at a time, no list to scan and no sheet to open.
   - The AirPods stem drives it (see setMediaSession): squeeze to hear the line
     again, double-squeeze for the next. The phone never comes out.
   - The lock screen carries the English and the respelling, so a glance at a
     dark phone looks like checking what track is playing.
   - Rehearse plays the line, leaves a beat to murmur it back, then plays it
     once more -- so the version you say out loud is your second attempt.
   - Dim takes the screen to almost nothing for the times the phone is face-up
     on the table between you.
   - A wake lock keeps the screen from sleeping mid-conversation, because
     unlocking a phone to find your next line is the tell. */

let live = null;              // { deck, ids, i }
let wakeLock = null;
let liveRehearse = store.get('liveRehearse', true);

const liveCurrent = () => (live ? BY_ID.get(live.ids[live.i]) : null);

function deckIds(deckId) {
  if (deckId === 'fav') return [...favs];
  if (deckId === 'recent') return recent.slice();
  if (deckId === 'start') {
    return DATA.phrases.filter(p => p.starter != null)
      .sort((a, b) => a.starter - b.starter).map(p => p.id);
  }
  return DATA.phrases.filter(p => p.cat === deckId).map(p => p.id);
}

function liveDecks() {
  return [
    ...(favs.size ? [{ id: 'fav', name: '★ Saved' }] : []),
    ...(recent.length ? [{ id: 'recent', name: 'Recent' }] : []),
    { id: 'start', name: 'Start here' },
    ...DATA.categories.map(c => ({ id: c.id, name: c.name })),
  ];
}

/* The screen must not sleep while this is open, and iOS drops the lock
   whenever the tab is backgrounded -- including every time the phone locks --
   so it has to be re-taken on the way back. */
async function requestWakeLock() {
  if (!('wakeLock' in navigator)) return;
  try { wakeLock = await navigator.wakeLock.request('screen'); } catch {}
}
function releaseWakeLock() {
  try { if (wakeLock) wakeLock.release(); } catch {}
  wakeLock = null;
}
document.addEventListener('visibilitychange', () => {
  if (live && document.visibilityState === 'visible' && !wakeLock) requestWakeLock();
});

function openLive(deckId) {
  const wanted = deckId || store.get('liveDeck', 'start');
  let deck = wanted;
  let ids = deckIds(deck).filter(id => BY_ID.has(id));
  if (!ids.length) { deck = 'start'; ids = deckIds('start'); }
  live = { deck, ids, i: 0 };
  store.set('liveDeck', deck);
  renderLive();
  showSheet($('#live'));
  requestWakeLock();
}

function renderLive() {
  const phrase = liveCurrent();
  if (!phrase) return;
  const deck = liveDecks().find(d => d.id === live.deck);
  $('#live-deck-name').textContent = deck ? deck.name : '';
  $('#live-count').textContent = `${live.i + 1}/${live.ids.length}`;
  $('#live-en').textContent = phrase.en;
  $('#live-say').textContent = phrase.phon;
  $('#live-my').textContent = phrase.my;
  $('#live-note').textContent = phrase.note || '';
  $('#live-fav').setAttribute('aria-pressed', String(favs.has(phrase.id)));
  $('#live-fav').textContent = favs.has(phrase.id) ? 'Saved' : 'Save';
  $('#live-rehearse').setAttribute('aria-pressed', String(liveRehearse));

  // A dot per phrase while that stays readable; past ten or so it turns into
  // a grey smear, and the counter is already carrying that information.
  $('#live-dots').innerHTML = live.ids.length <= 14
    ? live.ids.map((_, i) => `<i class="${i === live.i ? 'on' : ''}"></i>`).join('')
    : '';

  $('#live-decks').innerHTML = liveDecks().map(d =>
    `<button class="live-deck" data-deck="${d.id}" aria-pressed="${d.id === live.deck}">${esc(d.name)}</button>`
  ).join('');
  const active = $('#live-decks').querySelector('[aria-pressed="true"]');
  if (active) active.scrollIntoView({ block: 'nearest', inline: 'center' });

  setMediaSession(phrase);
}

function setLiveSaying(on) {
  const btn = $('#live-say-btn');
  if (!btn) return;
  btn.classList.toggle('playing', on);
  $('#live-card').classList.toggle('saying', on);
}

/** Play the cued line straight through, ignoring the practice modes -- step,
 *  loop and shadow all belong on the practice screen, not in a conversation. */
async function livePlay() {
  const phrase = liveCurrent();
  if (!phrase) return;
  stopPlayback();
  noteUsed(phrase.id);
  const gen = ++generation;
  const plan = playbackPlan(phrase, speed);
  if (!audio.src.endsWith(plan.src)) audio.src = plan.src;
  audio.playbackRate = plan.rate;
  setMediaSession(phrase);
  setLiveSaying(true);
  const stop = endOf(phrase, plan.track);
  try {
    audio.playbackRate = plan.rate;            // Safari resets this on src load
    if (!(await playRange(0, stop, gen))) return;
    if (liveRehearse) {
      if (!(await sleep(Math.max(800, (stop / plan.rate) * 1000), gen))) return;
      audio.playbackRate = plan.rate;
      await playRange(0, stop, gen);
    }
  } finally {
    if (gen === generation) setLiveSaying(false);
  }
}

function liveGo(delta) {
  if (!live || !live.ids.length) return;
  stopPlayback();
  live.i = (live.i + delta + live.ids.length) % live.ids.length;
  renderLive();
  livePlay();
}

function setLiveDeck(deckId) {
  const ids = deckIds(deckId).filter(id => BY_ID.has(id));
  if (!ids.length) return toast('Nothing in that deck yet');
  stopPlayback();
  live.deck = deckId;
  live.ids = ids;
  live.i = 0;
  store.set('liveDeck', deckId);
  renderLive();
}

$('#live-btn').addEventListener('click', () => openLive());
$('#live-prev').addEventListener('click', () => liveGo(-1));
$('#live-next').addEventListener('click', () => liveGo(1));
$('#live-say-btn').addEventListener('click', () => {
  if (!audio.paused || rafId) stopPlayback(); else livePlay();
});
$('#live-decks').addEventListener('click', e => {
  const btn = e.target.closest('[data-deck]');
  if (btn) setLiveDeck(btn.dataset.deck);
});
$('#live-rehearse').addEventListener('click', () => {
  liveRehearse = !liveRehearse;
  store.set('liveRehearse', liveRehearse);
  renderLive();
  toast(liveRehearse ? 'Plays twice, with a beat to say it back' : 'Plays once');
});
$('#live-fav').addEventListener('click', () => {
  const phrase = liveCurrent();
  if (!phrase) return;
  favs.has(phrase.id) ? favs.delete(phrase.id) : favs.add(phrase.id);
  store.set('favs', [...favs]);
  renderChips();
  renderLive();
});
$('#live-show').addEventListener('click', () => {
  const phrase = liveCurrent();
  if (!phrase) return;
  current = phrase;
  openPresent();
});

/* Dim is for the phone lying face-up on the table. The first tap anywhere
   brings the screen back rather than firing whatever was under the finger --
   otherwise the gesture that says "let me look" also says "say it now". */
$('#live-dim').addEventListener('click', e => {
  e.stopPropagation();
  const on = $('#live').classList.toggle('dimmed');
  $('#live-dim').setAttribute('aria-pressed', String(on));
});

const liveCard = $('#live-card');
let liveTouch = null;

const undim = () => {
  if (!$('#live').classList.contains('dimmed')) return false;
  $('#live').classList.remove('dimmed');
  $('#live-dim').setAttribute('aria-pressed', 'false');
  return true;
};

liveCard.addEventListener('click', () => { if (!undim()) livePlay(); });
liveCard.addEventListener('keydown', e => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); livePlay(); }
});

/* Swiping the card moves through the deck, so the common action needs no aim.
   The vertical check keeps a scroll from being read as a swipe. */
liveCard.addEventListener('touchstart', e => {
  liveTouch = { x: e.touches[0].clientX, y: e.touches[0].clientY };
}, { passive: true });
liveCard.addEventListener('touchend', e => {
  if (!liveTouch) return;
  const dx = e.changedTouches[0].clientX - liveTouch.x;
  const dy = e.changedTouches[0].clientY - liveTouch.y;
  liveTouch = null;
  if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.5) {
    e.preventDefault();
    liveGo(dx < 0 ? 1 : -1);
  }
});

document.addEventListener('keydown', e => {
  if (!live || $('#present').hidden === false) return;
  if (e.key === 'ArrowRight') { e.preventDefault(); liveGo(1); }
  if (e.key === 'ArrowLeft') { e.preventDefault(); liveGo(-1); }
});

/* ── Quick strip ─────────────────────────────────────────────────────
   Live use is bursty and repetitive — the same handful of phrases, needed in
   seconds, one-handed. Those live in the thumb's reach at the bottom rather
   than behind a scrolling chip row at the top. */

function quickList() {
  const ids = [...recent, ...[...favs].filter(id => !recent.includes(id))];
  return ids.map(id => BY_ID.get(id)).filter(Boolean).slice(0, 12);
}

function renderQuickbar() {
  const items = quickList();
  const bar = $('#quickbar');
  bar.hidden = items.length === 0 || !!activeSheet;
  document.body.classList.toggle('has-quickbar', !bar.hidden);
  if (bar.hidden) return;
  $('#quick-tiles').innerHTML = items.map(p =>
    `<button class="quick-tile" data-quick="${p.id}" aria-label="Play ${esc(p.en)}">
       <span class="quick-tile-en">${esc(p.en)}</span>
       <span class="quick-tile-say">${esc(p.phon)}</span>
     </button>`).join('');
}

$('#quick-tiles').addEventListener('click', e => {
  const node = e.target.closest('[data-quick]');
  if (!node) return;
  const p = BY_ID.get(node.dataset.quick);
  if (current && current.id === p.id && !audio.paused) return stopPlayback();
  current = p;
  play(p);
});

/* ── Deep links ──────────────────────────────────────────────────────
   iOS won't let a PWA register Siri phrases, widgets or Back Tap directly, but
   the Shortcuts app can "Open URL" — and a Shortcut *can* be bound to Back Tap
   and the Action Button. Supporting ?p= and ?present= is what makes that
   bridge possible. */

function applyDeepLink() {
  const q = new URLSearchParams(location.search);
  const p = q.get('p') && BY_ID.get(q.get('p'));
  const cat = q.get('cat');
  if (cat && (CATS.has(cat) || VIRTUAL_FILTERS[cat])) {
    filter = cat;
    renderChips();
    renderList();
  }
  if (q.get('live') === '1') return openLive(q.get('deck') || undefined);
  if (p) {
    openSheet(p);
    if (q.get('present') === '1') openPresent();
  }
}

/* ── Record & compare ────────────────────────────────────────────────
   Hearing yourself straight after the native clip is the only reliable way to
   notice you've been drilling a wrong tone. Deliberately a plain A/B rather
   than speech recognition: SpeechRecognition is unreliable-to-absent in iOS
   Safari, and has no Burmese model to speak of in any browser. */

const myAudio = new Audio();
const recordings = new Map();   // phrase id -> { url }
let mediaRecorder = null;
let recTimer = null;

const REC_MIME = ('MediaRecorder' in window)
  ? ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg']
      .find(t => { try { return MediaRecorder.isTypeSupported(t); } catch { return false; } })
  : undefined;

const canRecord = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia
                     && 'MediaRecorder' in window);

function refreshCompareUI() {
  $('#compare').hidden = !canRecord;
  if (!canRecord) return;
  const has = current && recordings.has(current.id);
  $('#cmp-actions').hidden = !has;
  $('#cmp-hint').hidden = !has;
  $('#rec-btn').hidden = !!has;
}

async function startRecording() {
  stopPlayback();
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    return toast('Microphone access is needed to record');
  }

  const chunks = [];
  try {
    mediaRecorder = REC_MIME ? new MediaRecorder(stream, { mimeType: REC_MIME })
                             : new MediaRecorder(stream);
  } catch {
    stream.getTracks().forEach(t => t.stop());
    return toast("This browser can't record audio");
  }

  const phraseId = current.id;
  mediaRecorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  mediaRecorder.onstop = () => {
    // Releasing the mic matters on iOS, which otherwise keeps showing the
    // in-use indicator for as long as the tab is open.
    stream.getTracks().forEach(t => t.stop());
    clearInterval(recTimer);
    mediaRecorder = null;

    const old = recordings.get(phraseId);
    if (old) URL.revokeObjectURL(old.url);
    if (chunks.length) {
      const blob = new Blob(chunks, { type: chunks[0].type || REC_MIME || 'audio/webm' });
      recordings.set(phraseId, { url: URL.createObjectURL(blob) });
    }
    $('#rec-btn').classList.remove('recording');
    $('#rec-label').textContent = 'Record yourself';
    refreshCompareUI();
    if (current && current.id === phraseId && recordings.has(phraseId)) playComparison(true);
  };

  mediaRecorder.start();
  const started = Date.now();
  $('#rec-btn').classList.add('recording');
  $('#rec-label').textContent = 'Stop  0:00';
  recTimer = setInterval(() => {
    const s = Math.floor((Date.now() - started) / 1000);
    $('#rec-label').textContent = `Stop  0:${String(s).padStart(2, '0')}`;
    if (s >= 15) stopRecording();          // safety cap
  }, 250);
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
}

/** Play a recording, resolving when it finishes or is cancelled. */
function playBlob(url, gen) {
  return new Promise(resolve => {
    let settled = false;
    const done = ok => {
      if (settled) return;
      settled = true;
      myAudio.removeEventListener('ended', onEnd);
      myAudio.pause();
      resolve(ok);
    };
    function onEnd() { done(gen === generation); }
    myAudio.addEventListener('ended', onEnd);
    myAudio.src = url;
    myAudio.playbackRate = 1;
    myAudio.play()
      .then(() => { cancelActive = done; })
      .catch(() => done(false));
  });
}

async function playComparison(includeNative) {
  const rec = current && recordings.get(current.id);
  if (!rec) return;
  stopPlayback();
  const gen = ++generation;
  setPlayingUI(true);

  try {
    if (includeNative) {
      const plan = playbackPlan(current, speed);
      if (!audio.src.endsWith(plan.src)) audio.src = plan.src;
      audio.playbackRate = plan.rate;
      const timing = current.timing[plan.track];
      const ok = await playRange(0, endOf(current, plan.track), gen, t => {
        let idx = -1;
        for (let i = 0; i < timing.length; i++) if (t >= timing[i].t - 0.02) idx = i;
        highlight(idx);
      });
      highlight(-1);
      if (!ok) return;
      if (!(await sleep(450, gen))) return;
    }
    await playBlob(rec.url, gen);
  } finally {
    if (gen === generation) { setPlayingUI(false); highlight(-1); }
  }
}

$('#rec-btn').addEventListener('click', () => {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') stopRecording();
  else if (current) startRecording();
});
$('#cmp-both').addEventListener('click', () => playComparison(true));
$('#cmp-mine').addEventListener('click', () => playComparison(false));
$('#cmp-redo').addEventListener('click', () => {
  const rec = current && recordings.get(current.id);
  if (rec) { URL.revokeObjectURL(rec.url); recordings.delete(current.id); }
  refreshCompareUI();
  startRecording();
});

/* ── Settings ────────────────────────────────────────────────────────── */

const BUILD = (document.querySelector('meta[name="app-build"]') || {}).content || '';
// The deploy workflow substitutes the placeholder; if it's still there we're
// running an unstamped local copy.
const BUILD_LABEL = (!BUILD || BUILD.startsWith('__')) ? 'dev' : BUILD;

const DISPLAY_OPTS = {
  tones:  { key: 'opt-tones',  cls: 'no-tone-colour', invert: true },
  script: { key: 'opt-script', cls: 'hide-script',    invert: true },
  rom:    { key: 'opt-rom',    cls: 'hide-rom',       invert: true },
};

// Script and transcription default off: the English respelling is what you
// read, and two spellings you can't read yet are just noise around it.
let prefs = Object.assign(
  { tones: true, script: false, rom: false, autocheck: true },
  store.get('prefs', {})
);

function applyPrefs() {
  for (const [name, o] of Object.entries(DISPLAY_OPTS)) {
    const on = prefs[name] !== false;
    // Each class *disables* a feature, so it's applied when the toggle is off.
    document.documentElement.classList.toggle(o.cls, o.invert ? !on : on);
    const input = $('#' + o.key);
    if (input) input.checked = on;
  }
  $('#opt-autocheck').checked = prefs.autocheck !== false;
}

function savePrefs() { store.set('prefs', prefs); }

const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

const isIOS = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

let deferredInstall = null;   // Chrome/Android beforeinstallprompt event

function refreshInstallSection() {
  const group = $('#install-group');
  const iosCard = $('#ios-install');
  const btn = $('#install-btn');

  // Already installed — nothing useful to offer.
  if (isStandalone()) { group.hidden = true; return; }

  // iOS has no programmatic install; Safari's Share sheet is the only route,
  // so the honest thing is to say exactly where to tap.
  const showIOS = isIOS() && !deferredInstall;
  iosCard.hidden = !showIOS;
  btn.hidden = !deferredInstall;
  group.hidden = iosCard.hidden && btn.hidden;
}

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredInstall = e;
  refreshInstallSection();
});

window.addEventListener('appinstalled', () => {
  deferredInstall = null;
  refreshInstallSection();
  toast('Installed — open it from your home screen');
});

$('#install-btn').addEventListener('click', async () => {
  if (!deferredInstall) return;
  deferredInstall.prompt();
  await deferredInstall.userChoice;
  deferredInstall = null;
  refreshInstallSection();
});

function bytes(n) {
  if (!n) return '0 MB';
  return n > 1e9 ? (n / 1e9).toFixed(1) + ' GB' : Math.max(1, Math.round(n / 1e6)) + ' MB';
}

async function refreshStorage() {
  const sub = $('#offline-sub');
  const total = DATA.phrases.length * Object.keys(DATA.tracks).length;
  try {
    const cache = await caches.open('sib-audio');
    const saved = (await cache.keys()).length;
    if (saved >= total) {
      sub.textContent = `All ${total} clips saved`;
      $('#offline-pill').textContent = 'Saved';
      $('#offline-pill').dataset.state = 'done';
    } else {
      sub.textContent = saved
        ? `${saved} of ${total} clips saved`
        : 'Works with no signal once saved';
      $('#offline-pill').textContent = 'Save';
      delete $('#offline-pill').dataset.state;
    }
  } catch {
    sub.textContent = 'Works with no signal once saved';
  }
  if (navigator.storage && navigator.storage.estimate) {
    try {
      const { usage } = await navigator.storage.estimate();
      if (usage) sub.textContent += ` · ${bytes(usage)} used`;
    } catch {}
  }
}

function refreshFavsRow() {
  $('#favs-sub').textContent = favs.size
    ? `${favs.size} phrase${favs.size === 1 ? '' : 's'} saved`
    : 'No favourites saved';
}

function openSettings() {
  $('#about-build').textContent = BUILD_LABEL;
  $('#about-voice').textContent = DATA.voice;
  $('#about-count').textContent = String(DATA.phrases.length);
  refreshInstallSection();
  refreshFavsRow();
  refreshStorage();
  showSheet($('#settings'));
}

$('#menu-btn').addEventListener('click', openSettings);

for (const [name, o] of Object.entries(DISPLAY_OPTS)) {
  $('#' + o.key).addEventListener('change', e => {
    prefs[name] = e.target.checked;
    savePrefs();
    applyPrefs();
  });
}

$('#opt-autocheck').addEventListener('change', e => {
  prefs.autocheck = e.target.checked;
  savePrefs();
});

/* Pre-download every clip so the app works with no signal at all. */
$('#offline-btn').addEventListener('click', async e => {
  const pill = $('#offline-pill');
  const sub = $('#offline-sub');
  if (pill.dataset.state === 'busy') return;

  const urls = [];
  for (const p of DATA.phrases) for (const t of Object.keys(DATA.tracks)) urls.push(`audio/${p.id}.${t}.mp3`);

  pill.dataset.state = 'busy';
  pill.textContent = '0%';
  let done = 0, failed = 0;
  for (const u of urls) {
    try { const r = await fetch(u); if (!r.ok) failed++; } catch { failed++; }
    done++;
    pill.textContent = Math.round((done / urls.length) * 100) + '%';
    sub.textContent = `Saving ${done} of ${urls.length}…`;
  }
  await refreshStorage();
  toast(failed ? `Saved, but ${failed} clip${failed === 1 ? '' : 's'} failed` : 'All audio available offline');
});

$('#clear-audio-btn').addEventListener('click', async () => {
  await caches.delete('sib-audio');
  await refreshStorage();
  toast('Saved audio cleared');
});

$('#clear-favs-btn').addEventListener('click', () => {
  if (!favs.size) return;
  favs.clear();
  store.set('favs', []);
  refreshFavsRow();
  renderList();
  toast('Favourites cleared');
});

/* ── Updates ─────────────────────────────────────────────────────────
   The worker no longer calls skipWaiting() on install, so a new version parks
   in `waiting` until the user accepts it here. */

let swReg = null;
let acceptedUpdate = false;

/* Whether a worker already controlled this page distinguishes an update from a
 * first install, and it is only unambiguous here — read at script evaluation,
 * before any registration. Later the initial worker's clients.claim() sets a
 * controller mid-install, and a first install briefly parks in `waiting` before
 * auto-activating; both would otherwise make a brand new visitor's first load
 * look like an update and offer to update them to what they just downloaded. */
const HAD_CONTROLLER = 'serviceWorker' in navigator && !!navigator.serviceWorker.controller;

function setUpdateStatus(text) { $('#update-status').textContent = text; }

function showUpdatePrompt() {
  if (!HAD_CONTROLLER) return;   // a first install is not an update
  $('#update-bar').hidden = false;
  setUpdateStatus('Update ready to install');
}

$('#update-later').addEventListener('click', () => {
  $('#update-bar').hidden = true;
  toast('You can update from the menu any time');
});

$('#update-now').addEventListener('click', () => {
  const waiting = swReg && swReg.waiting;
  if (!waiting) { $('#update-bar').hidden = true; return location.reload(); }
  acceptedUpdate = true;
  $('#update-now').textContent = 'Updating…';
  waiting.postMessage({ type: 'SKIP_WAITING' });
});

$('#check-btn').addEventListener('click', () => checkForUpdate(true));

async function checkForUpdate(manual) {
  if (!swReg) return;
  const pill = $('#check-pill');
  if (manual) { pill.dataset.state = 'busy'; pill.textContent = 'Checking'; setUpdateStatus('Checking…'); }
  try {
    await swReg.update();
    // `update()` resolves once the check completes, but a newly found worker
    // still has to install before it reaches `waiting`.
    if (swReg.installing) {
      await new Promise(res => {
        const w = swReg.installing;
        w.addEventListener('statechange', function on() {
          if (w.state === 'installed' || w.state === 'redundant') {
            w.removeEventListener('statechange', on); res();
          }
        });
        setTimeout(res, 12000);
      });
    }
    if (swReg.waiting) {
      showUpdatePrompt();
      if (manual) { delete pill.dataset.state; pill.textContent = 'Update'; }
    } else if (manual) {
      pill.dataset.state = 'done';
      pill.textContent = 'Latest';
      setUpdateStatus(`You're on the newest version (${BUILD_LABEL})`);
      setTimeout(() => { delete pill.dataset.state; pill.textContent = 'Check'; }, 2600);
    }
  } catch {
    if (manual) {
      delete pill.dataset.state;
      pill.textContent = 'Check';
      setUpdateStatus('Could not check — you may be offline');
    }
  }
}

function initServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  // Whether a worker controlled this page *at load* is what distinguishes an
  // update from a first install. It can't be read later: the initial worker's
  // clients.claim() sets a controller mid-install, which would make a brand new
  // visitor's first load look like an update and prompt them to update to the
  // version they just downloaded.
  const hadController = !!navigator.serviceWorker.controller;

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // Only reload for an update the user actually asked for; the very first
    // registration also fires this when it claims the page.
    if (acceptedUpdate) location.reload();
  });

  // updateViaCache:'none' keeps the browser from serving sw.js out of the HTTP
  // cache, which would otherwise hide new versions for up to 24 hours.
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' })
    .then(reg => {
      swReg = reg;
      if (reg.waiting && hadController) showUpdatePrompt();

      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener('statechange', () => {
          // A worker reaching `installed` when one already controlled the page
          // means this is an update, not a first install.
          if (nw.state === 'installed' && hadController) showUpdatePrompt();
        });
      });

      if (prefs.autocheck !== false) checkForUpdate(false);
      else setUpdateStatus('Automatic checking is off');
    })
    .catch(() => setUpdateStatus('Updates unavailable'));
}

/* ── Boot ────────────────────────────────────────────────────────────── */

playbackFailed = msg => { stopPlayback(); toast(msg); };

applyPrefs();
renderChips();
renderList();
updateSpeedUI();
updateModeUI();
refreshInstallSection();
renderQuickbar();
applyDeepLink();

window.addEventListener('load', initServiceWorker);

})();
