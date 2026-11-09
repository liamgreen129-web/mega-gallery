// Unit checks for core.js against Node's native crypto + link parsing cases.
// Run: node test/core.test.mjs
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { AES, b64dec, b64enc, parseMegaLink, ctrBlock, fingerprintMtime } from '../src/core.js';

// --- base64url round trip
for (let len = 0; len < 70; len++) {
  const u = crypto.randomBytes(len);
  assert.deepEqual(Buffer.from(b64dec(b64enc(u))), u);
  assert.equal(b64enc(u), u.toString('base64url'));
}

// --- AES ECB/CBC vs OpenSSL
for (let t = 0; t < 200; t++) {
  const key = crypto.randomBytes(16);
  const data = crypto.randomBytes(16 * (1 + (t % 7)));
  const aes = new AES(key);
  const ecbRef = crypto.createCipheriv('aes-128-ecb', key, null).setAutoPadding(false).update(data);
  const mine = aes.encryptECB(new Uint8Array(data));
  assert.deepEqual(Buffer.from(mine), ecbRef, 'ECB encrypt');
  assert.deepEqual(Buffer.from(aes.decryptECB(new Uint8Array(ecbRef))), data, 'ECB decrypt');
  const cbcCt = crypto.createCipheriv('aes-128-cbc', key, Buffer.alloc(16)).setAutoPadding(false).update(data);
  assert.deepEqual(Buffer.from(aes.decryptCBC(new Uint8Array(cbcCt))), data, 'CBC decrypt');
}

// --- CTR counter block vs OpenSSL at an offset
{
  const key = crypto.randomBytes(16), nonce = crypto.randomBytes(8);
  const plain = crypto.randomBytes(5000);
  const iv0 = Buffer.concat([nonce, Buffer.alloc(8)]);
  const ct = crypto.createCipheriv('aes-128-ctr', key, iv0).update(plain);
  const off = 16 * 137;
  const iv = Buffer.from(ctrBlock(nonce, off));
  const dec = crypto.createDecipheriv('aes-128-ctr', key, iv).update(ct.subarray(off));
  assert.deepEqual(dec, plain.subarray(off));
  // large offsets (> 4 GB) keep 64-bit counter exact
  const big = ctrBlock(new Uint8Array(8), 16 * 2 ** 33 + 16 * 5);
  assert.equal(Buffer.from(big.subarray(8)).readBigUInt64BE(), 2n ** 33n + 5n);
}

// --- fingerprint mtime: 16 CRC bytes + len + LE mtime
{
  const mt = 1700000000;
  const b = Buffer.alloc(16 + 1 + 4);
  b[16] = 4; b.writeUInt32LE(mt, 17);
  assert.equal(fingerprintMtime(b.toString('base64url')), mt);
}

// --- link parsing
const L = (s) => parseMegaLink(s);
assert.deepEqual(L('https://mega.nz/folder/Ndwi1bAK#oLWNhH_g-h0p4BoT4c556A'), { id: 'Ndwi1bAK', key: 'oLWNhH_g-h0p4BoT4c556A', sub: null, url: 'https://mega.nz/folder/Ndwi1bAK#oLWNhH_g-h0p4BoT4c556A' });
assert.equal(L('https://mega.nz/#F!Ndwi1bAK!oLWNhH_g-h0p4BoT4c556A').key, 'oLWNhH_g-h0p4BoT4c556A');
assert.equal(L('https://mega.nz/#F!Ndwi1bAK!oLWNhH_g-h0p4BoT4c556A!AbCdEfGh').sub, 'AbCdEfGh');
assert.equal(L('mega.nz/folder/Ndwi1bAK#oLWNhH_g-h0p4BoT4c556A/folder/AbCdEfGh').sub, 'AbCdEfGh');
assert.equal(L('https://mega.co.nz/folder/Ndwi1bAK#oLWNhH_g-h0p4BoT4c556A/file/QwErTyUi').sub, null);
assert.equal(L('check this <https://mega.nz/folder/Ndwi1bAK#oLWNhH_g-h0p4BoT4c556A>, thx').id, 'Ndwi1bAK');
assert.equal(L('https://mega.nz/folder/Ndwi1bAK').key, null);
assert.equal(L('#F!Ndwi1bAK!oLWNhH_g-h0p4BoT4c556A').id, 'Ndwi1bAK');
assert.throws(() => L('https://mega.nz/file/Ndwi1bAK#abc'), /single-file/);
assert.throws(() => L('https://example.com/x'), /Not a MEGA folder link/);
assert.throws(() => L('https://mega.nz/folder/Ndwi1bAK#short'), /22 characters/);

console.log('core.test: all passed');
