// app.js — page UI. Uses core.js + idb.js symbols (inlined by the build) and
// WORKER_SRC (the worker bundle as a string, injected by the build).

// ================================================================ helpers
const $ = (s, root = document) => root.querySelector(s);
const make = (tag, cls) => { const e = document.createElement(tag); if (cls) e.className = cls; return e; };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const ICON = {
  refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg>',
  link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.5 1.5"/><path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.5-1.5"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  prev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>',
  next: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>',
  folder: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 6.5A2.5 2.5 0 0 1 5.5 4h3.6c.7 0 1.3.3 1.8.8L12.3 6H18.5A2.5 2.5 0 0 1 21 8.5v9a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z"/></svg>',
  play: '<svg viewBox="0 0 10 10" fill="currentColor"><path d="M1 0.5v9l8-4.5z"/></svg>',
  feed: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M10.5 9v6l5-3z" fill="currentColor" stroke="none"/></svg>',
  home: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="3" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5"/></svg>',
};

function fmtBytes(n) {
  if (!n) return '0 B';
  if (n < 1024) return n + ' B';
  const u = ['KB', 'MB', 'GB', 'TB', 'PB'];
  let i = -1;
  do { n /= 1024; i++; } while (n >= 1024 && i < u.length - 1);
  return (n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2)) + ' ' + u[i];
}
const fmtNum = (n) => n.toLocaleString();
function fmtDur(s) {
  s = Math.round(s);
  const h = (s / 3600) | 0, m = ((s % 3600) / 60) | 0, x = s % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0');
}
const fmtDate = (t) => (t ? new Date(t * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '');
function fmtAgo(ms) {
  const s = (Date.now() - ms) / 1000;
  if (s < 90) return 'just now';
  if (s < 3600) return Math.round(s / 60) + ' min ago';
  if (s < 86400 * 2) return Math.round(s / 3600) + ' h ago';
  return Math.round(s / 86400) + ' days ago';
}

const EXT_COLORS = [
  [/^(jpe?g|jpe|jfif|png|gif|webp|heic|heif|avif|bmp|tiff?|svg|dng|cr2|cr3|nef|arw|orf|rw2|raf)$/, [59, 130, 196]],
  [/^(mp4|m4v|mov|webm|mkv|avi|wmv|flv|3gp|3g2|mpe?g|ts|mts|m2ts|ogv|vob|f4v)$/, [139, 92, 246]],
  [/^(mp3|m4a|aac|flac|wav|ogg|oga|opus|wma|aiff?)$/, [217, 70, 122]],
  [/^(zip|rar|7z|tar|gz|tgz|bz2|xz|zst|iso|dmg|cab|00\d)$/, [201, 138, 27]],
  [/^pdf$/, [214, 69, 69]],
  [/^(docx?|odt|rtf|txt|md|pages|epub)$/, [47, 125, 225]],
  [/^(xlsx?|csv|ods|numbers)$/, [46, 157, 91]],
  [/^(pptx?|odp|key)$/, [224, 112, 46]],
  [/^(exe|msi|apk|ipa|app|deb|rpm|pkg|bin|img)$/, [91, 107, 122]],
];
function extBg(ext) {
  let c = [107, 114, 128];
  for (const [re, rgb] of EXT_COLORS) if (re.test(ext)) { c = rgb; break; }
  return `linear-gradient(140deg, rgba(${c},.55), rgba(${c},.18))`;
}

function lsGet(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } }
function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* quota/private */ } }

let toastTimer = 0;
function toast(msg, ms = 4200) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

// ================================================================ constants & state
const LS = { links: 'mg.links', view: 'mg.view', scroll: 'mg.scroll', folder: 'mg.folder', vcache: 'mg.vcache' };

// ---- Feed mode tunables
// Videos with a known duration join the feed when longer than FEED_MIN_SECONDS. Files MEGA
// stored no duration for fall back to a size gate: tune MIN_FEED_VIDEO_BYTES up or down to
// match how big a ~10 s clip is in your library (placeholder: 5 MB).
const MIN_FEED_VIDEO_BYTES = 5 * 1024 * 1024;
const FEED_MIN_SECONDS = 10;
const FEED_MAX_CARDS = 400;                    // cards per visit (the shuffle picks them)
const FEED_SKIP_EXT = new Set(['wmv', 'avi', 'mpg', 'mpeg']);
const FEED_FIRST_CHUNK = 1024 * 1024;          // first upstream range for feed streams (SW hint)
const FEED_BLOCK = 1024 * 1024;                // must match BLOCK in sw-main.js
const FEED_TAIL_BYTES = 256 * 1024;            // moov-at-end MP4s: warm the tail too
const FEED_MAX_PREFETCH = 3;                   // videos buffering at once (focused + queued)
const VIDEO_CACHE_MAX_BYTES = 500 * 1024 * 1024; // persistent encrypted block cache cap
const STALE_MS = 60 * 60 * 1000; // re-list a folder in the background when the cached copy is older
const KIND = { folder: 0, photo: 1, video: 2, other: 3 };
const TILE_TARGET = { s: 82, m: 118, l: 178 };
const GAP = 2;
const LIST_ROW = 58;
const VIEW_DEFAULT = { flat: true, kind: 'media', sort: 'size-desc', q: '', mode: 'm' };
const IS_IOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.userAgent.includes('Macintosh') && navigator.maxTouchPoints > 1);
const SW_CAPABLE = 'serviceWorker' in navigator && window.isSecureContext && location.protocol !== 'file:';
const FALLBACK_MAX = IS_IOS ? 120 * 1024 * 1024 : 400 * 1024 * 1024; // in-memory fallback when no SW

const S = {
  links: [],
  view: { ...VIEW_DEFAULT, ...lsGet(LS.view, {}), folder: null },
  items: [],
  stats: null,
  dataVer: 0,
  scrollMemo: lsGet(LS.scroll, {}),
  ready: false,
  swReady: false,
  vcache: { enabled: true, max: VIDEO_CACHE_MAX_BYTES, ...lsGet(LS.vcache, {}) },
};
S.view.q = ''; // search is not restored across sessions (it surprises more than it helps)

// ================================================================ worker bridge
const W = (() => {
  let w = null;
  let seq = 0;
  const pending = new Map();
  const handlers = {};
  const progress = new Map();

  function onMsg(m) {
    if (m.type === 'res') {
      const p = pending.get(m.req);
      if (!p) return;
      pending.delete(m.req);
      progress.delete(m.req);
      if (m.error) p.reject(new Error(m.error)); else p.resolve(m);
      return;
    }
    if (m.type === 'fullProgress') { const cb = progress.get(m.req); if (cb) cb(m); return; }
    const h = handlers[m.type];
    if (h) h(m);
  }

  function startInPage() {
    // Same worker code on the main thread (e.g. if Workers from blob: URLs are blocked).
    const shim = { onmessage: null, postMessage: (m) => setTimeout(() => onMsg(m), 0) };
    new Function('self', WORKER_SRC)(shim);
    w = { postMessage: (m) => setTimeout(() => shim.onmessage({ data: m }), 0), terminate() {} };
    console.warn('[mega-gallery] Running worker code on the main thread');
  }

  async function start() {
    try {
      const url = URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' }));
      const real = new Worker(url);
      const ok = await new Promise((resolve) => {
        const t = setTimeout(() => resolve(false), 2500);
        real.onmessage = (e) => { if (e.data && e.data.type === 'pong') { clearTimeout(t); resolve(true); } };
        real.onerror = () => { clearTimeout(t); resolve(false); };
        real.postMessage({ type: 'ping' });
      });
      if (ok) {
        real.onmessage = (e) => onMsg(e.data);
        w = real;
        return;
      }
      real.terminate();
    } catch (err) { /* fall through */ }
    startInPage();
  }

  return {
    start,
    on: (type, fn) => { handlers[type] = fn; },
    post: (msg, transfer) => w.postMessage(msg, transfer || []),
    call(type, data, onProgress) {
      const req = 'r' + ++seq;
      return new Promise((resolve, reject) => {
        pending.set(req, { resolve, reject });
        if (onProgress) progress.set(req, onProgress);
        w.postMessage({ type, req, ...data });
      });
    },
  };
})();

// ================================================================ links
function makeLink(p, name) {
  return {
    id: p.id, key: p.key, sub: p.sub, url: p.url,
    cid: p.id + (p.sub ? '.' + p.sub : ''),
    name: name || null,
    status: 'idle', error: null, prog: null, job: 0,
    nodes: null, kids: null, root: null, at: 0, needsKey: !p.key,
    files: 0, bytes: 0, photos: 0, videos: 0, thumbs: 0,
  };
}
const linkByCid = (cid) => S.links.find((L) => L.cid === cid);
const linkByJob = (job) => S.links.find((L) => L.job === job);
function saveLinks() { lsSet(LS.links, S.links.map((L) => ({ url: L.url, name: L.name }))); }

function loadLinks() {
  for (const row of lsGet(LS.links, [])) {
    try { S.links.push(makeLink(parseMegaLink(row.url), row.name)); } catch { /* drop unparsable */ }
  }
}

