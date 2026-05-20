// log4javascript accesses window.encodeURIComponent at module evaluation time;
// expose globalThis as window so the import doesn't crash in Node.js.
global.window = global;
