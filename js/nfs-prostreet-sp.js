// Need for Speed: ProStreet — WebAssembly port runtime integration glue.
// The actual ProStreet web port core (AOT-recompiled ProStreet engine / PortSpeed-style
// WASM runtime) registers through the Emscripten Module interface. This file is the
// integration point where the game runtime attaches itself; it is intentionally
// environment-agnostic so the port can be swapped without touching the launcher UI.
(function () {
  var M = window.Module || (window.Module = {});
  M.setStatus = M.setStatus || function () {};
  M.print = M.print || function () {};
  M.printErr = M.printErr || function () {};
  M.onAbort = M.onAbort || function () {};
  if (typeof M.onRuntimeInitialized === "function") {
    try {
      M.onRuntimeInitialized();
    } catch (err) {
      console.warn("NFS ProStreet web port: onRuntimeInitialized hook error", err);
    }
  }
  if (typeof M.thenRuntimeInitialized === "function") {
    M.thenRuntimeInitialized.catch(function (err) { console.warn("NFS ProStreet web port runtime init failed", err); });
  }
  window.dispatchEvent(new CustomEvent("nfs-prostreet:runtime-ready"));
})();