function addLinksFromText(text) {
  const tokens = String(text).split(/[\s,]+/).filter(Boolean);
  // Re-join tokens that are part of one link when a key was pasted after a space
  const added = [], errors = [], dupes = [];
  for (const tok of tokens) {
    if (!/mega|#F!|^F!/i.test(tok)) { errors.push(`Not a MEGA link: ${tok.slice(0, 40)}`); continue; }
    let p;
    try { p = parseMegaLink(tok); } catch (e) { errors.push(e.message); continue; }
    const cid = p.id + (p.sub ? '.' + p.sub : '');
    const old = linkByCid(cid);
    if (old) {
      if (p.key && p.key !== old.key) { old.key = p.key; old.url = p.url; old.needsKey = false; listLink(old); added.push(old); }
      else dupes.push(old.name || p.id);
      continue;
    }
    const L = makeLink(p);
    S.links.push(L);
    listLink(L);
    added.push(L);
  }
  saveLinks();
  renderLinks();
  return { added, errors, dupes };
}

function removeLink(L) {
  if (L.job) W.post({ type: 'cancel', job: L.job });
  S.links = S.links.filter((x) => x !== L);
  W.post({ type: 'forget', cid: L.cid });
  saveLinks();
  if (S.view.folder && S.view.folder.cid === L.cid) navigate(null, { replace: true });
  dataChanged();
}

let jobSeq = 0;
function listLink(L) {
  if (L.job) W.post({ type: 'cancel', job: L.job });
  L.job = ++jobSeq;
  L.status = 'loading';
  L.error = null;
  L.prog = { phase: 'fetch' };
  W.post({ type: 'list', job: L.job, cid: L.cid, link: { id: L.id, key: L.key, sub: L.sub } });
  renderLinks();
  updateProgress();
}

function refreshAll() {
  for (const L of S.links) listLink(L);
}

W.on('progress', (m) => {
  const L = linkByJob(m.job);
  if (!L) return;
  L.prog = m;
  renderLinkRow(L);
  updateProgress();
});
W.on('listed', (m) => {
  const L = linkByJob(m.job);
  if (!L) return;
  L.job = 0;
  L.status = 'ok';
  L.prog = null;
  indexLink(L, m.data);
  saveLinks();
  dataChanged();
});
W.on('listError', (m) => {
  const L = linkByJob(m.job);
  if (!L) return;
  L.job = 0;
  L.prog = null;
  if (m.aborted) L.status = L.nodes ? 'ok' : 'cancelled';
  else { L.status = 'error'; L.error = m.error; if (!S.sheetOpen) toast(`${L.name || L.id}: ${m.error}`); }
  renderLinks();
  updateProgress();
  renderHeader();
});

/** Build parent->children index and folder aggregates for one link's listing. */
function indexLink(L, data) {
  const nodes = new Map();
  const kids = new Map();
  let photos = 0, videos = 0, thumbs = 0;
  for (const r of data.nodes) {
    r.L = L;
    if (r.n === null) r.n = (r.t ? 'Folder ' : 'File ') + r.h; // no key: names stay encrypted
    r.K = KIND[kindOf(r)];
    r.x = extOf(r.n);
    if (r.t) { r.fs = 0; r.fc = 0; }
    if (r.k && r.fa) {
      const t = parseFa(r.fa).thumb;
      if (t) { r.tc = t.c; r.tf = t.h; thumbs++; }
    }
    if (r.K === 1) photos++;
    else if (r.K === 2) videos++;
    nodes.set(r.h, r);
    if (r.p) {
      let a = kids.get(r.p);
      if (!a) kids.set(r.p, (a = []));
      a.push(r);
    }
  }
  // Recursive folder sizes / file counts (walk each file up its parent chain).
  for (const r of data.nodes) {
    if (r.t) continue;
    let p = r.p;
    let guard = 0;
    while (p && guard++ < 256) {
      const f = nodes.get(p);
      if (!f) break;
      f.fs += r.s;
      f.fc++;
      p = f.p;
    }
  }
  const root = nodes.get(data.root);
  L.nodes = nodes;
  L.kids = kids;
  L.root = data.root;
  L.at = data.at;
  L.needsKey = data.needsKey;
  if (root && !data.needsKey) L.name = root.n;
  if (root && data.needsKey) root.n = L.name || `Folder ${L.id}`;
  L.files = root ? root.fc : 0;
  L.bytes = root ? root.fs : 0;
  L.photos = photos;
  L.videos = videos;
  L.thumbs = thumbs;
  if (L.status !== 'loading') L.status = data.needsKey ? 'needs-key' : 'ok';
}

// ================================================================ view computation
const coll = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const sizeOf = (r) => (r.t ? r.fs : r.s);
const CMP = {
  'size-desc': (a, b) => sizeOf(b) - sizeOf(a) || coll.compare(a.n, b.n),
  'size-asc': (a, b) => sizeOf(a) - sizeOf(b) || coll.compare(a.n, b.n),
  'name-asc': (a, b) => coll.compare(a.n, b.n),
  'name-desc': (a, b) => coll.compare(b.n, a.n),
  'date-desc': (a, b) => b.mt - a.mt || coll.compare(a.n, b.n),
  'date-asc': (a, b) => a.mt - b.mt || coll.compare(a.n, b.n),
  type: (a, b) => a.K - b.K || (a.x < b.x ? -1 : a.x > b.x ? 1 : 0) || coll.compare(a.n, b.n),
};

const C = { baseKey: '', base: [], sortKey: '', sorted: [] };
const folderKey = (f = S.view.folder) => (f ? f.cid + '/' + f.h : '');
const viewKey = () => { const v = S.view; return `${folderKey()}|${v.flat ? 1 : 0}|${v.kind}|${v.sort}|${v.q}|${v.mode}`; };

function collect(L, h, out, seen, withFolders) {
  const stack = [h];
  while (stack.length) {
    const ch = L.kids.get(stack.pop());
    if (!ch) continue;
    for (const r of ch) {
      if (r.t) { stack.push(r.h); if (!withFolders) continue; }
      if (seen) { if (seen.has(r.h)) continue; seen.add(r.h); }
      out.push(r);
    }
  }
}

function computeBase(flat, withFolders) {
  const f = S.view.folder;
  const links = S.links.filter((L) => L.nodes);
  if (!f) {
    if (!flat) return links.map((L) => L.nodes.get(L.root)).filter(Boolean);
    const out = [];
    const seen = links.length > 1 ? new Set() : null; // two links may share files
    for (const L of links) collect(L, L.root, out, seen, withFolders);
    return out;
  }
  const L = linkByCid(f.cid);
  if (!L || !L.nodes || !L.nodes.has(f.h)) return [];
  if (!flat) return (L.kids.get(f.h) || []).slice();
  const out = [];
  collect(L, f.h, out, null, withFolders);
  return out;
}

function recompute() {
  const v = S.view;
  const q = v.q.trim().toLowerCase();
  const flat = v.flat || !!q;
  const withFolders = !!q || v.kind === 'folder';
  const bk = `${S.dataVer}|${folderKey()}|${flat}|${withFolders}`;
  if (bk !== C.baseKey) { C.base = computeBase(flat, withFolders); C.baseKey = bk; C.sortKey = ''; }
  const sk = bk + '|' + v.sort;
  if (sk !== C.sortKey) {
    const cmp = CMP[v.sort] || CMP['size-desc'];
    C.sorted = C.base.slice().sort(flat ? cmp : (a, b) => b.t - a.t || cmp(a, b));
    C.sortKey = sk;
  }
  const items = [];
  let bytes = 0;
  const n = [0, 0, 0, 0];
  for (const r of C.sorted) {
    const k = r.K;
    switch (v.kind) {
      case 'media': if (k !== 1 && k !== 2 && (flat || k !== 0)) continue; break;
      case 'photo': if (k !== 1 && (flat || k !== 0)) continue; break;
      case 'video': if (k !== 2 && (flat || k !== 0)) continue; break;
      case 'other': if (k !== 3 && (flat || k !== 0)) continue; break;
      case 'folder': if (k !== 0) continue; break;
    }
    if (q && !(r.lc || (r.lc = r.n.toLowerCase())).includes(q)) continue;
    items.push(r);
    n[k]++;
    // Flattened views can mix a folder with its own files (search, Folders chip):
    // count file bytes only there so the total never double-counts.
    if (!flat || k !== 0) bytes += sizeOf(r);
  }
  if (flat && v.kind === 'folder' && !q) {
    // Nested folders overlap, so their sizes can't be summed: report the scope's real total.
    const f = S.view.folder;
    const L = f && linkByCid(f.cid);
    bytes = f ? ((L && L.nodes && L.nodes.get(f.h)) || { fs: 0 }).fs : S.links.reduce((a, x) => a + (x.nodes ? x.bytes : 0), 0);
  }
  S.items = items;
  S.stats = { count: items.length, bytes, folders: n[0], photos: n[1], videos: n[2], other: n[3], flat };
}

// ================================================================ virtual grid
const sizer = $('#sizer');
const G = { cols: 1, tile: 0, rowH: 1, w: 0, top: 0, list: false, live: new Map(), pool: [] };

function layout() {
  const mode = S.view.mode;
  G.list = mode === 'list';
  const w = sizer.clientWidth || window.innerWidth;
  G.w = w;
  if (G.list) { G.cols = 1; G.tile = w; G.rowH = LIST_ROW; }
  else {
    const t = TILE_TARGET[mode] || TILE_TARGET.m;
    G.cols = Math.max(2, Math.round((w + GAP) / (t + GAP)));
    G.tile = (w - GAP * (G.cols - 1)) / G.cols;
    G.rowH = G.tile + GAP;
  }
  const rows = Math.ceil(S.items.length / G.cols);
  sizer.style.height = Math.max(0, rows * G.rowH - (G.list ? 0 : GAP)) + 'px';
  sizer.classList.toggle('list', G.list);
  sizer.classList.toggle('show-size', S.view.sort.startsWith('size') && mode !== 's');
  $('#listHead').hidden = !G.list;
  G.top = sizer.getBoundingClientRect().top + window.scrollY;
}

function makeTile() {
  const el = make('div', 'tile');
  el.innerHTML = '<div class="ph"></div><img alt="" decoding="async" draggable="false"><span class="badge"></span><span class="size"></span><div class="cap"><div><div class="nm"></div><div class="mt"></div><div class="sub"></div></div><div class="dt"></div><div class="sz"></div></div>';
  const t = {
    el, ph: el.children[0], img: el.children[1], badge: el.children[2], size: el.children[3],
    nm: $('.nm', el), mt: $('.mt', el), sub: $('.sub', el), dt: $('.dt', el), sz: $('.sz', el),
    h: null, ver: -1, i: -1,
  };
  t.img.onload = () => el.classList.add('loaded');
  t.img.onerror = () => el.classList.remove('loaded');
  sizer.appendChild(el);
  return t;
}

function parentName(r) {
  const p = r.L.nodes.get(r.p);
  return p ? p.n : '';
}

function fillTile(t, r, i) {
  const col = i % G.cols, row = (i / G.cols) | 0;
  const x = G.list ? 0 : col * (G.tile + GAP);
  const y = row * G.rowH;
  const s = t.el.style;
  s.transform = `translate3d(${x}px,${y}px,0)`;
  s.width = (G.list ? G.w : G.tile) + 'px';
  s.height = (G.list ? G.rowH : G.tile) + 'px';
  if (t.hidden) { s.display = ''; t.hidden = false; }
  t.i = i;
  t.el.dataset.i = i;
  const ver = `${S.dataVer}|${S.view.mode}|${S.stats.flat}`;
  if (t.h === r.h && t.ver === ver) return; // same content, only moved
  t.h = r.h; t.ver = ver;
  t.el.className = 'tile k' + r.K;
  if (r.K === 0) {
    t.ph.style.background = '';
    t.ph.innerHTML = ICON.folder;
    t.mt.textContent = `${fmtNum(r.fc)} file${r.fc === 1 ? '' : 's'} · ${fmtBytes(r.fs)}`;
  } else {
    t.ph.style.background = extBg(r.x);
    t.ph.textContent = (r.x || '?').slice(0, 5).toUpperCase();
    t.mt.textContent = fmtBytes(r.s);
  }
  t.nm.textContent = r.n;
  t.size.textContent = fmtBytes(sizeOf(r));
  t.badge.innerHTML = r.K === 2 ? ICON.play + (r.d ? fmtDur(r.d) : '') : '';
  if (G.list) {
    t.sub.textContent = S.stats.flat ? parentName(r) : r.K === 0 ? `${fmtNum(r.fc)} files` : '';
    t.dt.textContent = fmtDate(r.mt);
    t.sz.textContent = fmtBytes(sizeOf(r));
  }
  const u = thumbGet(r.h);
  if (u) { t.img.src = u; if (t.img.complete && t.img.naturalWidth) t.el.classList.add('loaded'); }
  else t.img.removeAttribute('src');
}

function render(reset) {
  const n = S.items.length;
  if (reset) {
    for (const t of G.live.values()) { t.el.style.display = 'none'; t.hidden = true; t.h = null; G.pool.push(t); }
    G.live.clear();
  }
  if (!n) {
    for (const t of G.live.values()) { t.el.style.display = 'none'; t.hidden = true; G.pool.push(t); }
    G.live.clear();
    return;
  }
  const y = window.scrollY - G.top;
  const vh = window.innerHeight;
  const over = Math.max(240, vh * 0.5);
  const r0 = Math.max(0, Math.floor((y - over) / G.rowH));
  const r1 = Math.max(r0, Math.floor((y + vh + over) / G.rowH));
  const i0 = r0 * G.cols;
  const i1 = Math.min(n - 1, (r1 + 1) * G.cols - 1);
  for (const [i, t] of G.live) {
    if (i < i0 || i > i1) { G.live.delete(i); t.el.style.display = 'none'; t.hidden = true; G.pool.push(t); }
  }
  for (let i = i0; i <= i1; i++) {
    if (G.live.has(i)) continue;
    // Prefer a pooled tile that already shows this node (no image reload).
    let t = null;
    const r = S.items[i];
    for (let k = G.pool.length - 1; k >= 0 && k > G.pool.length - 40; k--) {
      if (G.pool[k].h === r.h) { t = G.pool.splice(k, 1)[0]; break; }
    }
    if (!t) t = G.pool.pop() || makeTile();
    fillTile(t, r, i);
    G.live.set(i, t);
  }
}

// ---------------------------------------------------------------- scrolling
let rafPending = false, lastY = 0, lastT = 0, thumbTimer = 0, lastWant = 0, scrollSaveTimer = 0;
function onScroll() {
  const now = performance.now();
  const y = window.scrollY;
  const vel = Math.abs(y - lastY) / Math.max(1, now - lastT); // px per ms
  lastY = y; lastT = now;
  if (!rafPending) { rafPending = true; requestAnimationFrame(() => { rafPending = false; render(false); }); }
  clearTimeout(thumbTimer);
  if (vel < 2 && now - lastWant > 220) requestThumbs(); // slow scroll: keep filling
  thumbTimer = setTimeout(requestThumbs, 150);          // fast fling: wait until it settles
  clearTimeout(scrollSaveTimer);
  scrollSaveTimer = setTimeout(saveScroll, 300);
}

function saveScroll() {
  if (!S.ready) return;
  const memo = S.scrollMemo;
  const k = viewKey();
  delete memo[k];
  memo[k] = Math.round(window.scrollY);
  const keys = Object.keys(memo);
  for (let i = 0; i < keys.length - 40; i++) delete memo[keys[i]];
  lsSet(LS.scroll, memo);
}

function restoreScroll() {
  const y = S.scrollMemo[viewKey()] || 0;
  window.scrollTo(0, y);
  lastY = window.scrollY;
}

// ================================================================ thumbnails
// Object URLs for decoded thumbnails, LRU-bounded so a long scroll session stays light.
const TH = { map: new Map(), none: new Set(), err: new Map(), MAX: IS_IOS ? 900 : 2500, net: 0, cached: 0 };

function thumbGet(h) {
  const u = TH.map.get(h);
  if (u) { TH.map.delete(h); TH.map.set(h, u); }
  return u;
}

function thumbEvict() {
  if (TH.map.size <= TH.MAX) return;
  const keep = new Set();
  for (const t of G.live.values()) keep.add(t.h);
  if (LB.r) keep.add(LB.r.h);
  if (OV.current === 'feed') for (const r of FEED.items) keep.add(r.h);
  for (const [h, u] of TH.map) {
    if (TH.map.size <= TH.MAX * 0.85) break;
    if (keep.has(h)) continue;
    URL.revokeObjectURL(u);
    TH.map.delete(h);
  }
}

W.on('thumb', (m) => {
  if (m.buf) {
    if (TH.map.has(m.id)) return;
    const u = URL.createObjectURL(new Blob([m.buf], { type: 'image/jpeg' }));
    TH.map.set(m.id, u);
    if (m.cached) TH.cached++; else TH.net++;
    for (const t of G.live.values()) {
      if (t.h === m.id) { t.el.classList.remove('loaded'); t.img.src = u; }
    }
    if (LB.r && LB.r.h === m.id && !$('#lbImg').getAttribute('src')) setLbImage(u, true);
    if (OV.current === 'feed') {
      const j = FEED.items.findIndex((r) => r.h === m.id);
      if (j >= 0) { const img = FEED.cards[j].querySelector('.feed-poster'); if (img && !img.getAttribute('src')) img.src = u; }
    }
    thumbEvict();
    scheduleStatus();
  } else if (m.none) {
    TH.none.add(m.id);
  } else if (m.error) {
    TH.err.set(m.id, Date.now());
  }
});

function requestThumbs() {
  lastWant = performance.now();
  const n = S.items.length;
  if (!n || OV.current === 'lb' || OV.current === 'player' || OV.current === 'feed') return;
  const y = window.scrollY - G.top;
  const vh = window.innerHeight;
  const v0 = Math.max(0, Math.floor(y / G.rowH) * G.cols);
  const v1 = Math.min(n - 1, (Math.floor((y + vh) / G.rowH) + 1) * G.cols - 1);
  const screen = Math.max(G.cols, v1 - v0 + 1);
  const want = [];
  const now = Date.now();
  const push = (i) => {
    const r = S.items[i];
    if (!r || !r.tf || TH.map.has(r.h) || TH.none.has(r.h)) return;
    const e = TH.err.get(r.h);
    if (e && now - e < 60000) return;
    want.push({ id: r.h, folder: r.L.id, c: r.tc, fah: r.tf, k: r.k });
  };
  for (let i = v0; i <= v1; i++) push(i);                                           // visible
  for (let i = v1 + 1; i <= Math.min(n - 1, v1 + screen * 3); i++) push(i);        // 3 screens ahead
  for (let i = v0 - 1; i >= Math.max(0, v0 - screen); i--) push(i);                 // 1 screen behind
  W.post({ type: 'thumbs', want: want.slice(0, 480) });
}

// ================================================================ header / chrome
function crumbChain() {
  const f = S.view.folder;
  if (!f) return [];
  const L = linkByCid(f.cid);
  if (!L || !L.nodes) return [];
  const chain = [];
  let r = L.nodes.get(f.h);
  let guard = 0;
  while (r && guard++ < 200) { chain.unshift(r); r = r.p ? L.nodes.get(r.p) : null; }
  return chain;
}

function renderHeader() {
  const v = S.view;
  // crumbs
  const cr = $('#crumbs');
  cr.innerHTML = '';
  const home = make('button', 'home');
  home.innerHTML = ICON.home + '<span>' + (S.links.length > 1 ? 'All folders' : (S.links[0] && S.links[0].name) || 'Mega Gallery') + '</span>';
  home.onclick = () => navigate(null);
  cr.appendChild(home);
  const chain = crumbChain();
  for (const r of chain) {
    if (S.links.length === 1 && !r.p) continue; // single link: its root is "home"
    const sep = make('span', 'sep');
    sep.textContent = '›';
    cr.appendChild(sep);
    const b = make('button');
    b.textContent = r.n;
    b.onclick = () => navigate({ cid: r.L.cid, h: r.h });
    cr.appendChild(b);
  }
  cr.scrollLeft = cr.scrollWidth;
  // controls
  $('#q').value !== v.q && ($('#q').value = v.q);
  $('#sort').value = v.sort;
  $('#mode').value = v.mode;
  for (const b of $('#flat').children) b.setAttribute('aria-pressed', String((b.dataset.flat === '1') === !!v.flat));
  for (const b of $('#chips').children) b.setAttribute('aria-pressed', String(b.dataset.kind === v.kind));
  for (const b of $('#listHead').children) b.classList.toggle('on', v.sort.startsWith(b.dataset.col));
  $('#linkCount').textContent = S.links.length ? `${S.links.length} link${S.links.length === 1 ? '' : 's'}` : 'Add links';
  renderStats();
  renderEmpty();
}

function renderStats() {
  const st = S.stats;
  if (!st) { $('#stats').textContent = ''; return; }
  const parts = [];
  if (st.photos) parts.push(`${fmtNum(st.photos)} photo${st.photos === 1 ? '' : 's'}`);
  if (st.videos) parts.push(`${fmtNum(st.videos)} video${st.videos === 1 ? '' : 's'}`);
  if (st.other) parts.push(`${fmtNum(st.other)} other`);
  if (st.folders) parts.push(`${fmtNum(st.folders)} folder${st.folders === 1 ? '' : 's'}`);
  $('#stats').innerHTML = `<b>${fmtNum(st.count)}</b> items · <b>${fmtBytes(st.bytes)}</b>` + (parts.length > 1 ? ` <span class="brk">· ${parts.join(', ')}</span>` : '');
  $('#stats').title = `${st.bytes.toLocaleString()} bytes total`;
}

let statusTimer = 0;
function scheduleStatus() {
  if (statusTimer) return;
  statusTimer = setTimeout(() => { statusTimer = 0; renderStatus(); }, 400);
}
function renderStatus() {
  const loading = S.links.filter((L) => L.status === 'loading');
  let s = '';
  if (loading.length) {
    const L = loading[0];
    const p = L.prog || {};
    s = p.phase === 'decrypt' ? `Decrypting ${L.name || L.id}… ${Math.round((p.done / p.total) * 100)}%` : `Listing ${L.name || L.id}…`;
    if (loading.length > 1) s += ` (+${loading.length - 1})`;
  } else if (TH.net || TH.cached) {
    s = `thumbs ${fmtNum(TH.cached)} cached · ${fmtNum(TH.net)} fetched`;
  }
  $('#status').textContent = s;
}

function updateProgress() {
  const loading = S.links.filter((L) => L.status === 'loading');
  const bar = $('#progress');
  const btn = $('#btnRefresh');
  btn.classList.toggle('spin', loading.length > 0);
  if (!loading.length) { bar.hidden = true; renderStatus(); return; }
  bar.hidden = false;
  const fr = loading.map((L) => (L.prog && L.prog.phase === 'decrypt' ? L.prog.done / L.prog.total : 0));
  const known = fr.some((x) => x > 0);
  bar.classList.toggle('indet', !known);
  bar.firstElementChild.style.width = known ? (100 * fr.reduce((a, b) => a + b, 0) / fr.length) + '%' : '';
  renderStatus();
}

function renderEmpty() {
  const e = $('#empty');
  let html = '';
  if (!S.links.length) {
    html = '<h3>No folders yet</h3><p>Add one or more public MEGA folder links to browse them here as one gallery.</p><button class="primary" data-act="links">Add folder links</button>';
  } else if (!S.items.length) {
    const loading = S.links.some((L) => L.status === 'loading');
    const anyData = S.links.some((L) => L.nodes);
    if (loading && !anyData) html = '<h3>Listing folders…</h3><p>Decrypting names and keys in your browser.</p>';
    else if (S.links.every((L) => L.status === 'error')) html = '<h3>Couldn\'t load your links</h3><p>Open Links to see what went wrong.</p><button class="primary" data-act="links">Open links</button>';
    else if (S.view.q) html = `<h3>No matches</h3><p>Nothing named “${esc(S.view.q)}” here.</p>`;
    else html = '<h3>Nothing to show</h3><p>Try another filter, or switch between “Folders” and “All files”.</p>';
  }
  e.innerHTML = html;
  e.hidden = !html;
}

// ================================================================ view changes & navigation
function persistView() {
  const { folder, q, ...rest } = S.view;
  lsSet(LS.view, rest);
  lsSet(LS.folder, folder);
}

function onViewChanged({ restore = true } = {}) {
  recompute();
  layout();
  render(true);
  renderHeader();
  if (restore) restoreScroll();
  render(false);
  requestThumbs();
  persistView();
}

/** Listings changed: keep the current scroll position. */
function dataChanged() {
  S.dataVer++;
  if (S.view.folder) {
    const L = linkByCid(S.view.folder.cid);
    if (!L || (L.nodes && !L.nodes.has(S.view.folder.h))) S.view.folder = null;
  }
  const y = window.scrollY;
  recompute();
  layout();
  render(true);
  renderHeader();
  window.scrollTo(0, y);
  render(false);
  requestThumbs();
  renderLinks();
  updateProgress();
}

function hashFor(f) { return f ? `#f=${f.cid}/${f.h}` : location.pathname + location.search; }
function parseHash() {
  const m = location.hash.match(/^#f=([\w.-]+)\/([\w-]{8})$/);
  return m ? { cid: m[1], h: m[2] } : null;
}

function navigate(folder, { replace = false } = {}) {
  if (folderKey(folder) === folderKey()) { window.scrollTo(0, 0); return; }
  saveScroll();
  S.view.folder = folder;
  if (S.view.q) { S.view.q = ''; }
  if (folder && S.view.kind === 'folder') S.view.kind = S.view.flat ? 'media' : 'all';
  const st = { f: folder };
  if (replace) history.replaceState(st, '', hashFor(folder)); else history.pushState(st, '', hashFor(folder));
  onViewChanged();
}

window.addEventListener('popstate', () => {
  if (OV.current) closeOverlayNow();
  const f = parseHash();
  if (folderKey(f) !== folderKey()) {
    saveScroll();
    S.view.folder = f;
    onViewChanged();
  }
});

// ================================================================ overlays (sheet, lightbox, player, info)
const OV = { current: null };
function openOverlay(name) {
  if (OV.current) closeOverlayNow();
  OV.current = name;
  $('#' + overlayId(name)).hidden = false;
  document.documentElement.style.overflow = 'hidden';
  history.pushState({ f: S.view.folder, ov: name }, '', location.href);
}
function overlayId(name) { return { links: 'sheet', lb: 'lb', player: 'player', info: 'info', feed: 'feed' }[name]; }
function closeOverlay() {
  if (!OV.current) return;
  if (history.state && history.state.ov) history.back(); // popstate closes it
  else closeOverlayNow();
}
function closeOverlayNow() {
  const name = OV.current;
  if (!name) return;
  OV.current = null;
  $('#' + overlayId(name)).hidden = true;
  document.documentElement.style.overflow = '';
  if (name === 'player') stopVideo();
  if (name === 'lb') closeLightbox();
  if (name === 'feed') stopFeed();
  if (name === 'links') S.sheetOpen = false;
  requestThumbs();
}

document.addEventListener('click', (e) => {
  const c = e.target.closest('[data-close]');
  if (c) { e.preventDefault(); closeOverlay(); return; }
  const a = e.target.closest('[data-act="links"]');
  if (a) openLinks();
});
for (const id of ['sheet', 'info']) {
  $('#' + id).addEventListener('click', (e) => { if (e.target.id === id) closeOverlay(); });
}

// ---------------------------------------------------------------- links sheet
function openLinks() {
  openOverlay('links');
  S.sheetOpen = true;
  renderLinks();
  $('#vcacheOn').checked = S.vcache.enabled;
  $('#vcacheMax').textContent = fmtBytes(S.vcache.max);
  refreshCacheInfo();
  if (!S.links.length) setTimeout(() => $('#linkInput').focus(), 50);
}

function linkStatusText(L) {
  const p = L.prog;
  if (L.status === 'loading') {
    if (p && p.phase === 'decrypt') return `Decrypting ${fmtNum(p.done)} / ${fmtNum(p.total)} nodes…`;
    return 'Listing folder tree…';
  }
  if (L.status === 'error') return L.error || 'Failed';
  if (L.status === 'cancelled') return 'Cancelled';
  if (!L.nodes) return 'Not loaded yet';
  const bits = [`${fmtNum(L.files)} files`, fmtBytes(L.bytes)];
  if (L.photos) bits.push(`${fmtNum(L.photos)} photos`);
  if (L.videos) bits.push(`${fmtNum(L.videos)} videos`);
  bits.push(`updated ${fmtAgo(L.at)}`);
  return bits.join(' · ');
}

function renderLinkRow(L) {
  const li = document.querySelector(`#linkList li[data-cid="${CSS.escape(L.cid)}"]`);
  if (!li) return renderLinks();
  const st = $('.lk-stat', li);
  st.textContent = linkStatusText(L);
  st.classList.toggle('err', L.status === 'error');
  const bar = $('.lk-bar', li);
  bar.hidden = L.status !== 'loading';
  if (L.prog && L.prog.phase === 'decrypt') bar.firstElementChild.style.width = (100 * L.prog.done / L.prog.total) + '%';
  $('[data-a="refresh"]', li).textContent = L.status === 'loading' ? 'Cancel' : 'Refresh';
}

function renderLinks() {
  $('#linkCount').textContent = S.links.length ? `${S.links.length} link${S.links.length === 1 ? '' : 's'}` : 'Add links';
  if (!S.sheetOpen) return;
  const ul = $('#linkList');
  ul.innerHTML = '';
  for (const L of S.links) {
    const li = make('li');
    li.dataset.cid = L.cid;
    li.innerHTML = `
      <div class="lk-row">
        <div class="lk-main">
          <div class="lk-name">${esc(L.name || 'Folder ' + L.id)}</div>
          <div class="lk-url">${esc(L.url)}</div>
          <div class="lk-stat"></div>
          <div class="lk-bar" hidden><div></div></div>
        </div>
        <div class="lk-btns"><button data-a="refresh">Refresh</button><button data-a="remove">Remove</button></div>
      </div>
      ${L.needsKey ? '<form class="lk-key"><input placeholder="Decryption key (22 characters)" autocomplete="off" autocapitalize="off" spellcheck="false"><button class="primary">Use key</button></form>' : ''}`;
    $('[data-a="refresh"]', li).onclick = () => {
      if (L.status === 'loading') W.post({ type: 'cancel', job: L.job });
      else listLink(L);
    };
    $('[data-a="remove"]', li).onclick = () => removeLink(L);
    const kf = $('.lk-key', li);
    if (kf) {
      kf.onsubmit = (e) => {
        e.preventDefault();
        const key = $('input', kf).value.trim().replace(/^#|^!/, '');
        try {
          const p = parseMegaLink(`https://mega.nz/folder/${L.id}#${key}${L.sub ? '/folder/' + L.sub : ''}`);
          L.key = p.key; L.url = p.url; L.needsKey = false;
          saveLinks();
          listLink(L);
        } catch (err) { toast(err.message); }
      };
    }
    ul.appendChild(li);
    renderLinkRow(L);
  }
}

$('#addForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $('#linkInput');
  const msg = $('#addMsg');
  const { added, errors, dupes } = addLinksFromText(input.value);
  const lines = [];
  if (added.length) lines.push(`Added ${added.length} link${added.length === 1 ? '' : 's'}.`);
  if (dupes.length) lines.push(`Already added: ${dupes.join(', ')}.`);
  if (errors.length) lines.push(errors.join(' '));
  msg.textContent = lines.join(' ');
  msg.className = 'form-msg ' + (errors.length && !added.length ? 'err' : 'ok');
  if (added.length && !errors.length) input.value = '';
  if (added.length) { renderHeader(); renderEmpty(); }
});
$('#linkInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#addForm').requestSubmit(); }
});
$('#btnRefreshAll').onclick = () => refreshAll();
$('#btnClearThumbs').onclick = async () => {
  await W.call('clearThumbs', {});
  toast('Thumbnail cache cleared.', 2000);
  refreshCacheInfo();
};
$('#btnClearVideo').onclick = async () => {
  await W.call('clearBlocks', {});
  try { navigator.serviceWorker.controller && navigator.serviceWorker.controller.postMessage({ type: 'cacheClear' }); } catch { /* ignore */ }
  toast('Video cache cleared.', 2000);
  refreshCacheInfo();
};
$('#vcacheOn').onchange = (e) => {
  S.vcache.enabled = e.target.checked;
  lsSet(LS.vcache, S.vcache);
  applyVideoCacheCfg();
};
function refreshCacheInfo() {
  W.call('cacheStats', {}).then((m) => {
    $('#cacheInfo').textContent = `${fmtNum(m.thumbs)} thumbnails cached · video cache ${fmtBytes(m.blocks || 0)} of ${fmtBytes(S.vcache.max)}${S.vcache.enabled ? '' : ' (off)'}.`;
  }).catch(() => {});
}
/** Tell the service worker (and its IndexedDB copy) whether/how much to cache. */
function applyVideoCacheCfg() {
  const cfg = { id: 'blockCache', enabled: !!S.vcache.enabled, max: S.vcache.max };
  idbPut('meta', cfg);
  try { navigator.serviceWorker.controller && navigator.serviceWorker.controller.postMessage({ type: 'cacheCfg', ...cfg }); } catch { /* ignore */ }
}

