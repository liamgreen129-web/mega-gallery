// worker.js — Web Worker: folder walks, thumbnail fetch/decrypt/cache, previews,
// and the no-service-worker fallback download. Keeps all crypto and JSON parsing
// of large listings off the main thread. Uses symbols from core.js and idb.js.
// Can also run in-page (same code, `self` shimmed) if a Worker can't be created.

const api = new MegaApi({ maxConcurrent: 3 });
const jobs = new Map(); // job -> AbortController
const post = (msg, transfer) => self.postMessage(msg, transfer || []);

const THUMB_CACHE_MAX = 30000; // ~300–400 MB worst case; oldest dropped first
const BATCH_MAX = 120;          // handles per POST (latency is flat in batch size)
const MAX_ACTIVE = 6;           // concurrent attribute POSTs (each to a different cluster)
const CLUSTER_URL_TTL = 15 * 60 * 1000;

self.onmessage = (e) => {
  const m = e.data;
  handle(m).catch((err) => {
    if (m.req) post({ type: 'res', req: m.req, error: String(err && err.message || err) });
  });
};

async function handle(m) {
  switch (m.type) {
    case 'ping': return post({ type: 'pong' });
    case 'list': return doList(m);
    case 'cancel': { const ac = jobs.get(m.job); if (ac) ac.abort(); return; }
    case 'cached': return doCached(m);
    case 'forget': await idbDelete('listings', m.cid); return;
    case 'thumbs': return setWanted(m.want);
    case 'preview': return doPreview(m);
    case 'full': return doFull(m);
    case 'cacheStats': return post({ type: 'res', req: m.req, thumbs: await idbCount('thumbs'), blocks: await idbSumBlocks() });
    case 'clearThumbs': await idbClear('thumbs'); return post({ type: 'res', req: m.req, ok: true });
    case 'clearBlocks': await idbClear('blocks'); return post({ type: 'res', req: m.req, ok: true });
  }
}

// ------------------------------------------------------------ tree walk
async function doList(m) {
  const ac = new AbortController();
  jobs.set(m.job, ac);
  try {
    let last = 0;
    const res = await listFolder(api, m.link, {
      signal: ac.signal,
      onProgress: (p) => {
        const now = Date.now();
        if (p.phase !== 'decrypt' || now - last > 120) { last = now; post({ type: 'progress', job: m.job, ...p }); }
      },
    });
    const data = { id: m.cid, root: res.root, nodes: res.nodes, needsKey: res.needsKey, at: Date.now() };
    post({ type: 'listed', job: m.job, cid: m.cid, data });
    idbPut('listings', data);
  } catch (err) {
    post({ type: 'listError', job: m.job, cid: m.cid, error: String(err.message || err), code: err.code, aborted: err.name === 'AbortError' });
  } finally {
    jobs.delete(m.job);
  }
}

async function doCached(m) {
  const rows = await idbGetMany('listings', m.cids);
  post({ type: 'res', req: m.req, rows: rows.map((r) => r || null) });
}

// ------------------------------------------------------------ thumbnails
// The page sends its full "want list" (visible tiles first, then prefetch) whenever
// the viewport settles. We serve IndexedDB hits immediately, then fetch misses from
// MEGA in per-cluster batches, highest-priority cluster first.
const T = {
  wanted: new Map(),   // id -> item, in priority order
  lookup: new Set(),   // ids with an IDB lookup in flight
  pending: new Map(),  // id -> item waiting for network
  inflight: new Set(),
  busy: new Set(),     // cluster keys with a POST in flight
  active: 0,
  urls: new Map(),     // cluster key -> {servers, at}
};

async function setWanted(list) {
  T.wanted = new Map(list.map((it) => [it.id, it]));
  const check = list.filter((it) => !T.lookup.has(it.id) && !T.pending.has(it.id) && !T.inflight.has(it.id));
  if (check.length) {
    for (const it of check) T.lookup.add(it.id);
    const rows = await idbGetMany('thumbs', check.map((it) => it.id));
    check.forEach((it, i) => {
      T.lookup.delete(it.id);
      const row = rows[i];
      if (row && row.b) post({ type: 'thumb', id: it.id, buf: row.b, cached: true }, [row.b]);
      else if (row && row.none) post({ type: 'thumb', id: it.id, none: true });
      else T.pending.set(it.id, it);
    });
  }
  pump();
}

