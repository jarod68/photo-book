'use strict';
// Photo metadata (EXIF, GPS, IPTC, XMP) via ExifReader — maintained, no
// dependencies. Replaces exifr (abandoned in 2022, unsafe on Node 26).
//
// The API and the values deliberately match what exifr returned, so the rest
// of the app (services/image.js, routes/map.js) sees no difference:
//  - `parse(file, opts)` → flat object with exifr's key names; `parse(file,
//    [keys])` → only those keys (or undefined); `gps(file)` → { latitude,
//    longitude } or undefined;
//  - rationals as numbers (FNumber 1.7, ExposureTime 0.004), EXIF dates as
//    Date in the server's local time zone (exifr's choice; the container runs
//    in UTC), UsePanoramaViewer as a boolean;
//  - an unreadable / unknown file rejects, as exifr did.
//
// Only the metadata is read: for a JPEG, the header segments up to the start
// of the compressed image (SOS) — a few hundred KB at most — so scanning a
// whole album for the map stays light. Other formats are read whole. Every
// file handle is closed explicitly (Node 26 treats a leaked one as fatal).
// One deliberate difference: exifr could not read WebP at all; WebP photos now
// get their EXIF / GPS like the other formats.
const fs = require('fs');
const ExifReader = require('exifreader');

const CHUNK = 64 * 1024;
const MAX_HEADER = 4 * 1024 * 1024;   // safety cap: no JPEG header is this big

// The JPEG metadata segments (SOI … up to SOS), or the whole file otherwise.
async function readMetadataBytes(filePath) {
  const fh = await fs.promises.open(filePath, 'r');
  try {
    const { size } = await fh.stat();
    let buf = Buffer.alloc(0);
    const readMore = async (n) => {
      const chunk = Buffer.alloc(Math.min(n, size - buf.length));
      const { bytesRead } = await fh.read(chunk, 0, chunk.length, buf.length);
      buf = Buffer.concat([buf, chunk.subarray(0, bytesRead)]);
      return bytesRead;
    };
    await readMore(CHUNK);
    if (!(buf[0] === 0xff && buf[1] === 0xd8)) {          // not a JPEG
      while (buf.length < size && await readMore(size - buf.length));
      return buf;
    }
    let pos = 2;
    while (pos + 4 <= MAX_HEADER) {
      if (pos + 4 > buf.length && !(await readMore(CHUNK))) break;
      if (buf[pos] !== 0xff) break;                          // corrupt: keep what we have
      const marker = buf[pos + 1];
      if (marker === 0xff) { pos += 1; continue; }           // fill byte
      if (marker === 0xda || marker === 0xd9) return buf.subarray(0, pos);   // SOS / EOI
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { pos += 2; continue; }
      const end = pos + 2 + buf.readUInt16BE(pos + 2);
      while (end > buf.length) if (!(await readMore(CHUNK))) return buf;
      pos = end;
    }
    return buf;
  } finally {
    await fh.close();
  }
}

// Concurrent reads of the same file share one read (the map asks for GPS and
// dates of each photo at the same time); nothing is kept once it resolves.
const inflight = new Map();
function sharedMetadataBytes(filePath) {
  let p = inflight.get(filePath);
  if (!p) {
    p = readMetadataBytes(filePath).finally(() => inflight.delete(filePath));
    inflight.set(filePath, p);
  }
  return p;
}

// `include` narrows what ExifReader decodes (XMP is the costly part): the map
// only needs GPS and dates, the photo panel needs everything.
async function readTags(filePath, include) {
  const bytes = await sharedMetadataBytes(filePath);
  return ExifReader.load(bytes, { expanded: true, includeUnknown: false, ...(include && { includeTags: include }) });
}

const GPS_TAGS = ['GPSLatitude', 'GPSLatitudeRef', 'GPSLongitude', 'GPSLongitudeRef'];
// exifr key → the EXIF tag it comes from, for the narrow `parse(file, [keys])` form.
const EXIF_TAG_OF = { DateTimeOriginal: 'DateTimeOriginal', CreateDate: 'DateTimeDigitized' };