// ---------------------------------------------------------------- item activation
sizer.addEventListener('click', (e) => {
  const tile = e.target.closest('.tile');
  if (!tile) return;
  const i = +tile.dataset.i;
  const r = S.items[i];
  if (!r) return;
  if (r.K === 0) navigate({ cid: r.L.cid, h: r.h });
  else if (r.K === 1) openLightbox(i);
  else if (r.K === 2) openVideo(i);
  else openInfo(r);
});

function megaUrl(r) {
  const L = r.L;
  return `https://mega.nz/folder/${L.id}${L.key ? '#' + L.key : ''}/${r.t ? 'folder' : 'file'}/${r.h}`;
}

function pathOf(r) {
  const parts = [];
  let p = r.p ? r.L.nodes.get(r.p) : null;
  let guard = 0;
  while (p && guard++ < 200) { parts.unshift(p.n); p = p.p ? r.L.nodes.get(p.p) : null; }
  return parts.join(' / ');
}

function openInfo(r) {
  $('#infoName').textContent = r.n;
  const rows = [
    ['Size', `${fmtBytes(r.s)} (${r.s.toLocaleString()} bytes)`],
    ['Modified', fmtDate(r.mt)],
    ['Uploaded', fmtDate(r.ts)],
    ['Folder', pathOf(r)],
  ];
  if (r.d) rows.push(['Duration', fmtDur(r.d)]);
  $('#infoBody').innerHTML = rows.filter((x) => x[1]).map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('');
  $('#infoMega').href = megaUrl(r);
  openOverlay('info');
}

