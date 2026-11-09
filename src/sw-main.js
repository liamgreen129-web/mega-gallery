// sw-main.js — service worker that turns encrypted MEGA files into ordinary,
// seekable HTTP responses for <video>/<img>. It answers Range requests with
// 206 Partial Content, fetching only the needed byte ranges from MEGA and
// decrypting them (AES-CTR, random access) as they stream through.
// Responses are no-store and never put in CacheStorage; only encrypted 1 MB blocks are cached (see below).
//
// URL handled:  ./__mg/stream/<nodeHandle>/<filename>
// The page registers {folder, key, size, mime} for the handle in IndexedDB
// ('streams' store) and also posts it here, so the SW survives being restarted.

const api = new MegaApi({ maxConcurrent: 2 });
const streamInfo = new Map(); // handle -> info
const dlUrls = new Map();     // handle -> {url, at}  (resolved once per file; 403/404 triggers a refresh)
const DL_URL_TTL = 6 * 60 * 60 * 1000;
const OPEN_RANGE_CAP = 24 * 1024 * 1024; // answer "bytes=N-" with at most 24 MB; the player asks again
const FIRST_CHUNK = 256 * 1024;          // small first upstream range -> fast start (feed cards pass a bigger hint)
const MAX_CHUNK = 4 * 1024 * 1024;

// ---------------------------------------------------------------- encrypted block cache
// Ciphertext is cached in 1 MB file-aligned blocks: a small in-memory LRU (always on) plus a
// persistent IndexedDB LRU (settings: 'meta'/'blockCache' {enabled, max}). Decrypted bytes
// never persist; a cached block is decrypted again on every read.
const BLOCK = 1024 * 1024;
const MEM_CACHE_MAX = 32 * 1024 * 1024;
const BLOCK_CACHE_DEFAULT_MAX = 500 * 1024 * 1024;
const mem = new Map(); // blockId -> Uint8Array
let memBytes = 0;
let cacheCfg = null, cacheCfgAt = 0, writtenSinceTrim = 0;

