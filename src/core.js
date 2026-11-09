// core.js — shared MEGA client code.
// Runs unchanged in: the page, the walker/thumbnail Web Worker, the streaming
// Service Worker, and Node (for tests). The build strips `export` and inlines it.
//
// Logic follows megajs v1.3 (API request + hashcash, key/attribute handling) and
// MEGA's own webclient (file-attribute/thumbnail protocol, media attributes).

// ---------------------------------------------------------------- base64url
const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const B64_LUT = new Int16Array(128).fill(-1);
for (let i = 0; i < 64; i++) B64_LUT[B64_CHARS.charCodeAt(i)] = i;
B64_LUT[43] = 62; // '+'
B64_LUT[47] = 63; // '/'

export function b64dec(s) {
  const out = new Uint8Array(((s.length * 3) >> 2) + 3);
  let n = 0, buf = 0, bits = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    const v = c < 128 ? B64_LUT[c] : -1;
    if (v < 0) continue;
    buf = ((buf << 6) | v) & 0xffffff;
    bits += 6;
    if (bits >= 8) { bits -= 8; out[n++] = (buf >> bits) & 255; }
  }
  return out.slice(0, n);
}

export function b64enc(u8) {
  const C = B64_CHARS;
  let s = '', i = 0;
  for (; i + 2 < u8.length; i += 3) {
    const v = (u8[i] << 16) | (u8[i + 1] << 8) | u8[i + 2];
    s += C[(v >> 18) & 63] + C[(v >> 12) & 63] + C[(v >> 6) & 63] + C[v & 63];
  }
  if (u8.length - i === 1) {
    const v = u8[i] << 16;
    s += C[(v >> 18) & 63] + C[(v >> 12) & 63];
  } else if (u8.length - i === 2) {
    const v = (u8[i] << 16) | (u8[i + 1] << 8);
    s += C[(v >> 18) & 63] + C[(v >> 12) & 63] + C[(v >> 6) & 63];
  }
  return s;
}

const UTF8 = new TextDecoder();

// ---------------------------------------------------------------- AES-128 (pure JS)
// Table-based AES after SJCL. Synchronous and allocation-free per block, which
// beats WebCrypto for the thousands of tiny ECB/CBC operations a folder needs.
const AES_T = (() => {
  const enc = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256), new Uint32Array(256), new Uint8Array(256)];
  const dec = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256), new Uint32Array(256), new Uint8Array(256)];
  const sbox = enc[4], sboxInv = dec[4];
  const d = new Uint8Array(256), th = new Uint8Array(256);
  for (let i = 0; i < 256; i++) th[(d[i] = (i << 1) ^ ((i >> 7) * 283)) ^ i] = i;
  let x, xInv, x2, x4, x8, s, tEnc, tDec;
  for (x = xInv = 0; !sbox[x]; x ^= x2 || 1, xInv = th[xInv] || 1) {
    s = xInv ^ (xInv << 1) ^ (xInv << 2) ^ (xInv << 3) ^ (xInv << 4);
    s = (s >> 8) ^ (s & 255) ^ 99;
    sbox[x] = s;
    sboxInv[s] = x;
    x8 = d[(x4 = d[(x2 = d[x])])];
    tDec = (x8 * 0x1010101) ^ (x4 * 0x10001) ^ (x2 * 0x101) ^ (x * 0x1010100);
    tEnc = (d[s] * 0x101) ^ (s * 0x1010100);
    for (let i = 0; i < 4; i++) {
      enc[i][x] = tEnc = (tEnc << 24) ^ (tEnc >>> 8);
      dec[i][s] = tDec = (tDec << 24) ^ (tDec >>> 8);
    }
  }
  return [enc, dec];
})();