// ---------------------------------------------------------------- streaming via the service worker
function streamInfoOf(r, firstChunk) { return { id: r.h, folder: r.L.id, key: r.k, size: r.s, name: r.n, mime: mimeOf(r.n), firstChunk: firstChunk || 0 }; }
function streamUrl(r) { return `__mg/stream/${r.h}/${encodeURIComponent(r.n.replace(/[/\\?#]/g, '_'))}`; }
function canStream() { return S.swReady && !!navigator.serviceWorker.controller; }
function registerStream(r, { firstChunk = 0, warmUrl = false } = {}) {
  const info = streamInfoOf(r, firstChunk);
  try { navigator.serviceWorker.controller.postMessage({ type: warmUrl ? 'warmUrl' : 'stream', info }); } catch { /* idb copy suffices */ }
  return idbPut('streams', info);
}

async function setupServiceWorker() {
  if (!SW_CAPABLE) return;
  try {
    await navigator.serviceWorker.register('sw.js', { scope: './' });
    if (!navigator.serviceWorker.controller) {
      await new Promise((res) => {
        navigator.serviceWorker.addEventListener('controllerchange', res, { once: true });
        setTimeout(res, 5000);
      });
    }
    S.swReady = !!navigator.serviceWorker.controller;
  } catch (err) {
    console.warn('[mega-gallery] service worker unavailable:', err);
  }
  navigator.serviceWorker.addEventListener('message', (e) => {
    const m = e.data || {};
    if (m.type !== 'stream-error') return;
    const msg = m.code === -17 ? `MEGA transfer quota reached${m.message.includes('resets') ? ' — ' + m.message.split('(').pop().replace(')', '') : ''}. Try again later.` : m.message;
    if (OV.current === 'player') setMsg('#plMsg', esc(msg));
    else if (OV.current === 'feed') setMsg('#feedMsg', esc(msg));
    else if (OV.current === 'lb') setMsg('#lbMsg', esc(msg));
    else toast(msg);
  });
}

