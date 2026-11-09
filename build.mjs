// build.mjs — bundler-free build. Concatenates the sources into:
//   dist/index.html  (CSS + app JS + worker source inlined)
//   dist/sw.js       (service worker; browsers require it to be its own file)
// Usage: node build.mjs [--watch]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const src = (f) => fs.readFileSync(path.join(root, 'src', f), 'utf8');
const stripModule = (code) => code
  .replace(/^export\s+(?=(?:async\s+)?function|class|const|let)/gm, '')
  .replace(/^import\s.*?;\s*$/gm, '');

function build() {
  const core = stripModule(src('core.js'));
  const idb = stripModule(src('idb.js'));
  const version = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12);

  const workerSrc = `'use strict';\n${core}\n${idb}\n${src('worker.js')}`;
  const appJs = `(() => {\n'use strict';\nconst BUILD = ${JSON.stringify(version)};\n${core}\n${idb}\nconst WORKER_SRC = ${JSON.stringify(workerSrc)};\n${src('app.js')}\n})();`;
  const swJs = `// Mega Gallery service worker — build ${version}\n(() => {\n'use strict';\n${core}\n${idb}\n${src('sw-main.js')}\n})();\n`;

  const html = src('index.html')
    .replace('/*__CSS__*/', () => src('styles.css'))
    .replace('/*__JS__*/', () => appJs.replace(/<\/(script)/gi, '<\\/$1'));

  fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(root, 'dist', 'index.html'), html);
  fs.writeFileSync(path.join(root, 'dist', 'sw.js'), swJs);
  const kb = (s) => (Buffer.byteLength(s) / 1024).toFixed(1) + ' KB';
  console.log(`[build ${version}] dist/index.html ${kb(html)}, dist/sw.js ${kb(swJs)}`);
}

build();
if (process.argv.includes('--watch')) {
  let t = 0;
  fs.watch(path.join(root, 'src'), () => { clearTimeout(t); t = setTimeout(() => { try { build(); } catch (e) { console.error(e); } }, 80); });
  console.log('watching src/ …');
}
