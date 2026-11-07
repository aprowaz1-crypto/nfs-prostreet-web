# Need for Speed: ProStreet — Web Port (BYO PC folder)

A browser-based web port launcher for **Need for Speed: ProStreet (2007)**, in the same
legal spirit and technical pattern as the existing [KisakCOD web port](https://mw.slqnt.dev/)
for Call of Duty 4: the page lets the user **pick their own PC game folder** and run the
game through a **WebAssembly** runtime in the browser.

> ⚠️ **Important:** This project is **not affiliated** with Electronic Arts, EA Black Box,
> or any commercial entity. It contains **no copyrighted game assets** and **no game files**.
> The user must supply their own legally obtained copy of *Need for Speed: ProStreet* (PC).

## What this project does
- Provides a **BYO (Bring Your Own)** PC game folder picker (`Pick game folder`).
- Runs the browser-side **Web port** with the user's own installation.
- Uses COOP/COEP isolation via a service worker (`coi-serviceworker.js`) so
  `SharedArrayBuffer` is available for threaded WASM runtimes.

## Status / integration notes
- The user-facing launcher flow (installer → folder pick → mount/copy → Play → canvas →
  fullscreen) is implemented in `index.html`.
- The actual ProStreet **WASM port runtime** integration point is `js/nfs-prostreet-sp.js`
  (Emscripten `Module`-style interface + boot orchestration). The game engine core (AOT-recompiled ProStreet /
  PortSpeed-style WASM) plugs in there.
- The runtime boot chain is implemented in `js/nfs-prostreet-sp.js` and follows the PortSpeed
  `web/src/wasm_loader.ts` contract: fetch `/prostreet.json` → compile `/prostreet.wasm` → instantiate
  (WASI `wasi_snapshot_preview1` shims, single linear memory, reactor `_initialize`, `fntab_init`) →
  memory-size check vs `guestEnd` → `prostreet_load_pe` (`/data/nfs.exe`) → `prostreet_main` →
  60 FPS `prostreet_tick` loop. Lifecycle events: `nfs-prostreet:status`, `nfs-prostreet:runtime-ready`,
  `nfs-prostreet:runtime-error`. Entry: `window.__nfsProStreet.start()` (also wired to the module-load
  `onload` path via the Play flow).
- Launcher now includes UA/EN UI toggle and module-load error handling.
- Current engine-integration state: **WIP**. The community PortSpeed project has made
  research progress (AOT recompilation of the original PC `nfs.exe`, WebGL2/D3D9 command
  consumer, audio/input/OPFS asset streaming), but the complete browser playability path is
  still under development. Do not treat this shipped launcher as a finished playable port.

## Local run
Because of COOP/COEP + service worker requirements, serve over HTTP(S), not `file://`:

```bash
python3 -m http.server 8080
# then open http://localhost:8080
```

On first load the page may reload once to activate the COI service worker.

## Deploy
Deployed via GitHub Actions → GitHub Pages (`.github/workflows/pages.yml`).

## Legal
Use only files you legally own. No game content is distributed here.