/** No service worker (file://, private mode): download + decrypt in the worker into memory. */
async function fallbackObjectUrl(r, msgSel) {
  if (r.s > FALLBACK_MAX) throw new Error(`Streaming needs the page served over https or localhost (service workers don't run on file://). This file is too big (${fmtBytes(r.s)}) to load into memory instead.`);
  const m = await W.call('full', { id: r.h, folder: r.L.id, k: r.k, size: r.s }, (p) => {
    setMsg(msgSel, `Loading into memory… ${Math.round((100 * p.loaded) / p.total)}%`);
  });
  setMsg(msgSel, '');
  return URL.createObjectURL(new Blob([m.buf], { type: mimeOf(r.n) }));
}

function setMsg(sel, html) { $(sel).innerHTML = html; }

// ---------------------------------------------------------------- lightbox
const LB = { i: -1, r: null, previews: new Map(), loading: new Map(), orig: null, origUrl: null, swipe: null };
const lbImg = $('#lbImg');

function photoIndex(from, dir) {
  for (let i = from + dir; i >= 0 && i < S.items.length; i += dir) if (S.items[i].K === 1) return i;
  return -1;
}

function openLightbox(i) {
  openOverlay('lb');
  $('#lb').classList.remove('chrome-off');
  showPhoto(i);
}

