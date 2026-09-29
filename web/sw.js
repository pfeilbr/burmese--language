/* Offline cache and update channel.
 *
 * BUILD is rewritten by the deploy workflow with the commit SHA. That matters
 * for more than cache naming: the browser decides whether an update exists by
 * byte-comparing this file, so if sw.js were identical between deploys no
 * update would ever be detected no matter what else changed.
 */

const BUILD = '__BUILD__';

const SHELL_CACHE = `sib-shell-${BUILD}`;
const AUDIO_CACHE = 'sib-audio';   // unversioned: a clip's bytes never change

/* Two strategies, because the two kinds of asset have opposite needs:
 *
 *   audio/*.mp3  — cache-first. A clip is immutable: its content is fully
 *                  determined by the phrase id and track in its filename, so a
 *                  cache hit is always correct and never worth a round trip.
 *                  Kept across updates so an upgrade doesn't re-download 3 MB.
 *
 *   app shell    — network-first, falling back to cache. Cache-first here would
 *                  pin users to whatever HTML/CSS/JS they first loaded, with no
 *                  way to ship a fix. The cache is the offline safety net, not
 *                  the source of truth.
 */

/* The ?v= stamps must match the ones index.html requests, or the precache would
   store URLs the page never asks for. Both files are stamped with the same
   BUILD by the deploy workflow, so they stay in lockstep.

   The Burmese font is precached rather than left to the audio cache or the
   network: without it the script falls back to whatever the device has, which
   on Windows is nothing and on a Zawgyi phone is the wrong letters entirely. */
const SHELL = [
  './',
  'index.html',
  `styles.css?v=${BUILD}`,
  `app.js?v=${BUILD}`,
  `data/phrases.js?v=${BUILD}`,
  // The review page is often opened on someone else's phone, somewhere
  // without signal; it shouldn't depend on having been visited first.
  'review.html',
  `review.js?v=${BUILD}`,
  'fonts/NotoSansMyanmar-subset.woff2',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', e => {
  // Deliberately no skipWaiting() here. The new worker parks in `waiting` so
  // the page can offer the user an update rather than swapping the app out
  // from under them mid-sentence. app.js sends SKIP_WAITING when they accept.
  e.waitUntil(caches.open(SHELL_CACHE).then(c => c.addAll(SHELL)));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== SHELL_CACHE && k !== AUDIO_CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', e => {
  const type = e.data && e.data.type;
  if (type === 'SKIP_WAITING') self.skipWaiting();
  if (type === 'GET_BUILD') e.source.postMessage({ type: 'BUILD', build: BUILD });
});

const cachePut = (cacheName, req, res) => {
  // 206 Partial Content (from media range requests) is not cacheable.
  if (res && res.ok && res.status === 200) {
    const copy = res.clone();
    caches.open(cacheName).then(c => c.put(req, copy));
  }
  return res;
};

/* Safari fetches media with a Range header (it opens with bytes=0-1) and will
   not play a clip answered with a plain 200 from a service worker -- which is
   what a cache hit is. So offline audio on an iPhone, the one place it has to
   work, needs the range served as a real 206. And on a miss the whole file is
   fetched rather than the range, because a 206 can't be cached: forwarding the
   range as-is would mean nothing played on Safari ever got saved. */
async function audioResponse(req) {
  const key = req.url;
  let full = await caches.match(key);
  if (!full) {
    const res = await fetch(key);
    if (!res.ok) return res;
    await caches.open(AUDIO_CACHE).then(c => c.put(key, res.clone()));
    full = res;
  }
  const range = req.headers.get('range');
  if (!range) return full;
  return sliceRange(full, range);
}

async function sliceRange(res, header) {
  const buf = await res.arrayBuffer();
  const size = buf.byteLength;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  let start, end;
  if (m && m[1] !== '') {
    start = Number(m[1]);
    end = m[2] !== '' ? Math.min(Number(m[2]), size - 1) : size - 1;
  } else if (m && m[2] !== '') {
    // bytes=-N: the last N bytes.
    start = Math.max(0, size - Number(m[2]));
    end = size - 1;
  }
  if (start === undefined || start >= size || start > end) {
    return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
  }
  return new Response(buf.slice(start, end + 1), {
    status: 206,
    headers: {
      'Content-Type': res.headers.get('Content-Type') || 'audio/mpeg',
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Content-Length': String(end - start + 1),
      'Accept-Ranges': 'bytes',
    },
  });
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.endsWith('.mp3')) {
    e.respondWith(audioResponse(req));
    return;
  }

  // The font is immutable and its filename identifies its contents, so it gets
  // the same cache-first treatment as a clip — and revalidating it on every
  // launch would stall first paint of the one script that needs it.
  if (url.pathname.endsWith('.woff2')) {
    e.respondWith(
      caches.match(req).then(hit =>
        hit || fetch(req).then(res => cachePut(SHELL_CACHE, req, res))
      )
    );
    return;
  }

  // `cache: 'no-cache'` forces revalidation with the server. A plain fetch()
  // still consults the browser's HTTP cache, and GitHub Pages serves HTML with
  // max-age=600 — so without this, "network-first" would happily hand back a
  // ten-minute-old index.html and the deploy would appear not to have landed.
  // Revalidation is cheap: unchanged files come back as a 304.
  e.respondWith(
    fetch(new Request(req.url, { cache: 'no-cache', credentials: 'same-origin' }))
      .then(res => cachePut(SHELL_CACHE, req, res))
      .catch(() => caches.match(req).then(hit => hit || caches.match('index.html')))
  );
});