const text = (t) => (t?.description != null && String(t.description) !== '' ? String(t.description) : undefined);
const num = (t) => {
  const v = Array.isArray(t?.value) && t.value.length === 2 && typeof t.value[0] === 'number' ? t.value[0] / t.value[1]
    : Array.isArray(t?.value) ? t.value[0] : t?.value;
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
};
// UserComment: ExifReader describes an empty / unknown-charset comment as a
// placeholder like "[Undefined encoding]" — that is not a caption.
const comment = (t) => {
  const s = text(t)?.replace(/\0/g, '').trim();
  return s && !/^\[[^\]]*encod[^\]]*\]$/i.test(s) ? s : undefined;
};
const bool = (t) => (t == null ? undefined : t.value === true || /^true$/i.test(String(t.value)));
// "YYYY:MM:DD HH:MM:SS" → Date in the local time zone (as exifr did).
const date = (t) => {
  const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(text(t) ?? '');
  return m ? new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : undefined;
};

// exifr key → value, from ExifReader's expanded tags.
function toExifrShape(t) {
  const exif = t.exif ?? {}, iptc = t.iptc ?? {}, xmp = t.xmp ?? {}, gps = t.gps ?? {}, png = t.png ?? {};
  const out = {
    // EXIF
    Make: text(exif.Make),
    Model: text(exif.Model),
    LensModel: text(exif.LensModel),
    ImageDescription: text(exif.ImageDescription),
    ISO: num(exif.ISOSpeedRatings),
    FNumber: num(exif.FNumber),
    ExposureTime: num(exif.ExposureTime),
    FocalLength: num(exif.FocalLength),
    DateTimeOriginal: date(exif.DateTimeOriginal),
    CreateDate: date(exif.DateTimeDigitized),
    // IFD0 dimensions (TIFF); for a PNG, exifr took them from its IHDR header.
    ImageWidth: num(exif.ImageWidth) ?? num(png['Image Width']),
    ImageHeight: num(exif.ImageLength) ?? num(png['Image Height']),
    ExifImageWidth: num(exif.PixelXDimension),
    ExifImageHeight: num(exif.PixelYDimension),
    // IPTC (exifr's names)
    ObjectName: text(iptc['Object Name']),
    Headline: text(iptc.Headline),
    City: text(iptc.City) ?? text(xmp.City),
    // XMP
    ProjectionType: text(xmp.ProjectionType),
    UsePanoramaViewer: bool(xmp.UsePanoramaViewer),
    Lens: text(xmp.Lens),
    // Fields image.js has always looked for under these names, which exifr
    // never produced (it named them title / description / Caption / State /
    // Country / FocalLengthIn35mmFormat, and dropped UserComment).
    Title: text(xmp.title),
    Description: text(xmp.description),
    'Caption-Abstract': text(iptc['Caption/Abstract']),
    UserComment: comment(exif.UserComment),
    'Province-State': text(iptc['Province/State']),
    'Country-PrimaryLocationName': text(iptc['Country/Primary Location Name']),
    FocalLengthIn35mmFilm: num(exif.FocalLengthIn35mmFilm),
    // GPS (decimal degrees, signed by the N/S, E/W refs)
    latitude: typeof gps.Latitude === 'number' ? gps.Latitude : undefined,
    longitude: typeof gps.Longitude === 'number' ? gps.Longitude : undefined,
  };
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return out;
}

// Like exifr: undefined when the file carries none of the requested tags.
async function parse(filePath, opts) {
  const narrow = Array.isArray(opts) && opts.every((k) => k in EXIF_TAG_OF);
  const all = toExifrShape(await readTags(filePath, narrow ? { exif: opts.map((k) => EXIF_TAG_OF[k]) } : undefined));
  const out = Array.isArray(opts) ? Object.fromEntries(opts.filter((k) => k in all).map((k) => [k, all[k]])) : all;
  return Object.keys(out).length ? out : undefined;
}

async function gps(filePath) {
  const { latitude, longitude } = toExifrShape(await readTags(filePath, { exif: GPS_TAGS, gps: true }));
  return latitude != null && longitude != null ? { latitude, longitude } : undefined;
}

module.exports = { parse, gps, readMetadataBytes };