function setLbImage(src, blur) {
  lbImg.classList.toggle('blur', !!blur);
  if (src) lbImg.src = src; else lbImg.removeAttribute('src');
}

function loadPreview(r) {
  if (LB.previews.has(r.h)) return Promise.resolve(LB.previews.get(r.h));
  if (LB.loading.has(r.h)) return LB.loading.get(r.h);
  const pf = r.k && parseFa(r.fa).preview;
  if (!pf) return Promise.reject(new Error('no preview'));
  const p = W.call('preview', { id: r.h, folder: r.L.id, c: pf.c, fah: pf.h, k: r.k }).then((m) => {
    const u = URL.createObjectURL(new Blob([m.buf], { type: 'image/jpeg' }));
    LB.previews.set(r.h, u);
    while (LB.previews.size > 10) {
      const [h, old] = LB.previews.entries().next().value;
      if (LB.r && h === LB.r.h) break;
      URL.revokeObjectURL(old);
      LB.previews.delete(h);
    }
    return u;
  });
  LB.loading.set(r.h, p);
  p.then(() => LB.loading.delete(r.h), () => LB.loading.delete(r.h));
  return p;
}

function showPhoto(i) {
  const r = S.items[i];
  if (!r) return;
  LB.i = i;
  LB.r = r;
  dropOriginal();
  $('#lbName').textContent = r.n;
  $('#lbMeta').textContent = [fmtBytes(r.s), fmtDate(r.mt), pathOf(r)].filter(Boolean).join(' · ');
  $('#lbPrev').disabled = photoIndex(i, -1) < 0;
  $('#lbNext').disabled = photoIndex(i, 1) < 0;
  $('#lbOrig').textContent = r.x === 'gif' ? 'Play GIF' : 'Original';
  $('#lbOrig').hidden = false;
  setMsg('#lbMsg', '');
  const pv = LB.previews.get(r.h);
  const th = TH.map.get(r.h);
  setLbImage(pv || th, !pv && !!th);
  $('#lbSpin').hidden = !!pv;
  if (!pv) {
    loadPreview(r).then((u) => {
      if (LB.r !== r || LB.orig) return;
      setLbImage(u, false);
      $('#lbSpin').hidden = true;
    }, () => {
      if (LB.r !== r) return;
      $('#lbSpin').hidden = true;
      if (r.s <= 15 * 1024 * 1024) showOriginal(); // no server preview: small originals load directly
      else setMsg('#lbMsg', `No preview stored for this photo. <button data-orig>Load original (${fmtBytes(r.s)})</button>`);
    });
  }
  // Warm neighbours so swiping feels instant.
  for (const j of [photoIndex(i, 1), photoIndex(i, -1)]) if (j >= 0) loadPreview(S.items[j]).catch(() => {});
}

function dropOriginal() {
  if (LB.origUrl && LB.origUrl.startsWith('blob:')) URL.revokeObjectURL(LB.origUrl);
  LB.orig = null;
  LB.origUrl = null;
}

async function showOriginal() {
  const r = LB.r;
  if (!r || LB.orig === r) return;
  LB.orig = r;
  $('#lbOrig').hidden = true;
  $('#lbSpin').hidden = false;
  setMsg('#lbMsg', '');
  try {
    let url;
    if (canStream()) { await registerStream(r); url = streamUrl(r); }
    else url = await fallbackObjectUrl(r, '#lbMsg');
    if (LB.r !== r) { if (url.startsWith('blob:')) URL.revokeObjectURL(url); return; }
    LB.origUrl = url;
    const probe = new Image();
    probe.decoding = 'async';
    probe.onload = () => { if (LB.r === r) { setLbImage(url, false); $('#lbSpin').hidden = true; } };
    probe.onerror = () => {
      if (LB.r !== r) return;
      $('#lbSpin').hidden = true;
      setMsg('#lbMsg', `This browser can't display .${esc(r.x)} originals. <a href="${esc(megaUrl(r))}" target="_blank" rel="noopener noreferrer">Open in MEGA</a>`);
    };
    probe.src = url;
  } catch (err) {
    if (LB.r !== r) return;
    $('#lbSpin').hidden = true;
    setMsg('#lbMsg', esc(err.message));
  }
}

function closeLightbox() {
  dropOriginal();
  setLbImage(null);
  LB.r = null;
  LB.i = -1;
}

function lbStep(dir) {
  const j = photoIndex(LB.i, dir);
  if (j >= 0) showPhoto(j);
}

$('#lbPrev').innerHTML = ICON.prev;
$('#lbNext').innerHTML = ICON.next;
$('#lbPrev').onclick = (e) => { e.stopPropagation(); lbStep(-1); };
$('#lbNext').onclick = (e) => { e.stopPropagation(); lbStep(1); };
$('#lbOrig').onclick = () => showOriginal();
$('#lbMsg').addEventListener('click', (e) => { if (e.target.closest('[data-orig]')) showOriginal(); });

const stage = $('.lb-stage');
stage.addEventListener('touchstart', (e) => {
  LB.swipe = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() } : null;
}, { passive: true });
stage.addEventListener('touchend', (e) => {
  const s = LB.swipe;
  LB.swipe = null;
  if (!s || (window.visualViewport && window.visualViewport.scale > 1.02)) return; // pinch-zoomed: let it pan
  const t = e.changedTouches[0];
  const dx = t.clientX - s.x, dy = t.clientY - s.y, dt = Date.now() - s.t;
  if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.4) lbStep(dx < 0 ? 1 : -1);
  else if (dy > 90 && dy > Math.abs(dx) * 1.4) closeOverlay();
  else if (Math.abs(dx) < 10 && Math.abs(dy) < 10 && dt < 350) $('#lb').classList.toggle('chrome-off');
}, { passive: true });
stage.addEventListener('click', () => {
  if (!('ontouchstart' in window)) $('#lb').classList.toggle('chrome-off'); // touch toggles in touchend
});

// ---------------------------------------------------------------- video player
const vid = $('#vid');
const PL = { r: null, blobUrl: null };
const BROWSER_VIDEO = new Set(['mp4', 'm4v', 'mov', 'webm', 'mkv', '3gp', 'ogv']);

function openVideo(i) {
  const r = S.items[i];
  openOverlay('player');
  PL.r = r;
  $('#plName').textContent = r.n;
  const meta = [fmtBytes(r.s)];
  if (r.d) meta.push(fmtDur(r.d));
  if (r.w) meta.push(`${r.w}×${r.hh}`);
  meta.push(pathOf(r));
  $('#plMeta').textContent = meta.filter(Boolean).join(' · ');
  $('#plMega').href = megaUrl(r);
  vid.poster = LB.previews.get(r.h) || TH.map.get(r.h) || '';
  setMsg('#plMsg', '');
  if (!BROWSER_VIDEO.has(r.x)) {
    setMsg('#plMsg', `.${esc(r.x)} files usually can't play in a browser. <button data-try>Try anyway</button><a href="${esc(megaUrl(r))}" target="_blank" rel="noopener noreferrer">Open in MEGA</a>`);
    return;
  }
  startVideo(r);
}

async function startVideo(r) {
  setMsg('#plMsg', '');
  if (canStream()) {
    // Set src synchronously inside the tap so iOS allows playback to start.
    registerStream(r);
    vid.src = streamUrl(r);
    vid.play().catch(() => {});
    return;
  }
  try {
    const u = await fallbackObjectUrl(r, '#plMsg');
    if (PL.r !== r) { URL.revokeObjectURL(u); return; }
    PL.blobUrl = u;
    vid.src = u;
    vid.play().catch(() => {});
  } catch (err) {
    setMsg('#plMsg', esc(err.message));
  }
}