function pump() {
  while (T.active < MAX_ACTIVE) {
    const groups = new Map();
    let best = null;
    for (const id of T.wanted.keys()) {
      const it = T.pending.get(id);
      if (!it) continue;
      const ck = it.folder + ':' + it.c;
      if (T.busy.has(ck)) continue;
      let g = groups.get(ck);
      if (!g) { groups.set(ck, (g = [])); if (!best) best = ck; }
      if (g.length < BATCH_MAX) g.push(it);
    }
    if (!best) return;
    const items = groups.get(best);
    for (const it of items) { T.pending.delete(it.id); T.inflight.add(it.id); }
    T.busy.add(best);
    T.active++;
    runBatch(best, items).finally(() => {
      T.busy.delete(best);
      T.active--;
      pump();
    });
  }
}

async function clusterServers(ck, folder, fah, fresh) {
  const hit = T.urls.get(ck);
  if (!fresh && hit && Date.now() - hit.at < CLUSTER_URL_TTL) return hit.servers;
  const servers = await faServers(api, folder, fah);
  T.urls.set(ck, { servers, at: Date.now() });
  return servers;
}

async function runBatch(ck, items) {
  let got = null;
  for (let attempt = 0; attempt < 2 && !got; attempt++) {
    try {
      const servers = await clusterServers(ck, items[0].folder, items[0].fah, attempt > 0);
      got = await postFileAttributes(servers, 0, items.map((it) => ({ id: it.id, fah: it.fah, key: it.k })));
    } catch (err) {
      console.warn('[mega-gallery worker] thumbnail batch failed', ck, err);
      T.urls.delete(ck);
      if (attempt === 0) await sleep(700 + Math.random() * 600);
    }
  }
  const now = Date.now();
  const puts = [];
  for (const it of items) {
    T.inflight.delete(it.id);
    if (!got) { post({ type: 'thumb', id: it.id, error: true }); continue; }
    const data = got.get(it.id);
    if (data && data.length) {
      const buf = data.slice().buffer;
      puts.push({ id: it.id, b: buf.slice(0), at: now });
      post({ type: 'thumb', id: it.id, buf }, [buf]);
    } else {
      puts.push({ id: it.id, none: 1, at: now });
      post({ type: 'thumb', id: it.id, none: true });
    }
  }
  if (puts.length) {
    await idbPutMany('thumbs', puts);
    if (Math.random() < 0.05) idbTrimThumbs(THUMB_CACHE_MAX);
  }
}

// ------------------------------------------------------------ previews (type 1, ~1000px) — transient, not cached
async function doPreview(m) {
  const ck = m.folder + ':' + m.c;
  let got = null, lastErr = null;
  for (let attempt = 0; attempt < 2 && !got; attempt++) {
    try {
      const servers = await clusterServers(ck, m.folder, m.fah, attempt > 0);
      got = await postFileAttributes(servers, 1, [{ id: m.id, fah: m.fah, key: m.k }]);
    } catch (err) { lastErr = err; }
  }
  const data = got && got.get(m.id);
  if (data && data.length) {
    const buf = data.slice().buffer;
    post({ type: 'res', req: m.req, buf }, [buf]);
  } else {
    post({ type: 'res', req: m.req, error: lastErr ? String(lastErr.message) : 'No preview' });
  }
}

// ------------------------------------------------------------ fallback full download (no service worker)
// Only used when streaming via the service worker isn't possible (file://, SW blocked).
// Downloads in 4 MB ranges, decrypts with AES-CTR, returns one ArrayBuffer.
async function doFull(m) {
  const ac = new AbortController();
  jobs.set(m.req, ac);
  try {
    const { url } = await getDownloadUrl(api, m.folder, m.id, { signal: ac.signal });
    const ctx = fileCtrParams(m.k);
    const out = new Uint8Array(m.size);
    const CH = 4 * 1024 * 1024;
    for (let pos = 0; pos < m.size; pos += CH) {
      const end = Math.min(m.size, pos + CH) - 1;
      const r = await fetch(`${url}/${pos}-${end}`, { signal: ac.signal });
      if (r.status === 509) throw new MegaError(-17, 'MEGA bandwidth limit reached');
      if (!r.ok) throw new Error(`Download HTTP ${r.status}`);
      const ct = new Uint8Array(await r.arrayBuffer());
      out.set(await ctrDecrypt(ctx, pos, ct), pos);
      post({ type: 'fullProgress', req: m.req, loaded: end + 1, total: m.size });
    }
    post({ type: 'res', req: m.req, buf: out.buffer }, [out.buffer]);
  } finally {
    jobs.delete(m.req);
  }
}
