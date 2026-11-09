// Live probe: list public folders, then fetch + decrypt a batch of server thumbnails.
// Run: node test/live-probe.mjs <folder-link> [<folder-link> ...] [--save DIR]
import fs from 'node:fs';
import path from 'node:path';
import { MegaApi, parseMegaLink, listFolder, kindOf, extOf, parseFa, fetchFileAttributes } from '../src/core.js';

const args = process.argv.slice(2);
const saveIdx = args.indexOf('--save');
const saveDir = saveIdx >= 0 ? args.splice(saveIdx, 2)[1] : null;
const api = new MegaApi();

for (const raw of args) {
  const link = parseMegaLink(raw);
  const t0 = Date.now();
  let res;
  try {
    res = await listFolder(api, link);
  } catch (e) {
    console.log(`${link.id}: ERROR ${e.message}`);
    continue;
  }
  const { nodes } = res;
  const kinds = {}, exts = {};
  let withThumb = 0, withPrev = 0, withDur = 0, bytes = 0, folders = 0;
  for (const r of nodes) {
    const k = kindOf(r);
    kinds[k] = (kinds[k] || 0) + 1;
    if (r.t === 0) { bytes += r.s; exts[extOf(r.n)] = (exts[extOf(r.n)] || 0) + 1; } else folders++;
    const fa = parseFa(r.fa);
    if (fa.thumb) withThumb++;
    if (fa.preview) withPrev++;
    if (r.d) withDur++;
  }
  const rootRec = nodes.find((r) => r.h === res.root);
  console.log(`\n${link.id} "${rootRec && rootRec.n}" — ${nodes.length} nodes (${folders} folders) in ${Date.now() - t0} ms, ${(bytes / 1e9).toFixed(2)} GB`);
  console.log('  kinds', kinds, ' thumbs', withThumb, ' previews', withPrev, ' media-attrs(duration)', withDur);
  console.log('  top ext', Object.entries(exts).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([e, c]) => `${e}:${c}`).join(' '));
  const depth = (r) => { let d = 0, cur = r; const m = new Map(nodes.map((x) => [x.h, x])); while (cur && cur.p) { cur = m.get(cur.p); d++; } return d; };
  console.log('  max depth', Math.max(...nodes.map(depth)));

  // Thumbnail batch test: up to 30 nodes with a type-0 fa, grouped by cluster.
  const cand = nodes.filter((r) => r.k && parseFa(r.fa).thumb).slice(0, 30);
  if (!cand.length) continue;
  const byCluster = new Map();
  for (const r of cand) {
    const t = parseFa(r.fa).thumb;
    if (!byCluster.has(t.c)) byCluster.set(t.c, []);
    byCluster.get(t.c).push({ id: r.h, fah: t.h, key: r.k, name: r.n });
  }
  for (const [cluster, items] of byCluster) {
    const t1 = Date.now();
    const got = await fetchFileAttributes(api, link.id, 0, items);
    let jpeg = 0, bytesT = 0;
    for (const [id, data] of got) {
      bytesT += data.length;
      if (data[0] === 0xff && data[1] === 0xd8) jpeg++;
      if (saveDir) {
        fs.mkdirSync(saveDir, { recursive: true });
        fs.writeFileSync(path.join(saveDir, `${link.id}-${id}.jpg`), data);
      }
    }
    // JPEG dimensions from SOF marker
    const dims = [...got.values()].slice(0, 3).map((d) => {
      for (let i = 2; i < d.length - 9;) {
        if (d[i] !== 0xff) break;
        const m = d[i + 1], len = (d[i + 2] << 8) | d[i + 3];
        if (m >= 0xc0 && m <= 0xc3) return `${(d[i + 7] << 8) | d[i + 8]}x${(d[i + 5] << 8) | d[i + 6]}`;
        i += 2 + len;
      }
      return '?';
    });
    console.log(`  cluster ${cluster}: asked ${items.length}, got ${got.size}, valid JPEG ${jpeg}, ${(bytesT / 1024).toFixed(0)} KB total, ${Date.now() - t1} ms, dims ${dims.join(',')}`);
  }
}
