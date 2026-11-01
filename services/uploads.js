// @ts-check
'use strict';
// Upload naming (F7): an upload never replaces a file. A name already taken
// — on disk or earlier in the same batch — gets a " (2)", " (3)"… suffix;
// a file identical to the one it would have replaced is dropped instead.
const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');
const multer = require('multer');

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

/**
 * Receive the files of a multipart upload ("photos", up to 500, 200 MB each)
 * into `albumPath`, the caller having checked the rights and the album:
 * nothing overwritten, identical files dropped, other files refused; answers
 * { ok, count, files, renamed, duplicates, skipped }, starts the previews,
 * logs the upload and queues the new-photo notifications. Used by the admin
 * and by members uploading from an open album (routes/albums.js).
 * @param {any} req  @param {any} res  @param {string} albumPath
 */
function receive(req, res, albumPath) {
  const { isMedia, preGenerateAll } = require('./image');
  const activity = require('./activity');
  const notify   = require('./notify');
  // Never overwrite (F7): a taken name gets a " (2)" suffix (uniqueName).
  const reserved = new Set();
  const skipped  = [];
  multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, albumPath),
      filename: (_req, file, cb) => {
        // basename strips any client-supplied path components (e.g. "../../x.jpg")
        file.wanted = path.basename(file.originalname);
        try {
          const name = uniqueName(albumPath, file.wanted, reserved);
          reserved.add(name.toLowerCase());
          cb(null, name);
        } catch (e) { cb(e); }
      },
    }),
    fileFilter: (_req, file, cb) => {
      const ok = isMedia(file.originalname);
      if (!ok) skipped.push(path.basename(file.originalname));
      cb(null, ok);
    },
    limits: { fileSize: 200 * 1024 * 1024 },
    defParamCharset: 'utf8',   // browsers send UTF-8 file names ("défilé.jpg")
  }).array('photos', 500)(req, res, async err => {
    if (err) return res.status(400).json({ error: err.message });   // multer removes the batch's files
    const renamed = [], duplicates = [], uploadedFiles = [];
    for (const f of req.files ?? []) {
      if (f.filename !== f.wanted && await sameContent(f.path, path.join(albumPath, f.wanted))) {
        await fs.promises.unlink(f.path).catch(() => {});
        duplicates.push(f.wanted);
        continue;
      }
      if (f.filename !== f.wanted) renamed.push({ from: f.wanted, to: f.filename });
      uploadedFiles.push(f.filename);
    }
    preGenerateAll().catch(console.error);
    res.json({ ok: true, count: uploadedFiles.length, files: uploadedFiles, renamed, duplicates, skipped });
    activity.log('photo_upload', { username: req.user?.username ?? null, ip: req.ip, details: { album: req.params.album, count: uploadedFiles.length, filenames: uploadedFiles } });
    // one digest per album once the uploads stop (services/notify.js)
    notify.photosAdded(req.params.album, uploadedFiles);
  });
}

module.exports = { uniqueName, sameContent, receive, MAX_SUFFIX };