function memGet(id) {
  const b = mem.get(id);
  if (b) { mem.delete(id); mem.set(id, b); }
  return b;
}
function memPut(id, b) {
  if (mem.has(id)) return;
  mem.set(id, b);
  memBytes += b.length;
  while (memBytes > MEM_CACHE_MAX && mem.size > 1) {
    const [k, v] = mem.entries().next().value;
    mem.delete(k);
    memBytes -= v.length;
  }
}
async function getCacheCfg() {
  if (cacheCfg && Date.now() - cacheCfgAt < 30000) return cacheCfg;
  const row = await idbGet('meta', 'blockCache');
  cacheCfg = { enabled: row ? row.enabled !== false : true, max: (row && row.max) || BLOCK_CACHE_DEFAULT_MAX };
  cacheCfgAt = Date.now();
  return cacheCfg;
}
async function getBlock(info, bi) {
  const id = info.id + ':' + bi;
  const m = memGet(id);
  if (m) return m;
  const cfg = await getCacheCfg();
  if (!cfg.enabled) return null;
  const row = await idbGet('blocks', id);
  if (!row || !row.b) return null;
  const u = new Uint8Array(row.b);
  memPut(id, u);
  if (Date.now() - row.at > 10 * 60 * 1000) idbPut('blocks', { ...row, at: Date.now() }); // LRU touch, rate-limited
  return u;
}
async function putBlock(info, bi, u8) {
  const id = info.id + ':' + bi;
  memPut(id, u8);
  const cfg = await getCacheCfg();
  if (!cfg.enabled) return;
  await idbPut('blocks', { id, h: info.id, b: u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength), n: u8.byteLength, at: Date.now() });
  writtenSinceTrim += u8.byteLength;
  if (writtenSinceTrim > 16 * BLOCK) { writtenSinceTrim = 0; idbTrimBlocks(cfg.max).catch(() => {}); }
}

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('message', (e) => {
  const m = e.data || {};
  if (m.type === 'stream' && m.info) streamInfo.set(m.info.id, m.info);
  if (m.type === 'ping' && e.source) e.source.postMessage({ type: 'sw-pong' });
  if (m.type === 'cacheCfg') { cacheCfg = { enabled: !!m.enabled, max: m.max || BLOCK_CACHE_DEFAULT_MAX }; cacheCfgAt = Date.now(); }
  if (m.type === 'cacheClear') { mem.clear(); memBytes = 0; }
  if (m.type === 'warmUrl' && m.info) { // resolve the download URL ahead of playback
    streamInfo.set(m.info.id, m.info);
    downloadUrl(m.info, false).catch(() => {});
  }
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

// Yields decrypted bytes for [start, end] in order. Works in 1 MB file-aligned blocks:
// a block already in the cache is served with zero network; the rest is fetched from
// MEGA in ranges growing from firstChunk (256 KB, or the registration's hint) to 4 MB,
// read progressively so bytes reach the player as they arrive, and every block that
// completes on the way is stored. A dropped connection resumes once from the last good offset.
async function* produce(info, start, end, signal) {
  const ctx = fileCtrParams(info.key);
  const size = info.size;
  const EMPTY = new Uint8Array(0);
  let pos = start - (start % 16); // CTR needs block-aligned offsets
  let chunk = Math.max(16 * 1024, info.firstChunk || FIRST_CHUNK);
  let acc = null, accBi = -1; // ciphertext accumulator for the block being filled

  const clip = (p, plain) => {
    const s = Math.max(0, start - p), e = Math.min(plain.length, end + 1 - p);
    return e <= s ? EMPTY : (s === 0 && e === plain.length ? plain : plain.subarray(s, e));
  };
  // Feed ciphertext at absolute offset p into the per-block accumulator; store completed blocks.
  const absorb = (p, bytes) => {
    let o = 0;
    while (o < bytes.length) {
      const at = p + o;
      const bi = Math.floor(at / BLOCK);
      const bStart = bi * BLOCK, bLen = Math.min(BLOCK, size - bStart);
      if (bi !== accBi) {
        if (at === bStart) { accBi = bi; acc = new Uint8Array(bLen); } else { accBi = -1; acc = null; }
      }
      const take = Math.min(bytes.length - o, bStart + bLen - at);
      if (acc) acc.set(bytes.subarray(o, o + take), at - bStart);
      o += take;
      if (acc && at + take === bStart + bLen) { putBlock(info, bi, acc).catch(() => {}); acc = null; accBi = -1; }
    }
  };

  while (pos <= end) {
    const bi = Math.floor(pos / BLOCK);
    if (pos === bi * BLOCK) {
      const cached = await getBlock(info, bi);
      if (cached) {
        yield clip(pos, await ctrDecrypt(ctx, pos, cached));
        pos += cached.length;
        acc = null; accBi = -1;
        continue;
      }
    }
    let to = Math.min(end, pos + chunk - 1);
    for (let b = bi + 1; b * BLOCK <= to; b++) if (mem.has(info.id + ':' + b)) { to = b * BLOCK - 1; break; }
    yield* fetchRange(info, ctx, pos, to, signal, clip, absorb);
    pos = to + 1;
    chunk = Math.min(MAX_CHUNK, chunk * 2);
  }
}

async function* fetchRange(info, ctx, from, to, signal, clip, absorb) {
  let p = from;
  let resumed = false, refreshed = false;
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
          if (buf && buf.length) { absorb(p, buf); yield clip(p, await ctrDecrypt(ctx, p, buf)); p += buf.length; }
          break;
        }
        const n = buf.length - (buf.length % 16);
        if (n) { const ct = buf.subarray(0, n); absorb(p, ct); yield clip(p, await ctrDecrypt(ctx, p, ct)); p += n; }
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
    return;
  }
}

function concat(a, b) {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}
