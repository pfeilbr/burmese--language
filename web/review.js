/* Native-speaker review: go through every phrase, mark it OK or Fix, and send
   the result back as plain text. The README calls a native read-through the
   single most valuable thing this project could get; this page is what makes
   asking for one a five-minute favour rather than a spreadsheet. */

(() => {
'use strict';

const DATA = window.PHRASE_DATA;
const KEY = 'sib.review';

/** { [phraseId]: { v: 'ok' | 'fix', note: string } } -- kept on the device so
 *  a reviewer can stop halfway and pick up later. */
let marks = {};
try { marks = JSON.parse(localStorage.getItem(KEY)) || {}; } catch {}
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(marks)); } catch {} };

const $ = sel => document.querySelector(sel);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { t.hidden = true; }, 2200);
}

function itemHtml(p) {
  const m = marks[p.id] || {};
  return `<section class="item" data-id="${p.id}" data-state="${m.v || ''}">
    <div class="item-top">
      <div class="item-text">
        <p class="en">${esc(p.en)}</p>
        <p class="my" lang="my">${esc(p.my)}</p>
        <p class="say">${esc(p.phon)}</p>
        ${p.note ? `<p class="note">${esc(p.note)}</p>` : ''}
      </div>
      <button class="play" data-play="${p.id}" aria-label="Play ${esc(p.en)}">▶</button>
    </div>
    <div class="verdict">
      <button data-v="ok" aria-pressed="${m.v === 'ok'}">OK</button>
      <button data-v="fix" aria-pressed="${m.v === 'fix'}">Fix</button>
    </div>
    <textarea class="fix-note" placeholder="What would you actually say?" ${m.v === 'fix' ? '' : 'hidden'}>${esc(m.note || '')}</textarea>
  </section>`;
}

function render() {
  const onlyTodo = $('#only-todo').checked;
  $('#items').innerHTML = DATA.categories.map(c => {
    const items = DATA.phrases.filter(p => p.cat === c.id && !(onlyTodo && marks[p.id]));
    if (!items.length) return '';
    return `<h2 class="cat">${c.emoji} ${esc(c.name)}</h2>` + items.map(itemHtml).join('');
  }).join('') || '<p class="lead">Every phrase has been checked. Thank you!</p>';
  renderCount();
}

function renderCount() {
  const done = DATA.phrases.filter(p => marks[p.id]).length;
  const fixes = DATA.phrases.filter(p => marks[p.id] && marks[p.id].v === 'fix').length;
  $('#count').textContent = `${done} of ${DATA.phrases.length} checked · ${fixes} to fix`;
}

/** Plain text, so it survives any chat app or email it gets pasted into. The
 *  ids let a fix be matched to its entry in data/phrases.json directly. */
function report() {
  const done = DATA.phrases.filter(p => marks[p.id]);
  const fixes = done.filter(p => marks[p.id].v === 'fix');
  const lines = [
    `Say It In Burmese — phrase check`,
    `${done.length} of ${DATA.phrases.length} checked, ${fixes.length} to fix.`,
    '',
  ];
  for (const p of fixes) {
    lines.push(`• ${p.en}  [${p.id}]`);
    lines.push(`  now: ${p.my}`);
    lines.push(`  fix: ${marks[p.id].note.trim() || '(no note)'}`);
    lines.push('');
  }
  const ok = done.filter(p => marks[p.id].v === 'ok').map(p => p.id);
  if (ok.length) lines.push(`OK: ${ok.join(', ')}`);
  return lines.join('\n');
}

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Report copied');
  } catch {
    toast('Copy failed');
  }
}

/* ── Audio: one element, the natural-speed clip ── */
const audio = new Audio();
let playingId = null;
function setPlaying(id) {
  document.querySelectorAll('.play.playing').forEach(n => n.classList.remove('playing'));
  playingId = id;
  if (id) {
    const n = document.querySelector(`[data-play="${id}"]`);
    if (n) n.classList.add('playing');
  }
}
audio.addEventListener('ended', () => setPlaying(null));

$('#items').addEventListener('click', e => {
  const play = e.target.closest('[data-play]');
  if (play) {
    const id = play.dataset.play;
    if (playingId === id) { audio.pause(); return setPlaying(null); }
    audio.src = `audio/${id}.natural.mp3`;
    audio.play().then(() => setPlaying(id)).catch(() => toast('Could not play that clip'));
    return;
  }
  const btn = e.target.closest('[data-v]');
  if (!btn) return;
  const item = btn.closest('.item');
  const id = item.dataset.id;
  const v = btn.dataset.v;
  // Tapping the selected verdict again clears it.
  if (marks[id] && marks[id].v === v) delete marks[id];
  else marks[id] = { v, note: (marks[id] && marks[id].note) || '' };
  save();
  const m = marks[id];
  item.dataset.state = m ? m.v : '';
  item.querySelectorAll('[data-v]').forEach(b => b.setAttribute('aria-pressed', String(!!m && b.dataset.v === m.v)));
  const note = item.querySelector('.fix-note');
  note.hidden = !m || m.v !== 'fix';
  if (!note.hidden) note.focus();
  renderCount();
});

$('#items').addEventListener('input', e => {
  if (!e.target.classList.contains('fix-note')) return;
  const id = e.target.closest('.item').dataset.id;
  if (marks[id]) { marks[id].note = e.target.value; save(); }
});

$('#only-todo').addEventListener('change', render);
$('#copy-report').addEventListener('click', () => copy(report()));
$('#send-report').addEventListener('click', async () => {
  const text = report();
  if (typeof navigator.share === 'function') {
    try { await navigator.share({ text }); return; }
    catch (err) { if (err && err.name === 'AbortError') return; }
  }
  copy(text);
});

render();

})();
