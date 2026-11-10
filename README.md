# Need for Speed: ProStreet — Web Port (BYO PC folder)

A browser-based web port launcher for **Need for Speed: ProStreet (2007)**, in the same
legal spirit and technical pattern as the existing [KisakCOD web port](https://mw.slqnt.dev/)
for Call of Duty 4: the page lets the user **pick their own PC game folder** and run the
game through a **WebAssembly** runtime in the browser.

> ⚠️ **Important:** This project is **not affiliated** with Electronic Arts, EA Black Box,
> or any commercial entity. It contains **no copyrighted game assets** and **no game files**.
> The user must supply their own legally obtained copy of *Need for Speed: ProStreet* (PC).

## What the launcher does

- **Folder picking** — `Pick game folder` uses the File System Access API
  (`showDirectoryPicker`, Chromium) with a `<input webkitdirectory>` fallback for other
  browsers. Dropping a folder onto the page works too.
- **Asset indexing** — the picked folder is walked recursively, files are kept as browser
  `File` objects (no upload, no server round-trip) and indexed in memory.
- **Size breakdown** — audio (`mp3/ogg/wav/mus/abk/snr/fsb/...`) and video
  (`vp6/bik/mp4/...`) totals are shown live and can be excluded before mounting.
- **Remembered folder** — in Chromium the picked directory handle is stored in IndexedDB,
  so the folder can be re-used after a reload (with permission re-confirmation).
- **Optional OPFS copy** — ticking *Keep a copy in OPFS* persists the selected files into
  the Origin Private File System (`opfs:/prostreet/…`) with a progress log and a
  `manifest.json`. Off by default because a full game folder is large.
- **COOP/COEP diagnostics** — the header badge shows whether cross-origin isolation and
  `SharedArrayBuffer` are available (`coi-serviceworker.js` enables them).
- **Wipe data** — clears localStorage, OPFS, IndexedDB, Cache Storage and service workers.
- **UA/EN UI** — Ukrainian and English interface with persistent language choice.

## Status / integration notes

- The user-facing launcher flow (folder pick/index → options → Play → canvas → fullscreen)
  is implemented in `index.html`.
- The actual ProStreet **WASM port runtime** integration point is `js/nfs-prostreet-sp.js`
  (Emscripten `Module`-style interface + boot orchestration). The game engine core
  (AOT-recompiled ProStreet / PortSpeed-style WASM) plugs in there.
- The runtime boot chain follows the PortSpeed `web/src/wasm_loader.ts` contract:
  fetch `prostreet.json` → compile `prostreet.wasm` → instantiate
  (WASI `wasi_snapshot_preview1` shims, single linear memory, reactor `_initialize`,
  `fntab_init`) → memory-size check vs `guestEnd` → `prostreet_load_pe` (`data/nfs.exe`) →
  `prostreet_main` → 60 FPS `prostreet_tick` loop.
  All paths are **resolved relative to the app base**, so the site works both at the domain
  root and under a sub-path (GitHub Pages).
- Lifecycle events: `nfs-prostreet:status`, `nfs-prostreet:runtime-ready`,
  `nfs-prostreet:runtime-error`, `nfs-prostreet:files-picked`.
- Entry points on `window.__nfsProStreet`:
  `start()`, `stop()`, `getState()`, `setFiles(files)`, `getGameFile(path)`.
  The launcher calls `setFiles()` with `[{ path, file, size }]` after indexing a folder.
- Current engine-integration state: **WIP**. The community PortSpeed project has made
  research progress (AOT recompilation of the original PC `nfs.exe`, WebGL2/D3D9 command
  consumer, audio/input/OPFS asset streaming), but the complete browser playability path is
  still under development. Do not treat this shipped launcher as a finished playable port.

## Project structure

```
index.html                 launcher UI, i18n, folder picker, OPFS copy, diagnostics
css/style.css              launcher styling
js/nfs-prostreet-sp.js     WASM boot chain + runtime bridge (engine integration point)
coi-serviceworker.js       COOP/COEP isolation service worker (SharedArrayBuffer)
favicon.svg                site icon
.github/workflows/pages.yml GitHub Pages deployment
```

## Local run

Because of COOP/COEP + service worker requirements, serve over HTTP(S), not `file://`:

```bash
python3 -m http.server 8080
# then open http://localhost:8080
```

On first load the page may reload once to activate the COI service worker.

## Browser support

- **Chromium-based browsers** — recommended: File System Access API, remembered folder
  handle, OPFS.
- **Firefox / Safari** — fallback folder input; OPFS copy is skipped if unsupported.

## Engine build requirements

The launcher expects these files to exist next to `index.html` (not shipped here):

- `prostreet.json` — manifest (`pages`, `maxPages`, `guestEnd`, …)
- `prostreet.wasm` — the compiled engine module
- `data/nfs.exe` — the user's legally obtained `nfs.exe` (only if the build uses
  `prostreet_load_pe`)

Until they exist, Play ends with a clear “engine build pending” runtime error in the log.

## Deploy

Deployed via GitHub Actions → GitHub Pages (`.github/workflows/pages.yml`).

## Legal

Use only files you legally own. No game content is distributed here.