function stopVideo() {
  vid.pause();
  vid.removeAttribute('src');
  vid.removeAttribute('poster');
  vid.load(); // aborts the stream -> the SW cancels its upstream fetch
  if (PL.blobUrl) { URL.revokeObjectURL(PL.blobUrl); PL.blobUrl = null; }
  PL.r = null;
}

vid.addEventListener('error', () => {
  if (!PL.r || !vid.getAttribute('src')) return;
  const code = vid.error && vid.error.code;
  if (code === 4 || code === 3) setMsg('#plMsg', `This browser can't decode this video (${esc(PL.r.x)} / codec). <a href="${esc(megaUrl(PL.r))}" target="_blank" rel="noopener noreferrer">Open in MEGA</a>`);
  else if (!$('#plMsg').textContent) setMsg('#plMsg', 'Playback stopped (network error).');
});
$('#plMsg').addEventListener('click', (e) => { if (e.target.closest('[data-try]') && PL.r) startVideo(PL.r); });


// ---------------------------------------------------------------- feed (vertical video feed)
// Full-screen scroll-snap cards over the current view. Three <video> elements rotate across
// the cards around the focused one; everything else is a lightweight placeholder with the
// MEGA thumbnail as a blurred poster. Streams go through the service worker, whose block
// cache makes revisits instant; queued cards get their head/tail blocks warmed via Range fetches.
const FEED = {
  seed: (Math.random() * 0x100000000) >>> 0, // per-session shuffle seed (memory only)
  visits: 0,
  items: [], cards: [], vids: [],
  cur: -1, sound: false, unmuted: false,
  prefetch: new Map(), // handle -> {ac, tail}
  settleT: 0, scrubT: 0, scrollY: 0, scrubbing: false,
  scroller: $('#feedScroll'),
};

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Content gate: duration when MEGA stored one, otherwise the size fallback. */
function feedEligible(r) {
  if (r.K !== 2 || r.t || !r.k) return false;
  if (FEED_SKIP_EXT.has(r.x) || !BROWSER_VIDEO.has(r.x)) return false;
  if (r.d) return r.d > FEED_MIN_SECONDS;
  return r.s >= MIN_FEED_VIDEO_BYTES;
}

function feedList() {
  const out = S.items.filter(feedEligible);
  const rnd = mulberry32((FEED.seed ^ Math.imul(FEED.visits, 0x9E3779B9)) >>> 0);
  for (let i = out.length - 1; i > 0; i--) { // Fisher–Yates
    const j = Math.floor(rnd() * (i + 1));
    const t = out[i]; out[i] = out[j]; out[j] = t;
  }
  return out.slice(0, FEED_MAX_CARDS);
}

function makeFeedVideo() {
  const v = document.createElement('video');
  v.playsInline = true;
  v.setAttribute('playsinline', '');
  v.setAttribute('webkit-playsinline', '');
  v.muted = true;
  v.loop = true;
  v.preload = 'metadata';
  v.addEventListener('playing', () => { if (v.parentElement) v.parentElement.classList.add('playing'); });
  v.addEventListener('timeupdate', () => { if (v === feedCurVid()) updateFeedBar(v); });
  v.addEventListener('error', () => {
    if (v !== feedCurVid() || !v.getAttribute('src')) return;
    const code = v.error && v.error.code;
    const r = FEED.items[FEED.cur];
    if (code === 4 || code === 3) setMsg('#feedMsg', `This browser can't decode this video (${esc(r.x)} / codec). Swipe on.`);
  });
  return v;
}

function openFeed() {
  if (!S.items.length) return;
  if (!canStream()) { toast('The feed needs streaming, which only works when the page is served over https (not file://).'); return; }
  FEED.visits++;
  const items = feedList();
  if (!items.length) { toast(`No feed-worthy videos in this view (longer than ${FEED_MIN_SECONDS} s).`); return; }
  FEED.scrollY = window.scrollY;
  saveScroll();
  openOverlay('feed');
  FEED.items = items;
  FEED.cur = -1;
  const sc = FEED.scroller;
  sc.innerHTML = '';
  FEED.cards = [];
  const frag = document.createDocumentFragment();
  items.forEach((r, i) => {
    const c = make('div', 'feed-card');
    c.dataset.i = i;
    const img = make('img', 'feed-poster');
    img.alt = '';
    img.decoding = 'async';
    img.draggable = false;
    const th = thumbGet(r.h);
    if (th) img.src = th;
    c.appendChild(img);
    c.appendChild(make('div', 'spinner'));
    frag.appendChild(c);
    FEED.cards.push(c);
  });
  sc.appendChild(frag);
  sc.scrollTop = 0;
  if (!FEED.vids.length) for (let k = 0; k < 3; k++) FEED.vids.push(makeFeedVideo());
  $('#feedHint').hidden = FEED.unmuted;
  $('#feedFill').style.width = '0';
  setMsg('#feedMsg', '');
  setFeedIndex(0, true); // inside the tap: iOS lets playback start
  feedWantThumbs();
}

function feedCurVid() {
  if (FEED.cur < 0) return null;
  return FEED.vids[FEED.cur % 3];
}

function setFeedIndex(i, force) {
  const n = FEED.items.length;
  i = Math.max(0, Math.min(n - 1, i));
  if (i === FEED.cur && !force) return;
  const prev = FEED.cur;
  FEED.cur = i;
  const r = FEED.items[i];
  $('#feedName').textContent = r.n;
  $('#feedMeta').textContent = [r.d ? fmtDur(r.d) : '', fmtBytes(r.s), pathOf(r)].filter(Boolean).join(' · ');
  $('#feedCount').textContent = `${i + 1} / ${n}`;
  setMsg('#feedMsg', '');
  if (prev >= 0 && FEED.cards[prev]) FEED.cards[prev].classList.remove('cur');
  FEED.cards[i].classList.add('cur');
  // Slots: the three consecutive cards i-1, i, i+1 map to distinct videos (j % 3).
  for (let k = -1; k <= 1; k++) {
    const j = i + k;
    if (j < 0 || j >= n) continue;
    const v = FEED.vids[j % 3];
    const card = FEED.cards[j];
    const rr = FEED.items[j];
    if (v.dataset.h !== rr.h) {
      v.pause();
      if (v.parentElement) v.parentElement.classList.remove('playing');
      registerStream(rr, { firstChunk: FEED_FIRST_CHUNK });
      v.dataset.h = rr.h;
      const poster = LB.previews.get(rr.h) || thumbGet(rr.h);
      if (poster) v.poster = poster; else v.removeAttribute('poster');
      v.src = streamUrl(rr);
    }
    if (v.parentElement !== card) {
      if (v.parentElement) v.parentElement.classList.remove('playing');
      card.insertBefore(v, card.firstChild);
    }
    if (k === 0) {
      v.preload = 'auto';
      v.muted = !FEED.sound;
      v.play().catch(() => {});
    } else {
      v.preload = 'metadata';
      v.muted = true;
      if (!v.paused) v.pause();
    }
  }
  // Warm the next two cards (head + tail blocks, download URL) and drop anything else.
  feedPrefetchPlan([i + 1, i + 2].filter((j) => j < n).map((j) => FEED.items[j]), true);
  updateFeedBar(feedCurVid());
}

// ---- prefetch via the service worker (fills its block cache; aborting cancels upstream)
function feedPrefetch(r, wantTail) {
  let e = FEED.prefetch.get(r.h);
  if (e && (!wantTail || e.tail)) return;
  if (!e) {
    while (FEED.prefetch.size >= FEED_MAX_PREFETCH) { // oldest first
      const [h, old] = FEED.prefetch.entries().next().value;
      old.ac.abort();
      FEED.prefetch.delete(h);
    }
    e = { ac: new AbortController(), tail: false, n: 0 };
    FEED.prefetch.set(r.h, e);
    registerStream(r, { firstChunk: FEED_FIRST_CHUNK, warmUrl: true });
    feedFetchRange(r, e, `bytes=0-${Math.min(r.s, FEED_BLOCK) - 1}`);
  }
  if (wantTail && !e.tail) {
    e.tail = true;
    const tailStart = Math.floor(Math.max(0, r.s - FEED_TAIL_BYTES) / FEED_BLOCK) * FEED_BLOCK; // block-aligned so it caches
    if (tailStart >= FEED_BLOCK) feedFetchRange(r, e, `bytes=${tailStart}-${r.s - 1}`);
  }
}
function feedFetchRange(r, e, range) {
  e.n++;
  fetch(streamUrl(r), { headers: { Range: range }, signal: e.ac.signal, cache: 'no-store' })
    .then((res) => res.arrayBuffer())
    .catch(() => {})
    .finally(() => { if (--e.n === 0 && FEED.prefetch.get(r.h) === e) FEED.prefetch.delete(r.h); });
}
function feedPrefetchPlan(list, withTail) {
  const keep = new Set(list.map((r) => r.h));
  for (const [h, e] of FEED.prefetch) if (!keep.has(h)) { e.ac.abort(); FEED.prefetch.delete(h); }
  for (const r of list) feedPrefetch(r, withTail);
}