export class AES {
  constructor(key) {
    if (!key || key.length !== 16) throw new Error('AES key must be 16 bytes');
    const sbox = AES_T[0][4], decT = AES_T[1];
    const ek = new Int32Array(44), dk = new Int32Array(44);
    for (let i = 0; i < 4; i++) ek[i] = (key[4 * i] << 24) | (key[4 * i + 1] << 16) | (key[4 * i + 2] << 8) | key[4 * i + 3];
    let i, j, tmp, rcon = 1;
    for (i = 4; i < 44; i++) {
      tmp = ek[i - 1];
      if (i % 4 === 0) {
        tmp = (sbox[tmp >>> 24] << 24) ^ (sbox[(tmp >> 16) & 255] << 16) ^ (sbox[(tmp >> 8) & 255] << 8) ^ sbox[tmp & 255];
        tmp = (tmp << 8) ^ (tmp >>> 24) ^ (rcon << 24);
        rcon = (rcon << 1) ^ ((rcon >> 7) * 283);
      }
      ek[i] = ek[i - 4] ^ tmp;
    }
    for (j = 0; i; j++, i--) {
      tmp = ek[j & 3 ? i : i - 4];
      dk[j] = i <= 4 || j < 4 ? tmp
        : decT[0][sbox[tmp >>> 24]] ^ decT[1][sbox[(tmp >> 16) & 255]] ^ decT[2][sbox[(tmp >> 8) & 255]] ^ decT[3][sbox[tmp & 255]];
    }
    this.k = [ek, dk];
    this.w = new Int32Array(4);
    this.o = new Int32Array(4);
  }

  _crypt(dir) {
    const inp = this.w, out = this.o, key = this.k[dir], T = AES_T[dir];
    const t0 = T[0], t1 = T[1], t2 = T[2], t3 = T[3], sbox = T[4];
    let a = inp[0] ^ key[0], b = inp[dir ? 3 : 1] ^ key[1], c = inp[2] ^ key[2], d = inp[dir ? 1 : 3] ^ key[3];
    let a2, b2, c2, k = 4;
    for (let r = 0; r < 9; r++) {
      a2 = t0[a >>> 24] ^ t1[(b >> 16) & 255] ^ t2[(c >> 8) & 255] ^ t3[d & 255] ^ key[k];
      b2 = t0[b >>> 24] ^ t1[(c >> 16) & 255] ^ t2[(d >> 8) & 255] ^ t3[a & 255] ^ key[k + 1];
      c2 = t0[c >>> 24] ^ t1[(d >> 16) & 255] ^ t2[(a >> 8) & 255] ^ t3[b & 255] ^ key[k + 2];
      d = t0[d >>> 24] ^ t1[(a >> 16) & 255] ^ t2[(b >> 8) & 255] ^ t3[c & 255] ^ key[k + 3];
      k += 4; a = a2; b = b2; c = c2;
    }
    for (let r = 0; r < 4; r++) {
      out[dir ? 3 & -r : r] = (sbox[a >>> 24] << 24) ^ (sbox[(b >> 16) & 255] << 16) ^ (sbox[(c >> 8) & 255] << 8) ^ sbox[d & 255] ^ key[k++];
      a2 = a; a = b; b = c; c = d; d = a2;
    }
  }

  _load(u8, off) {
    const w = this.w;
    for (let i = 0; i < 4; i++, off += 4) w[i] = (u8[off] << 24) | (u8[off + 1] << 16) | (u8[off + 2] << 8) | u8[off + 3];
  }

  _store(u8, off) {
    const o = this.o;
    for (let i = 0; i < 4; i++, off += 4) {
      const v = o[i];
      u8[off] = v >>> 24; u8[off + 1] = (v >> 16) & 255; u8[off + 2] = (v >> 8) & 255; u8[off + 3] = v & 255;
    }
  }

  /** In-place ECB decrypt (MEGA uses this to unwrap node keys). */
  decryptECB(u8) {
    for (let off = 0; off + 16 <= u8.length; off += 16) { this._load(u8, off); this._crypt(1); this._store(u8, off); }
    return u8;
  }

  encryptECB(u8) {
    for (let off = 0; off + 16 <= u8.length; off += 16) { this._load(u8, off); this._crypt(0); this._store(u8, off); }
    return u8;
  }

