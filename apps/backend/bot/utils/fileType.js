'use strict';

// CJS shim for file-type v22+ (ESM-only). Lazy-loads once and caches.
let _fromBuffer;

async function fromBuffer(buf) {
  if (!_fromBuffer) {
    ({ fileTypeFromBuffer: _fromBuffer } = await import('file-type'));
  }
  return _fromBuffer(buf);
}

module.exports = { fromBuffer };
