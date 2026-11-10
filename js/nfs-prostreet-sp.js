// Need for Speed: ProStreet — WebAssembly port runtime integration glue.
// The actual ProStreet web port core (AOT-recompiled ProStreet engine / PortSpeed-style
// WASM runtime) registers through the Emscripten Module interface. This file is the
// integration point where the game runtime attaches itself; it is intentionally
// environment-agnostic so the port can be swapped without touching the launcher UI.
//
// Boot chain implemented here (mirrors PortSpeed/web/src/wasm_loader.ts):
//   fetch prostreet.json -> compile prostreet.wasm -> instantiate
//   (URLs are resolved relative to the app base, so sub-path deployments work)
//   -> WASI (wasi_snapshot_preview1) shim -> reactor _initialize -> fntab_init
//   -> memory size check -> prostreet_load_pe (/data/nfs.exe) -> prostreet_main -> tick loop
(function () {
  'use strict';

  var M = window.Module || (window.Module = {});
  var runtime = (window.__nfsProStreet = window.__nfsProStreet || {});
  var state = (runtime.state = runtime.state || {
    phase: 'idle',
    status: 'idle',
    error: null,
    engine: null,
    log: [],
    startedAt: null,
  });

  var initializedReactors = new WeakSet();
  var initializedDispatchTables = new WeakSet();

  // Resolve asset URLs against the app base so the launcher also works under a
  // sub-path (e.g. GitHub Pages: /<repo>/prostreet.json instead of /prostreet.json).
  function resolveUrl(path) {
    var base = runtime.baseUrl || window.__NFS_BASE_URL || document.baseURI;
    try { return new URL(path, base).href; } catch (e) { return path; }
  }

  // Game folder bridge: the launcher stores the user's indexed files here.
  // The engine integration can read them on demand via runtime.getGameFile(path).
  runtime.setFiles = function (files) {
    runtime.files = Array.isArray(files) ? files : [];
  };
  runtime.getGameFile = function (path) {
    var list = runtime.files || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].path === path) { return list[i].file; }
    }
    return null;
  };

  M.onAbort = M.onAbort || function (e) { fail('abort', 'WebAssembly runtime abort: ' + JSON.stringify(e)); };

  function emit(name, detail) {
    window.dispatchEvent(new CustomEvent(name, { detail: detail || {} }));
  }

  function setStatus(status) {
    state.status = status;
    if (M.setStatus) {
      try { M.setStatus(status); } catch (e) { /* ignore */ }
    }
    emit('nfs-prostreet:status', { status: status, phase: state.phase });
  }

  function logLine(line) {
    state.log = state.log || [];
    state.log.push(String(line));
    if (M.print) {
      try { M.print(line); } catch (e) { /* ignore */ }
    }
  }

  function errorLine(line) {
    state.log = state.log || [];
    state.log.push(String(line));
    if (M.printErr) {
      try { M.printErr(line); } catch (e) { /* ignore */ }
    }
  }

  function fail(phase, message) {
    state.phase = 'error';
    state.error = message || 'ProStreet web port runtime failed';
    errorLine('[NFS-WASM] ' + state.error);
    emit('nfs-prostreet:runtime-error', { message: state.error, phase: phase, status: state.status });
    return Promise.reject(new Error(state.error));
  }

  function ok() {
    state.phase = 'ready';
    emit('nfs-prostreet:runtime-ready', { status: 'ready', phase: 'ready', engine: !!state.engine });
  }

  function createGuestMemory(manifest) {
    function mk(shared) {
      return new WebAssembly.Memory({
        initial: shared ? manifest.pages : Math.min(manifest.pages, 1024),
        maximum: shared ? manifest.maxPages : Math.min(manifest.maxPages, 2048),
        shared: shared,
      });
    }
    try {
      return mk(true);
    } catch (e) {
      // SharedArrayBuffer / cross-origin isolation unavailable -> unshared fallback.
      return mk(false);
    }
  }

  function resolveMemory(source) {
    return typeof source === 'function' ? source() : source;
  }

  function createWasiImports(memorySource, onStdout) {
    var mem = function () {
      var m = resolveMemory(memorySource);
      if (!m) throw new Error('[WASM] engine linear memory was not resolved before WASI use');
      return m;
    };
    var buffer = function () { return mem().buffer; };
    var view = function () { return new DataView(buffer()); };
    var u8 = function () { return new Uint8Array(buffer()); };
    return {
      proc_exit: function (code) { logLine('[WASM] proc_exit code=' + code); },
      fd_write: function (fd, iovs, iovsLen, nwritten) {
        var buf = buffer();
        var v = new DataView(buf);
        var u = new Uint8Array(buf);
        var total = 0;
        var text = '';
        for (var i = 0; i < iovsLen; i++) {
          var ptr = v.getUint32(iovs + i * 8, true);
          var len = v.getUint32(iovs + i * 8 + 4, true);
          text += new TextDecoder('utf-8').decode(u.subarray(ptr, ptr + len));
          total += len;
        }
        v.setUint32(nwritten, total, true);
        if (onStdout) { onStdout(text); }
        else { logLine('[NFS-GUEST] ' + text.split('\n').join('\n[NFS-GUEST] ')); }
        return 0; // __WASI_ERRNO_SUCCESS
      },
      fd_read: function () { return 0; },
      fd_seek: function () { return 0; },
      fd_close: function () { return 0; },
      fd_fdstat_get: function (_fd, statOut) {
        var v = view();
        v.setUint8(statOut, 2); // character device (stdio)
        v.setUint16(statOut + 2, 0, true);
        return 0;
      },
      fd_fdstat_set_flags: function () { return 0; },
      fd_prestat_get: function () { return 8; }, // EBADF (no preopened dirs)
      fd_prestat_dir_name: function () { return 8; },
      args_get: function () { return 0; },
      args_sizes_get: function (argc, buf_size) {
        var v = view();
        v.setUint32(argc, 0, true);
        v.setUint32(buf_size, 0, true);
        return 0;
      },
      environ_get: function () { return 0; },
      environ_sizes_get: function (count, buf_size) {
        var v = view();
        v.setUint32(count, 0, true);
        v.setUint32(buf_size, 0, true);
        return 0;
      },
      path_open: function () { return 0; },
      path_remove_directory: function () { return 0; },
      path_rename: function () { return 0; },
      path_unlink_file: function () { return 0; },
      clock_time_get: function (_id, _precision, timeOut) {
        var nowNs = BigInt(Math.round((typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now()) * 1e6));
        view().setBigUint64(timeOut, nowNs, true);
        return 0;
      },
      sched_yield: function () { return 0; },
    };
  }

  async function instantiateProStreet(module, manifest, onStdout) {
    var wantsEnvMemory = false;
    try {
      wantsEnvMemory = (WebAssembly.Module.imports ? WebAssembly.Module.imports(module).some(function (i) { return i.module === 'env' && i.name === 'memory' && i.kind === 'memory'; }) : false);
    } catch (e) { wantsEnvMemory = false; }

    var memory = null;
    var importedMemory = null;
    if (wantsEnvMemory) {
      importedMemory = createGuestMemory(manifest);
      memory = importedMemory;
    }
    var wasi = createWasiImports(function () {
      if (!memory) throw new Error('[WASM] engine linear memory was not resolved before WASI use');
      return memory;
    }, onStdout);

    var importObject = { wasi_snapshot_preview1: wasi };
    if (importedMemory) {
      importObject.env = { memory: importedMemory };
    }

    var instance = await WebAssembly.instantiate(module, importObject);
    var exportsObj = instance.exports || (instance.exports = {});

    // Module-owned (exported) memory wins; fall back to the imported one.
    if (exportsObj.memory instanceof WebAssembly.Memory) {
      memory = exportsObj.memory;
    } else if (!importedMemory) {
      return fail('instantiate', '[WASM] prostreet module neither exports nor imports a linear memory');
    }
    var engineMemory = memory;

    if (engineMemory.buffer.byteLength < (manifest ? manifest.guestEnd : 0)) {
      return fail('instantiate', '[WASM] engine memory (' + engineMemory.buffer.byteLength + ' bytes) is smaller than the guest arena (' + (manifest ? manifest.guestEnd : 0) + ' bytes)');
    }

    if (typeof exportsObj._initialize === 'function') {
      exportsObj._initialize = function () { return initializeReactorInstance(instance); };
    }
    if (typeof exportsObj.fntab_init === 'function') {
      exportsObj.fntab_init = function () { return initializeDispatchTableInstance(instance); };
    }

    return { instance: instance, module: module, memory: engineMemory, manifest: manifest, exports: exportsObj };
  }

  function initializeReactorInstance(instance) {
    if (initializedReactors.has(instance)) return false;
    initializedReactors.add(instance);
    var rawInit = instance.exports && instance.exports._initialize;
    if (typeof rawInit === 'function') { rawInit(); return true; }
    return false;
  }

  function initializeDispatchTableInstance(instance) {
    if (initializedDispatchTables.has(instance)) return false;
    initializedDispatchTables.add(instance);
    var rawFntabInit = instance.exports && instance.exports.fntab_init;
    if (typeof rawFntabInit === 'function') { rawFntabInit(); return true; }
    return false;
  }

  async function startRuntime() {
    if (state.phase === 'ready' || state.phase === 'loading') { return state.engine; }
    state.phase = 'loading';
    state.startedAt = Date.now();
    setStatus('loading');
    var indexed = runtime.files ? runtime.files.length : 0;
    logLine('[NFS-WASM] boot start: ' + indexed + ' game file(s) indexed, fetch manifest ' + resolveUrl('prostreet.json'));
    try {
      var manifestResp = await fetch(resolveUrl('prostreet.json'), { cache: 'no-cache' });
      if (!manifestResp.ok) { throw new Error('Failed to fetch ' + resolveUrl('prostreet.json') + ': HTTP ' + manifestResp.status); }
      var manifest = await manifestResp.json();
      setStatus('compiling');
      logLine('[NFS-WASM] boot: compile ' + resolveUrl('prostreet.wasm'));
      var wasmResp = await fetch(resolveUrl('prostreet.wasm'));
      if (!wasmResp.ok) {
        throw new Error('ProStreet WASM module not found at ' + resolveUrl('prostreet.wasm') + ' (HTTP ' + wasmResp.status + ') — engine build pending');
      }
      var bytes = await wasmResp.arrayBuffer();
      var module = await WebAssembly.compile(bytes);

      setStatus('instantiating');
      var engine = await instantiateProStreet(module, manifest, function (text) { logLine('[NFS-GUEST] ' + text); });
      state.engine = engine;

      setStatus('initializing');
      if (engine.exports && typeof engine.exports._initialize === 'function') { engine.exports._initialize(); }
      if (engine.exports && typeof engine.exports.fntab_init === 'function') { engine.exports.fntab_init(); }

      if (engine.exports && typeof engine.exports.prostreet_load_pe === 'function') {
        try {
          var peResp = await fetch(resolveUrl('data/nfs.exe'));
          if (peResp.ok) {
            var peBytes = new Uint8Array(await peResp.arrayBuffer());
            var stagingVa = 0x1f000000;
            var memoryEnd = stagingVa + peBytes.length;
            if (memoryEnd > engine.memory.buffer.byteLength) {
              logLine('[NFS-WASM] prostreet_load_pe skipped: image (' + peBytes.length + ' bytes) at 0x' + stagingVa.toString(16) +
                ' exceeds linear memory (' + engine.memory.buffer.byteLength + ' bytes)');
            } else {
              var memU8 = new Uint8Array(engine.memory.buffer);
              memU8.set(peBytes, stagingVa);
              var rc = engine.exports.prostreet_load_pe(stagingVa, peBytes.length);
              logLine('[NFS-WASM] prostreet_load_pe rc=' + rc);
            }
          } else {
            logLine('[NFS-WASM] prostreet_load_pe skipped: ' + resolveUrl('data/nfs.exe') + ' not found (HTTP ' + peResp.status + ')');
          }
        } catch (e) {
          logLine('[NFS-WASM] prostreet_load_pe error: ' + (e && e.message ? e.message : e));
        }
      }

      setStatus('starting');
      if (engine.exports && typeof engine.exports.prostreet_main === 'function') {
        try {
          engine.exports.prostreet_main(0, 0);
        } catch (e) {
          logLine('[NFS-WASM] prostreet_main error: ' + (e && e.message ? e.message : e));
        }
      }

      state.phase = 'ready';
      setStatus('ready');
      ok();
      startTickLoop(engine);
      return engine;
    } catch (e) {
      return fail('boot', e && e.message ? e.message : String(e));
    }
  }

  var frameId = null;
  function stopTickLoop() {
    if (frameId !== null) {
      if (typeof cancelAnimationFrame !== 'undefined') { cancelAnimationFrame(frameId); }
      frameId = null;
    }
  }
  function startTickLoop(engine) {
    stopTickLoop();
    var last = (typeof performance !== 'undefined' && typeof performance.now === 'function') ? performance.now() : (Date.now());
    var loop = function () {
      if (state.phase !== 'ready') { return; }
      var now = (typeof performance !== 'undefined' && typeof performance.now === 'function') ? performance.now() : last;
      var dtMs = now - last;
      last = now;
      if (engine && engine.exports && typeof engine.exports.prostreet_tick === 'function') {
        try {
          engine.exports.prostreet_tick(dtMs > 0 ? dtMs * 1000 : undefined);
        } catch (e) {
          errorLine('[NFS-WASM] prostreet_tick error: ' + (e && e.message ? e.message : e));
        }
      }
      if (state.phase === 'ready') {
        frameId = (typeof requestAnimationFrame !== 'function') ? null : requestAnimationFrame(loop);
      }
    };
    frameId = (typeof requestAnimationFrame !== 'function') ? null : requestAnimationFrame(loop);
  }

  runtime.start = function () { return startRuntime(); };
  runtime.stop = function () { stopTickLoop(); state.phase = 'idle'; state.engine = null; setStatus('idle'); };
  runtime.getState = function () { return state; };

  // Emscripten-style lifecycle hooks (kept for compatibility with a future generated
  // Emscripten module that drives initialization through this same Module object).
  if (typeof M.onRuntimeInitialized === 'function') {
    try {
      var onReady = M.onRuntimeInitialized();
      if (onReady && typeof onReady.then === 'function') {
        onReady.then(function () { ok(); }).catch(function (e) { fail('onRuntimeInitialized', e && e.message ? e.message : String(e)); });
      }
    } catch (e) {
      fail('onRuntimeInitialized', e && e.message ? e.message : String(e));
    }
  }
  if (M.thenRuntimeInitialized && typeof M.thenRuntimeInitialized.then === 'function') {
    M.thenRuntimeInitialized.then(function () { ok(); }).catch(function (e) { fail('thenRuntimeInitialized', e && e.message ? e.message : String(e)); });
  }

  window.addEventListener('nfs-prostreet:engine-start', function () { startRuntime(); });
  window.addEventListener('nfs-prostreet:engine-stop', function () { runtime.stop(); });
})();
