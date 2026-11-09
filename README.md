# Mega Gallery

Browse several public MEGA folder links as one gallery, client-side only.

**Deploy:** copy `dist/index.html` and `dist/sw.js` to any static HTTPS host (GitHub Pages, Netlify, Cloudflare Pages), side by side.
The service worker is what lets video stream and seek. Browsers only run service workers over HTTPS or on localhost.
On `file://` the app still browses, shows thumbnails and opens photos. Videos then load into memory instead of streaming, up to 120 MB on iOS and 400 MB elsewhere.

**Develop:** `node build.mjs --watch` and `node serve.mjs` (http://localhost:8642). Tests: `node test/core.test.mjs`; live probe: `node test/live-probe.mjs <folder-link>`.

## How it works

| Piece | File | Notes |
|---|---|---|
| MEGA client | `src/core.js` | Pure-JS AES (checked against OpenSSL), API with EAGAIN backoff + hashcash, key/attribute decryption, link parsing |
| Tree walk | `src/worker.js` | One `f` call (`r:1`) returns the whole tree. It is decrypted in a Web Worker in slices and can be cancelled |
| Thumbnails | `src/worker.js` | MEGA's own server thumbnails (`fa` type 0), batched up to 120 per POST per storage cluster. Cluster URLs are cached and results are stored in IndexedDB |
| Streaming | `src/sw-main.js` | Answers `Range` requests with 206 responses. It fetches only the needed bytes and decrypts them with AES-CTR at any offset. Responses are `no-store`; encrypted 1 MB blocks are kept in an LRU cache (32 MB in memory, up to 500 MB in IndexedDB, switchable in the links sheet) so revisited videos start without the network |
| UI | `src/app.js` | Virtual grid/list, sort/filter/search, hash routing (Back works), scroll/filters persisted |
| Feed | `src/app.js` | Full-screen vertical video feed over the current view: scroll-snap cards, three rotating `<video>` elements, muted autoplay with tap-to-unmute, per-session seeded shuffle. Only clips longer than 10 s (or above `MIN_FEED_VIDEO_BYTES` when MEGA stored no duration) are included; the next two cards get their head and tail blocks prefetched through the service worker |

Thumbnails are not stored inside the node attributes. Each node's `fa` field points to a ~5–15 KB encrypted JPEG on MEGA's attribute servers. The JPEG is AES-CBC encrypted with the file key. Each request takes about 1–1.5 s no matter how many thumbnails it asks for, so the app sends large per-cluster batches in parallel.
