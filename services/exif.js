'use strict';
// exifr, made Node 26 safe. Always read EXIF through this module.
//
// exifr 7.1.3 (its last release, 2022) has two file-handle bugs that Node 26
// turns into crashes:
//  1. it opens a file, then calls `filehandle.stat(path)`. Node <= 24 ignored
//     the stray argument; Node 26 validates it ("options" must be an object)
//     and throws.
//  2. when parsing fails (empty / truncated / non-image file) it never closes
//     the handle it opened. Node 26 makes a FileHandle collected while still
//     open a fatal error (ERR_INVALID_STATE), taking the whole server down.
//
// exifr lets us swap its file readers: keep its `fs` reader, fix `open()`, and
// record every handle a call opens (AsyncLocalStorage keeps concurrent calls
// apart) so `parse` / `gps` close whatever exifr left open — success or failure.
const { AsyncLocalStorage } = require('node:async_hooks');
const exifr = require('exifr');

const callHandles = new AsyncLocalStorage();
const FsReader = exifr.fileReaders.get('fs');

class SafeFsReader extends FsReader {
  async open() {
    if (this.fh === undefined) {
      this.fh = await this.fs.open(this.input, 'r');
      callHandles.getStore()?.add(this.fh);
      this.size = (await this.fh.stat()).size;
    }
  }
}

exifr.fileReaders.set('fs', SafeFsReader);

// Run one exifr call, then close every handle it opened and did not close.
function closingHandles(fn) {
  return (...args) => {
    const handles = new Set();
    return callHandles.run(handles, async () => {
      try {
        return await fn(...args);
      } finally {
        await Promise.all([...handles].map((fh) => fh.close().catch(() => {})));
      }
    });
  };
}

// Resolved at call time (not captured at load) so tests can spy on exifr.
module.exports = {
  parse: closingHandles((...args) => exifr.parse(...args)),
  gps: closingHandles((...args) => exifr.gps(...args)),
};