  /** In-place CBC decrypt, zero IV, no padding (node attributes and thumbnails). */
  decryptCBC(u8) {
    let p0 = 0, p1 = 0, p2 = 0, p3 = 0;
    const w = this.w, o = this.o;
    for (let off = 0; off + 16 <= u8.length; off += 16) {
      this._load(u8, off);
      const c0 = w[0], c1 = w[1], c2 = w[2], c3 = w[3];
      this._crypt(1);
      o[0] ^= p0; o[1] ^= p1; o[2] ^= p2; o[3] ^= p3;
      this._store(u8, off);
      p0 = c0; p1 = c1; p2 = c2; p3 = c3;
    }
    return u8;
  }
}

// ---------------------------------------------------------------- keys & attributes
/** 32-byte file key -> 16-byte AES key (k[0..15] XOR k[16..31]); folder keys pass through. */
export function nodeAesKey(k) {
  if (k.length !== 32) return k;
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i++) out[i] = k[i] ^ k[i + 16];
  return out;
}

/** Decrypt a node's `a` attribute blob. Returns {n, c, ...} or null when the key is wrong. */
export function decryptAttrs(aB64, key16) {
  if (!aB64) return null;
  const buf = b64dec(aB64);
  if (!buf.length || buf.length % 16) return null;
  new AES(key16).decryptCBC(buf);
  let end = buf.length;
  while (end > 0 && buf[end - 1] === 0) end--;
  // 'MEGA{"'
  if (buf[0] !== 77 || buf[1] !== 69 || buf[2] !== 71 || buf[3] !== 65 || buf[4] !== 123 || buf[5] !== 34) return null;
  const json = UTF8.decode(buf.subarray(4, end));
  try {
    return JSON.parse(json);
  } catch {
    const m = json.match(/"n"\s*:\s*"((?:\\"|[^"])*)"/);
    return m ? { n: m[1] } : { n: 'MALFORMED_ATTRIBUTES' };
  }
}

/** Original file mtime (unix seconds) encoded in the fingerprint attribute `c`. */
export function fingerprintMtime(c) {
  if (typeof c !== 'string' || c.length < 24) return 0;
  const b = b64dec(c);
  if (b.length < 18) return 0;
  const len = b[16];
  if (!len || len > 8 || b.length < 17 + len) return 0;
  let t = 0;
  for (let i = len - 1; i >= 0; i--) t = t * 256 + b[17 + i];
  // Reject nonsense (before 1980 or more than a year in the future).
  return t > 315532800 && t < Date.now() / 1000 + 31536000 ? t : 0;
}

/** Parse a node's `fa` string ("924:0*AbCd…/924:1*EfGh…/…:8*…"). */
export function parseFa(fa) {
  const r = {};
  if (!fa) return r;
  const re = /(\d+):(\d+)\*([\w-]+)/g;
  let m;
  while ((m = re.exec(fa))) {
    const type = +m[2];
    if (type === 0) r.thumb = { c: m[1], h: m[3] };
    else if (type === 1) r.preview = { c: m[1], h: m[3] };
  }
  return r;
}

// XXTEA (media attributes, type 8/9 inside `fa`) — ported from MEGA webclient nodedec.js
function xxteaDecrypt(v, k) {
  const DELTA = 0x9e3779b9;
  const int32 = (i) => i & 0xffffffff;
  const mx = (sum, y, z, p, e) => (((z >>> 5) ^ (y << 2)) + ((y >>> 3) ^ (z << 4))) ^ ((sum ^ y) + (k[(p & 3) ^ e] ^ z));
  const n = v.length - 1;
  let y = v[0], z, sum, e, p;
  const q = Math.floor(6 + 52 / v.length);
  for (sum = int32(q * DELTA); sum !== 0; sum = int32(sum - DELTA)) {
    e = (sum >>> 2) & 3;
    for (p = n; p > 0; --p) {
      z = v[p - 1];
      y = v[p] = int32(v[p] - mx(sum, y, z, p, e));
    }
    z = v[n];
    y = v[0] = int32(v[0] - mx(sum, y, z, 0, e));
  }
  return v;
}

/** Decode width/height/fps/duration from the inline `:8*` media attribute. Zero network. */
export function decodeMediaAttrs(fa, key32) {
  if (!fa || !key32 || key32.length !== 32) return null;
  const pos = fa.indexOf(':8*');
  if (pos < 0) return null;
  const raw = b64dec(fa.substr(pos + 3, 11));
  if (raw.length < 8) return null;
  const v = new Uint32Array(2);
  v[0] = raw[0] | (raw[1] << 8) | (raw[2] << 16) | (raw[3] << 24);
  v[1] = raw[4] | (raw[5] << 8) | (raw[6] << 16) | (raw[7] << 24);
  const k = new Uint32Array(4);
  for (let i = 0; i < 4; i++) {
    const o = 16 + i * 4;
    k[i] = (key32[o] << 24) | (key32[o + 1] << 16) | (key32[o + 2] << 8) | key32[o + 3];
  }
  xxteaDecrypt(v, k);
  const b = new Uint8Array(8);
  for (let i = 0; i < 2; i++) {
    b[i * 4] = v[i] & 255; b[i * 4 + 1] = (v[i] >>> 8) & 255; b[i * 4 + 2] = (v[i] >>> 16) & 255; b[i * 4 + 3] = v[i] >>> 24;
  }
  let width = (b[0] >> 1) + ((b[1] & 127) << 7);
  if (b[0] & 1) width = (width << 3) + 16384;
  let height = b[2] + ((b[3] & 63) << 8);
  if (b[1] & 128) height = (height << 3) + 16384;
  let fps = (b[3] >> 7) + ((b[4] & 63) << 1);
  if (b[3] & 64) fps = (fps << 3) + 128;
  let playtime = (b[4] >> 7) + (b[5] << 1) + (b[6] << 9);
  if (b[4] & 64) playtime = playtime * 60 + 131100;
  return { width, height, fps, playtime };
}

// ---------------------------------------------------------------- links
export class LinkError extends Error {}

/**
 * Normalise a pasted MEGA folder link. Accepts:
 *   https://mega.nz/folder/ID#KEY            (+ /folder/SUB or /file/FILE suffix)
 *   https://mega.nz/#F!ID!KEY                (+ !SUB)
 *   mega.co.nz / www. variants, missing scheme, surrounding text/quotes/<>,
 *   links with no key (key can be supplied later).
 */
export function parseMegaLink(input) {
  let s = String(input || '').trim();
  if (!s) throw new LinkError('Paste a MEGA folder link.');
  // Pull the first mega URL out of surrounding text.
  const m = s.match(/(?:https?:\/\/)?(?:www\.)?mega(?:\.co)?\.nz\/[^\s"'<>]+/i) || s.match(/#?F![\w-]+(?:![\w-]*)*/);
  if (m) s = m[0];
  s = s.replace(/\s+/g, '').replace(/[)\].,;]+$/, '');
  try { s = decodeURIComponent(s); } catch { /* keep as-is */ }

  let id, key = null, sub = null;
  let mm;
  if ((mm = s.match(/\/(file|folder|embed)\/([\w-]+)(?:#([\w-]*))?(.*)$/i))) {
    if (mm[1].toLowerCase() !== 'folder') throw new LinkError('That is a single-file link. Paste a folder link (mega.nz/folder/…).');
    id = mm[2];
    key = mm[3] || null;
    const rest = mm[4] || '';
    const subm = rest.match(/\/folder\/([\w-]+)/i);
    if (subm) sub = subm[1];
  } else if ((mm = s.match(/#?(F?)!([\w-]+)(?:!([\w-]*))?(?:!([\w-]+))?/))) {
    if (!mm[1]) throw new LinkError('That is a single-file link. Paste a folder link (#F!…).');
    id = mm[2];
    key = mm[3] || null;
    sub = mm[4] || null;
  } else {
    throw new LinkError('Not a MEGA folder link. Expected mega.nz/folder/ID#KEY or mega.nz/#F!ID!KEY.');
  }
  if (!/^[\w-]{8}$/.test(id)) throw new LinkError(`Folder ID "${id}" should be 8 characters.`);
  if (key !== null && !/^[\w-]{22}$/.test(key)) throw new LinkError(`Decryption key should be 22 characters (got ${key.length}).`);
  if (sub !== null && !/^[\w-]{8}$/.test(sub)) sub = null;
  return { id, key, sub, url: canonicalLink(id, key, sub) };
}

export function canonicalLink(id, key, sub) {
  return `https://mega.nz/folder/${id}${key ? '#' + key : ''}${sub ? '/folder/' + sub : ''}`;
}

// ---------------------------------------------------------------- API
const API_ERRORS = {
  '-1': 'MEGA internal error', '-2': 'Invalid request', '-3': 'MEGA is busy, try again',
  '-4': 'Rate limited by MEGA, slow down', '-6': 'Too many requests', '-8': 'Link expired',
  '-9': 'Not found: the folder was deleted or the link is wrong', '-11': 'Access denied',
  '-14': 'Wrong decryption key', '-15': 'Session expired', '-16': 'This link was taken down or blocked',
  '-17': 'Transfer quota exceeded', '-18': 'Temporarily unavailable', '-19': 'Too many connections',
};

export class MegaError extends Error {
  constructor(code, extra) {
    super((API_ERRORS[code] || `MEGA error ${code}`) + (extra ? ` (${extra})` : ''));
    this.code = code;
  }
}

export function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) return reject(new DOMException('Aborted', 'AbortError'));
    const t = setTimeout(resolve, ms);
    if (signal) signal.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
  });
}

// Port of megajs generateHashcashToken (MEGA's anti-abuse proof-of-work).
async function solveHashcash(challenge) {
  const [versionStr, easinessStr, , tokenStr] = challenge.split(':');
  if (Number(versionStr) !== 1) throw new Error('Unsupported MEGA hashcash challenge');
  const easiness = Number(easinessStr);
  const base = ((easiness & 63) << 1) + 1;
  const shifts = (easiness >> 6) * 7 + 3;
  const threshold = base << shifts;
  const token = b64dec(tokenStr);
  const buffer = new Uint8Array(4 + 262144 * 48);
  for (let i = 0; i < 262144; i++) buffer.set(token, 4 + i * 48);
  for (;;) {
    const view = new DataView(await crypto.subtle.digest('SHA-256', buffer));
    if (view.getUint32(0) <= threshold) return `1:${tokenStr}:${b64enc(buffer.slice(0, 4))}`;
    let j = 0;
    for (;;) { buffer[j]++; if (buffer[j++]) break; }
  }
}

/** Minimal MEGA API client: request sequencing, polite concurrency, EAGAIN backoff, hashcash. */
export class MegaApi {
  constructor(opts = {}) {
    this.gateway = opts.gateway || 'https://g.api.mega.co.nz/';
    this.seq = Math.floor(Math.random() * 1e9);
    this.max = opts.maxConcurrent || 3;
    this.active = 0;
    this.waiters = [];
  }

  async req(payload, opts = {}) {
    if (this.active >= this.max) await new Promise((r) => this.waiters.push(r));
    this.active++;
    try { return await this._req(payload, opts); } finally {
      this.active--;
      const next = this.waiters.shift();
      if (next) next();
    }
  }

  async _req(payload, { n, signal } = {}) {
    let hashcash = null, busy = 0, netRetry = false, hcTries = 0;
    for (;;) {
      const qs = `id=${++this.seq}${n ? '&n=' + encodeURIComponent(n) : ''}`;
      const headers = { 'Content-Type': 'application/json' };
      if (hashcash) headers['X-Hashcash'] = hashcash;
      let res;
      try {
        res = await fetch(`${this.gateway}cs?${qs}`, { method: 'POST', headers, body: JSON.stringify([payload]), signal });
      } catch (e) {
        if (e.name === 'AbortError' || (signal && signal.aborted)) throw e;
        if (netRetry) throw new Error(`Network error talking to MEGA (${e.message})`);
        netRetry = true; // retry-once for plain network failures
        await sleep(1200, signal);
        continue;
      }
      const challenge = res.headers.get('X-Hashcash');
      if (challenge && hcTries++ < 3) { hashcash = await solveHashcash(challenge); continue; }
      if (res.status >= 500 || res.status === 429) {
        if (busy++ < 4) { await sleep(600 * 2 ** busy + Math.random() * 400, signal); continue; }
        throw new Error(`MEGA API unavailable (HTTP ${res.status})`);
      }
      if (!res.ok) throw new Error(`MEGA API HTTP ${res.status}`);
      const json = await res.json();
      const r = Array.isArray(json) ? json[0] : json;
      if (typeof r === 'number' && r < 0) {
        if ((r === -3 || r === -4 || r === -6) && busy++ < 5) { await sleep(500 * 2 ** busy + Math.random() * 500, signal); continue; }
        throw new MegaError(r);
      }
      return r;
    }
  }
}

// ---------------------------------------------------------------- folder listing
/**
 * One `f` call with r:1 returns the whole tree under a public folder link.
 * Decrypts keys/attributes in slices, yielding between slices.
 * Returns compact records: {h,p,t,s,ts,mt,n,k,fa,d,w,hh}
 */
export async function listFolder(api, link, { signal, onProgress } = {}) {
  onProgress && onProgress({ phase: 'fetch' });
  const resp = await api.req({ a: 'f', c: 1, ca: 1, r: 1 }, { n: link.id, signal });
  const f = (resp && resp.f) || [];
  if (!f.length) throw new MegaError(-9);
  return decryptListing(f, link, { signal, onProgress });
}

export async function decryptListing(f, link, { signal, onProgress } = {}) {
  const shareAes = link.key ? new AES(b64dec(link.key)) : null;
  const root = f.find((n) => typeof n.k === 'string' && n.k.split('/').some((p) => p.split(':')[0] === n.h)) || f.find((n) => n.t === 1) || f[0];
  const out = [];
  let badKey = 0, okKey = 0;
  const SLICE = 1500;
  for (let i = 0; i < f.length; i++) {
    const n = f[i];
    const rec = { h: n.h, p: n.h === root.h ? '' : n.p, t: n.t === 1 ? 1 : 0, s: n.s || 0, ts: n.ts || 0, mt: n.ts || 0, n: null };
    if (shareAes && typeof n.k === 'string') {
      const parts = n.k.split('/');
      // Prefer the entry keyed by the share root.
      parts.sort((a, b) => (b.startsWith(root.h + ':') ? 1 : 0) - (a.startsWith(root.h + ':') ? 1 : 0));
      for (const part of parts) {
        const kb = part.slice(part.indexOf(':') + 1);
        if (!kb || kb.length >= 44) continue; // RSA-wrapped keys are for logged-in owners only
        const k = b64dec(kb);
        if (k.length !== 16 && k.length !== 32) continue;
        shareAes.decryptECB(k);
        const at = decryptAttrs(n.a, nodeAesKey(k));
        if (at) {
          rec.n = typeof at.n === 'string' ? at.n : '';
          const mt = fingerprintMtime(at.c);
          if (mt) rec.mt = mt;
          if (k.length === 32) rec.k = b64enc(k);
          if (n.fa && k.length === 32) {
            const ma = decodeMediaAttrs(n.fa, k);
            if (ma && ma.playtime) rec.d = ma.playtime;
            if (ma && ma.width) { rec.w = ma.width; rec.hh = ma.height; }
          }
          break;
        }
      }
      if (rec.n === null) badKey++; else okKey++;
    }
    if (n.fa) rec.fa = n.fa;
    out.push(rec);
    if (i % SLICE === SLICE - 1) {
      onProgress && onProgress({ phase: 'decrypt', done: i + 1, total: f.length });
      await sleep(0, signal);
    }
  }
  if (shareAes && okKey === 0 && badKey > 0) throw new MegaError(-14);
  let rootH = root.h;
  let nodes = out;
  if (link.sub && link.sub !== root.h) {
    // Restrict to the subtree of a /folder/SUB link.
    const kids = new Map();
    for (const r of out) { if (!kids.has(r.p)) kids.set(r.p, []); kids.get(r.p).push(r); }
    const subRec = out.find((r) => r.h === link.sub);
    if (!subRec) throw new LinkError('Subfolder from the link was not found inside the folder.');
    nodes = [];
    const stack = [subRec];
    while (stack.length) {
      const r = stack.pop();
      nodes.push(r);
      const ch = kids.get(r.h);
      if (ch) for (const c of ch) stack.push(c);
    }
    subRec.p = '';
    rootH = subRec.h;
  }
  onProgress && onProgress({ phase: 'done', done: f.length, total: f.length });
  return { root: rootH, nodes, needsKey: !shareAes };
}

// ---------------------------------------------------------------- file attributes (thumbnails / previews)
/**
 * Fetch and decrypt server-generated thumbnails (type 0) or previews (type 1).
 * items: [{id, fah (b64 8-byte handle), key (b64 32-byte node key)}], all on the same fa cluster.
 * Many handles go in ONE POST; the reply is [8B handle][4B LE len][ciphertext]...
 * Returns Map(id -> Uint8Array JPEG).
 */
export async function fetchFileAttributes(api, folderId, type, items, { signal } = {}) {
  if (!items.length) return new Map();
  const servers = await faServers(api, folderId, items[0].fah, { signal });
  return postFileAttributes(servers, type, items, { signal });
}

/**
 * Ask the API which storage server holds a cluster's file attributes.
 * The URL is reusable for the same cluster (measured: still valid well after
 * first use), so callers cache it per folder+cluster and skip this round trip.
 */
export async function faServers(api, folderId, fah, { signal } = {}) {
  const res = await api.req({ a: 'ufa', fah, ssl: 2, r: 1 }, { n: folderId, signal });
  if (!res || typeof res.p !== 'string') throw new Error('MEGA returned no file-attribute server');
  const servers = [res.p];
  for (let i = 0; typeof res['p' + i] === 'string'; i++) servers.push(res['p' + i]);
  return servers;
}

/**
 * POST many 8-byte handles (same cluster!) to the attribute server(s) and decrypt the reply.
 * Server latency is ~1–1.5 s regardless of batch size, so batch generously.
 */
export async function postFileAttributes(servers, type, items, { signal } = {}) {
  const out = new Map();
  const byHandle = new Map();
  for (const it of items) {
    const hb = b64dec(it.fah);
    if (hb.length !== 8) continue;
    const key = String.fromCharCode.apply(null, hb);
    if (!byHandle.has(key)) byHandle.set(key, { hb, items: [] });
    byHandle.get(key).items.push(it);
  }
  const groups = [...byHandle.values()];
  if (!groups.length) return out;
  // Split handles across the servers the API handed out (as the webclient does).
  const per = Math.ceil(groups.length / servers.length);
  await Promise.all(servers.map(async (srv, si) => {
    const slice = groups.slice(si * per, (si + 1) * per);
    if (!slice.length) return;
    const body = new Uint8Array(slice.length * 8);
    slice.forEach((g, i) => body.set(g.hb, i * 8));
    const url = srv.replace(/^http:/, 'https:') + '/' + type;
    const resp = await fetch(url, { method: 'POST', body, signal });
    if (!resp.ok) throw new Error(`Thumbnail server HTTP ${resp.status}`);
    const buf = new Uint8Array(await resp.arrayBuffer());
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    let i = 0;
    while (i + 12 <= buf.length) {
      const hkey = String.fromCharCode.apply(null, buf.subarray(i, i + 8));
      const len = dv.getUint32(i + 8, true);
      i += 12;
      if (i + len > buf.length) break;
      const g = byHandle.get(hkey);
      if (g && len && len % 16 === 0) {
        for (const it of g.items) {
          const data = buf.slice(i, i + len);
          new AES(nodeAesKey(b64dec(it.key))).decryptCBC(data);
          // Trim zero padding after the JPEG EOI marker when present.
          let end = data.length;
          while (end > 2 && data[end - 1] === 0) end--;
          out.set(it.id, data.subarray(0, end));
        }
      }
      i += len;
    }
  }));
  return out;
}

// ---------------------------------------------------------------- file content (AES-CTR, ranged)
/** Key material for ranged decryption: {aes: 16B key, nonce: 8B}. */
export function fileCtrParams(key32b64) {
  const k = b64dec(key32b64);
  return { aes: nodeAesKey(k), nonce: k.slice(16, 24) };
}

/** Counter block for byte offset `pos` (must be a multiple of 16). */
export function ctrBlock(nonce, pos) {
  const iv = new Uint8Array(16);
  iv.set(nonce, 0);
  let block = Math.floor(pos / 16);
  for (let i = 15; i >= 8; i--) { iv[i] = block % 256; block = Math.floor(block / 256); }
  return iv;
}

/**
 * Decrypt `data` that starts at file offset `pos` (multiple of 16).
 * Uses native WebCrypto AES-CTR when available, pure JS otherwise (e.g. insecure file:// contexts).
 * `ctx` caches the imported CryptoKey: {aes, nonce, ck?, js?}
 */
export async function ctrDecrypt(ctx, pos, data) {
  const subtle = globalThis.crypto && globalThis.crypto.subtle;
  if (subtle && !ctx.noSubtle) {
    try {
      if (!ctx.ck) ctx.ck = await subtle.importKey('raw', ctx.aes, 'AES-CTR', false, ['decrypt']);
      return new Uint8Array(await subtle.decrypt({ name: 'AES-CTR', counter: ctrBlock(ctx.nonce, pos), length: 64 }, ctx.ck, data));
    } catch (e) {
      ctx.noSubtle = true;
    }
  }
  const js = ctx.js || (ctx.js = new AES(ctx.aes));
  const out = new Uint8Array(data.length);
  const ks = new Uint8Array(16);
  for (let off = 0; off < data.length; off += 16) {
    ks.set(ctrBlock(ctx.nonce, pos + off));
    js.encryptECB(ks);
    const n = Math.min(16, data.length - off);
    for (let i = 0; i < n; i++) out[off + i] = data[off + i] ^ ks[i];
  }
  return out;
}

/** Ask MEGA for a temporary download URL for a node inside a public folder. */
export async function getDownloadUrl(api, folderId, handle, { signal } = {}) {
  const r = await api.req({ a: 'g', g: 1, ssl: 2, n: handle }, { n: folderId, signal });
  if (!r || typeof r.g !== 'string' || !/^https?:/.test(r.g)) {
    if (r && typeof r.e === 'number' && r.e < 0) throw new MegaError(r.e);
    throw new Error('MEGA did not return a download URL (possibly rate limited).');
  }
  return { url: r.g.replace(/^http:/, 'https:'), size: r.s };
}

// ---------------------------------------------------------------- file typing
const PHOTO_EXT = new Set(['jpg', 'jpeg', 'jpe', 'jfif', 'png', 'gif', 'webp', 'heic', 'heif', 'avif', 'bmp', 'tif', 'tiff', 'svg', 'dng', 'cr2', 'cr3', 'nef', 'arw', 'orf', 'rw2', 'raf']);
const VIDEO_EXT = new Set(['mp4', 'm4v', 'mov', 'webm', 'mkv', 'avi', 'wmv', 'flv', '3gp', '3g2', 'mpg', 'mpeg', 'ts', 'mts', 'm2ts', 'ogv', 'vob', 'f4v']);

export function extOf(name) {
  const i = name ? name.lastIndexOf('.') : -1;
  return i > 0 ? name.slice(i + 1).toLowerCase() : '';
}

/** 'folder' | 'photo' | 'video' | 'other' */
export function kindOf(rec) {
  if (rec.t === 1) return 'folder';
  const e = extOf(rec.n);
  if (PHOTO_EXT.has(e)) return 'photo';
  if (VIDEO_EXT.has(e)) return 'video';
  if (rec.d && rec.w) return 'video'; // media attrs with a picture size, unknown extension
  return 'other';
}

export function mimeOf(name) {
  const e = extOf(name);
  return ({
    mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/mp4', '3gp': 'video/3gpp', webm: 'video/webm', mkv: 'video/webm',
    ogv: 'video/ogg', ts: 'video/mp2t', avi: 'video/x-msvideo',
    jpg: 'image/jpeg', jpeg: 'image/jpeg', jpe: 'image/jpeg', jfif: 'image/jpeg', png: 'image/png', gif: 'image/gif',
    webp: 'image/webp', heic: 'image/heic', heif: 'image/heif', avif: 'image/avif', bmp: 'image/bmp', svg: 'image/svg+xml',
    tif: 'image/tiff', tiff: 'image/tiff',
  })[e] || 'application/octet-stream';
}