// ---- scrolling: cheap head warm while flinging, full assignment once settled
FEED.scroller.addEventListener('scroll', () => {
  if (OV.current !== 'feed') return;
  const sc = FEED.scroller;
  const idx = Math.round(sc.scrollTop / Math.max(1, sc.clientHeight));
  const now = performance.now();
  if (now - (FEED.lastWarm || 0) > 200 && idx !== FEED.cur) { // while browsing: ~1 MB head only
    FEED.lastWarm = now;
    const r = FEED.items[idx];
    if (r) feedPrefetch(r, false);
  }
  clearTimeout(FEED.settleT);
  FEED.settleT = setTimeout(() => {
    const i = Math.round(sc.scrollTop / Math.max(1, sc.clientHeight));
    setFeedIndex(i);
    feedWantThumbs();
  }, 120);
}, { passive: true });

function feedStep(dir) {
  const sc = FEED.scroller;
  const j = Math.max(0, Math.min(FEED.items.length - 1, FEED.cur + dir));
  sc.scrollTo({ top: j * sc.clientHeight, behavior: 'smooth' });
}

/** Posters for cards around the focus (thumbnails come from IndexedDB or MEGA via the worker). */
function feedWantThumbs() {
  const want = [];
  const now = Date.now();
  for (let j = Math.max(0, FEED.cur - 2); j <= Math.min(FEED.items.length - 1, FEED.cur + 8); j++) {
    const r = FEED.items[j];
    if (!r.tf || TH.map.has(r.h) || TH.none.has(r.h)) continue;
    const e = TH.err.get(r.h);
    if (e && now - e < 60000) continue;
    want.push({ id: r.h, folder: r.L.id, c: r.tc, fah: r.tf, k: r.k });
  }
  if (want.length) W.post({ type: 'thumbs', want });
}

// ---- sound / seek
function feedToggleSound() {
  FEED.sound = !FEED.sound;
  const v = feedCurVid();
  if (v) { v.muted = !FEED.sound; if (v.paused) v.play().catch(() => {}); }
  if (FEED.sound) { FEED.unmuted = true; $('#feedHint').hidden = true; }
}
FEED.scroller.addEventListener('click', (e) => {
  if (e.target.closest('#feedBar')) return;
  feedToggleSound();
});
function updateFeedBar(v) {
  if (FEED.scrubbing) return;
  $('#feedFill').style.width = v && v.duration ? (100 * v.currentTime / v.duration).toFixed(2) + '%' : '0';
}
(() => {
  const bar = $('#feedBar');
  const seekTo = (e) => {
    const v = feedCurVid();
    if (!v || !v.duration) return;
    const rect = bar.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left - 12) / Math.max(1, rect.width - 24)));
    $('#feedFill').style.width = (100 * x).toFixed(2) + '%';
    clearTimeout(FEED.scrubT);
    FEED.scrubT = setTimeout(() => { v.currentTime = x * v.duration; }, 40); // coalesce scrubs: no stall storms
  };
  bar.addEventListener('pointerdown', (e) => { FEED.scrubbing = true; bar.setPointerCapture(e.pointerId); seekTo(e); });
  bar.addEventListener('pointermove', (e) => { if (FEED.scrubbing) seekTo(e); });
  const end = (e) => { if (!FEED.scrubbing) return; seekTo(e); FEED.scrubbing = false; };
  bar.addEventListener('pointerup', end);
  bar.addEventListener('pointercancel', () => { FEED.scrubbing = false; });
})();

/** Tear down on exit: no audio leakage, no stray fetches, grid scroll untouched. */
function stopFeed() {
  clearTimeout(FEED.settleT);
  for (const v of FEED.vids) {
    v.pause();
    v.muted = true;
    v.removeAttribute('src');
    v.removeAttribute('poster');
    delete v.dataset.h;
    v.load(); // aborts the stream -> the SW cancels upstream
    if (v.parentElement) v.parentElement.removeChild(v);
  }
  for (const [, e] of FEED.prefetch) e.ac.abort();
  FEED.prefetch.clear();
  FEED.scroller.innerHTML = '';
  FEED.cards = [];
  FEED.items = [];
  FEED.cur = -1;
  FEED.scrubbing = false;
  window.scrollTo(0, FEED.scrollY);
  lastY = window.scrollY;
}

// ================================================================ controls wiring
$('#btnRefresh').innerHTML = ICON.refresh;
$('#btnRefresh').onclick = () => {
  if (!S.links.length) return openLinks();
  if (S.links.some((L) => L.status === 'loading')) {
    for (const L of S.links) if (L.job) W.post({ type: 'cancel', job: L.job });
    toast('Refresh cancelled');
    return;
  }
  refreshAll();
  toast('Refreshing folder listings…', 2000);
};
$('.i-link').outerHTML = ICON.link;
$('.i-feed').outerHTML = ICON.feed;
$('#btnFeed').onclick = openFeed;
$('.i-search').outerHTML = ICON.search;
for (const b of document.querySelectorAll('[data-close]')) b.innerHTML = ICON.close;
$('#btnLinks').onclick = openLinks;

let qTimer = 0;
$('#q').addEventListener('input', (e) => {
  clearTimeout(qTimer);
  qTimer = setTimeout(() => { saveScroll(); S.view.q = e.target.value; onViewChanged(); }, 180);
});
$('#q').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });
$('#sort').onchange = (e) => { saveScroll(); S.view.sort = e.target.value; onViewChanged(); };
$('#mode').onchange = (e) => {
  const anchor = firstVisibleIndex();
  S.view.mode = e.target.value;
  onViewChanged({ restore: false });
  scrollToIndex(anchor);
};
$('#flat').onclick = (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  const flat = b.dataset.flat === '1';
  if (flat === S.view.flat) return;
  saveScroll();
  S.view.flat = flat;
  onViewChanged();
};
$('#chips').onclick = (e) => {
  const b = e.target.closest('button');
  if (!b || b.dataset.kind === S.view.kind) return;
  saveScroll();
  S.view.kind = b.dataset.kind;
  onViewChanged();
};
$('#listHead').onclick = (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  const col = b.dataset.col;
  const cur = S.view.sort;
  const next = col === 'name' ? (cur === 'name-asc' ? 'name-desc' : 'name-asc')
    : col === 'size' ? (cur === 'size-desc' ? 'size-asc' : 'size-desc')
      : (cur === 'date-desc' ? 'date-asc' : 'date-desc');
  saveScroll();
  S.view.sort = next;
  onViewChanged();
};

function firstVisibleIndex() {
  return Math.max(0, Math.floor((window.scrollY - G.top) / G.rowH) * G.cols);
}
function scrollToIndex(i) {
  const row = Math.floor(i / G.cols);
  window.scrollTo(0, row > 0 ? G.top + row * G.rowH - 4 : 0);
  render(false);
  requestThumbs();
}

let resizeTimer = 0;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    const anchor = firstVisibleIndex();
    const oldW = G.w;
    layout();
    if (Math.abs(G.w - oldW) > 1) { render(true); scrollToIndex(anchor); } else render(false);
  }, 120);
});
window.addEventListener('scroll', onScroll, { passive: true });
window.addEventListener('pagehide', saveScroll);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveScroll(); });

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && OV.current) { closeOverlay(); return; }
  if (OV.current === 'lb') {
    if (e.key === 'ArrowRight') lbStep(1);
    if (e.key === 'ArrowLeft') lbStep(-1);
    return;
  }
  if (OV.current === 'feed') {
    if (e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === 'j') { e.preventDefault(); feedStep(1); }
    if (e.key === 'ArrowUp' || e.key === 'PageUp' || e.key === 'k') { e.preventDefault(); feedStep(-1); }
    if (e.key === ' ') { e.preventDefault(); const v = feedCurVid(); if (v) (v.paused ? v.play().catch(() => {}) : v.pause()); }
    if (e.key === 'm') feedToggleSound();
    return;
  }
  if (!OV.current && e.key === '/' && document.activeElement !== $('#q')) { e.preventDefault(); $('#q').focus(); }
});

// ================================================================ boot
async function boot() {
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  loadLinks();
  const hf = parseHash();
  S.view.folder = hf || (location.hash ? null : lsGet(LS.folder, null));
  history.replaceState({ f: S.view.folder }, '', hashFor(S.view.folder));
  renderHeader();
  setupServiceWorker().then(applyVideoCacheCfg);
  await W.start();

  if (!S.links.length) { S.ready = true; onViewChanged(); openLinks(); return; }

  // 1) Paint immediately from the IndexedDB copy of every listing.
  let rows = [];
  try { rows = (await W.call('cached', { cids: S.links.map((L) => L.cid) })).rows; } catch { /* no IDB */ }
  const now = Date.now();
  S.links.forEach((L, i) => {
    const row = rows[i];
    if (row) { L.status = row.needsKey ? 'needs-key' : 'ok'; indexLink(L, row); }
  });
  S.dataVer++;
  if (S.view.folder) {
    const L = linkByCid(S.view.folder.cid);
    if (!L || !L.nodes || !L.nodes.has(S.view.folder.h)) S.view.folder = null;
  }
  S.ready = true;
  onViewChanged({ restore: true });

  // 2) Re-list only what is missing or stale (one API call per link).
  S.links.forEach((L) => {
    if (!L.nodes || now - L.at > STALE_MS) listLink(L);
  });
  updateProgress();
}

window.__megaGallery = { S, TH, G, W, BUILD }; // debugging handle (read-only use)
boot();
