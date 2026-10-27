'use strict';
// Upload naming (F7): an upload never replaces a file. A name already taken
// — on disk or earlier in the same batch — gets a " (2)", " (3)"… suffix;
// a file identical to the one it would have replaced is dropped instead.
const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');

const MAX_SUFFIX = 999;

/** First free name for `wanted` in `dir`; `reserved` holds names given out in this batch. */
function uniqueName(dir, wanted, reserved = new Set(), _exists = fs.existsSync) {
  const taken = (name) => reserved.has(name.toLowerCase()) || _exists(path.join(dir, name));
  if (!taken(wanted)) return wanted;
  const ext  = path.extname(wanted);
  const base = path.basename(wanted, ext);
  for (let n = 2; n <= MAX_SUFFIX; n++) {
    const name = `${base} (${n})${ext}`;
    if (!taken(name)) return name;
  }
  throw new Error(`Too many files named ${wanted}`);
}

async function sha256(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

/** True when both files have the same bytes (sizes compared first). */
async function sameContent(a, b) {
  const [sa, sb] = await Promise.all([fs.promises.stat(a), fs.promises.stat(b)]).catch(() => [null, null]);
  if (!sa || !sb || sa.size !== sb.size) return false;
  const [ha, hb] = await Promise.all([sha256(a), sha256(b)]);
  return ha === hb;
}

module.exports = { uniqueName, sameContent, MAX_SUFFIX };
