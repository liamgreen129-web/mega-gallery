// sw-main.js — service worker that turns encrypted MEGA files into ordinary,
// seekable HTTP responses for <video>/<img>. It answers Range requests with
// 206 Partial Content, fetching only the needed byte ranges from MEGA and
// decrypting them (AES-CTR, random access) as they stream through.
// Nothing is cached: responses are marked no-store and never put in CacheStorage.
//
// URL handled:  ./__mg/stream/<nodeHandle>/<filename>
// The page registers {folder, key, size, mime} for the handle in IndexedDB
// ('streams' store) and also posts it here, so the SW survives being restarted.

const api = new MegaApi({ maxConcurrent: 2 });
const streamInfo = new Map(); // handle -> info
const dlUrls = new Map();     // handle -> {url, at}
const DL_URL_TTL = 20 * 60 * 1000;
const OPEN_RANGE_CAP = 24 * 1024 * 1024; // answer "bytes=N-" with at most 24 MB; the player asks again
const FIRST_CHUNK = 256 * 1024;          // small first upstream range -> fast start
const MAX_CHUNK = 4 * 1024 * 1024;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('message', (e) => {
  const m = e.data || {};
  if (m.type === 'stream' && m.info) streamInfo.set(m.info.id, m.info);
  if (m.type === 'ping' && e.source) e.source.postMessage({ type: 'sw-pong' });
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;
  const m = url.pathname.match(/\/__mg\/stream\/([\w-]{8})(?:\/|$)/);
  if (!m) return; // everything else goes to the network untouched
  e.respondWith(serveStream(e.request, m[1], e.clientId));
});

async function getInfo(h) {
  for (let i = 0; i < 20; i++) {
    const hit = streamInfo.get(h) || (await idbGet('streams', h));
    if (hit) { streamInfo.set(h, hit); return hit; }
    await sleep(100); // the page may still be writing the registration
  }
  return null;
}

async function downloadUrl(info, fresh) {
  const hit = dlUrls.get(info.id);
  if (!fresh && hit && Date.now() - hit.at < DL_URL_TTL) return hit.url;
  const { url } = await getDownloadUrl(api, info.folder, info.id);
  dlUrls.set(info.id, { url, at: Date.now() });
  return url;
}

async function notify(clientId, msg) {
  try {
    const list = clientId ? [await self.clients.get(clientId)] : await self.clients.matchAll();
    for (const c of list) if (c) c.postMessage(msg);
  } catch { /* ignore */ }
}

function parseRange(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec((header || '').trim());
  if (!m || (m[1] === '' && m[2] === '')) return null;
  let start, end, open = false;
  if (m[1] === '') { // suffix: last N bytes
    start = Math.max(0, size - Number(m[2]));
    end = size - 1;
  } else {
    start = Number(m[1]);
    if (m[2] === '') { end = size - 1; open = true; } else end = Math.min(Number(m[2]), size - 1);
  }
  if (start > end || start >= size) return { invalid: true };
  return { start, end, open };
}

async function serveStream(req, h, clientId) {
  const info = await getInfo(h);
  if (!info) return new Response('Stream not registered', { status: 404 });
  const size = info.size;
  const headers = {
    'Content-Type': info.mime || 'application/octet-stream',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store',
  };
  if (size === 0) return new Response(new Uint8Array(0), { status: 200, headers: { ...headers, 'Content-Length': '0' } });

  const rangeHeader = req.headers.get('Range');
  let start = 0, end = size - 1, status = 200;
  if (rangeHeader) {
    const r = parseRange(rangeHeader, size);
    if (r && r.invalid) return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${size}` } });
    if (r) {
      start = r.start;
      end = r.open ? Math.min(r.end, start + OPEN_RANGE_CAP - 1) : r.end;
      status = 206;
      headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
    }
  }
  headers['Content-Length'] = String(end - start + 1);
  if (req.method === 'HEAD') return new Response(null, { status, headers });
  return new Response(decryptedStream(info, start, end, clientId), { status, headers });
}

function decryptedStream(info, start, end, clientId) {
  const ac = new AbortController();
  const gen = produce(info, start, end, ac.signal);
  return new ReadableStream({
    async pull(ctrl) {
      try {
        for (;;) {
          const { value, done } = await gen.next();
          if (done) { ctrl.close(); return; }
          if (value && value.length) { ctrl.enqueue(value); return; }
        }
      } catch (err) {
        if (ac.signal.aborted) return;
        notify(clientId, { type: 'stream-error', id: info.id, message: String(err.message || err), code: err.code });
        ctrl.error(err);
      }
    },
    cancel() {
      ac.abort();
      gen.return(undefined).catch(() => {});
    },
  });
}

// Yields decrypted bytes for [start, end] in order. Upstream requests grow from
// 256 KB to 4 MB; each one is read progressively so bytes reach the player as
// they arrive. A dropped connection resumes once from the last good offset.
async function* produce(info, start, end, signal) {
  const ctx = fileCtrParams(info.key);
  let pos = start - (start % 16); // CTR needs block-aligned offsets
  let skip = start - pos;
  let chunk = FIRST_CHUNK;
  let refreshed = false;
  while (pos <= end) {
    const to = Math.min(end, pos + chunk - 1);
    let p = pos;
    let resumed = false;
    for (;;) {
      let resp;
      try {
        const url = await downloadUrl(info, false);
        resp = await fetch(`${url}/${p}-${to}`, { signal, cache: 'no-store' });
      } catch (err) {
        if (signal.aborted) throw err;
        if (resumed) throw new Error('Network error while streaming from MEGA');
        resumed = true;
        await sleep(800, signal);
        continue;
      }
      if (resp.status === 509) {
        const left = Number(resp.headers.get('X-MEGA-Time-Left')) || 0;
        throw new MegaError(-17, left ? `resets in ~${Math.ceil(left / 60)} min` : 'bandwidth limit');
      }
      if (resp.status === 403 || resp.status === 404 || resp.status === 410) {
        if (refreshed) throw new Error(`MEGA refused the download (HTTP ${resp.status})`);
        refreshed = true;
        dlUrls.delete(info.id);
        continue; // temp URL expired — get a new one
      }
      if (!resp.ok || !resp.body) throw new Error(`MEGA download HTTP ${resp.status}`);
      const reader = resp.body.getReader();
      let carry = null;
      try {
        for (;;) {
          const { value, done } = await reader.read();
          let buf = value ? (carry ? concat(carry, value) : value) : carry;
          carry = null;
          if (done) {
            if (buf && buf.length) { yield trim(await ctrDecrypt(ctx, p, buf)); p += buf.length; }
            break;
          }
          const n = buf.length - (buf.length % 16);
          if (n) { yield trim(await ctrDecrypt(ctx, p, buf.subarray(0, n))); p += n; }
          if (n < buf.length) carry = buf.slice(n);
        }
      } catch (err) {
        if (signal.aborted) throw err;
        if (resumed) throw err;
        resumed = true; // resume this range from the last decrypted block
        continue;
      }
      if (p <= to) {
        if (resumed) throw new Error('MEGA ended the stream early');
        resumed = true;
        continue;
      }
      break;
    }
    pos = to + 1;
    chunk = Math.min(MAX_CHUNK, chunk * 2);
  }

  function trim(out) {
    if (!skip) return out;
    if (out.length <= skip) { skip -= out.length; return new Uint8Array(0); }
    const r = out.subarray(skip);
    skip = 0;
    return r;
  }
}

function concat(a, b) {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}
