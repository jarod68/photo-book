'use strict';
// Content-Security-Policy (T6). Every script, style, font and data file is
// served by the app itself (libraries under /vendor/, see services/vendor.js);
// the only third-party resources are OpenStreetMap tiles (images). The one
// inline script — the globe's import map — is allowed by its hash, computed
// from the HTML actually served. Inline styles stay allowed (style
// attributes in the markup; Leaflet and Pannellum set them too).
// Violations are reported to /api/csp-report and appear in Admin → System.
const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');

const TILE_ORIGIN = 'https://tile.openstreetmap.org';

/** 'sha256-…' sources for the inline <script> blocks of the given HTML files. */
function inlineScriptHashes(publicDir, files = ['globe.html']) {
  const out = [];
  for (const f of files) {
    const html = fs.readFileSync(path.join(publicDir, f), 'utf8');
    for (const m of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)) {
      out.push(`'sha256-${crypto.createHash('sha256').update(m[1]).digest('base64')}'`);
    }
  }
  return out;
}

function directives(publicDir) {
  return {
    defaultSrc:     ["'self'"],
    scriptSrc:      ["'self'", ...inlineScriptHashes(publicDir)],
    styleSrc:       ["'self'", "'unsafe-inline'"],
    imgSrc:         ["'self'", 'data:', 'blob:', TILE_ORIGIN],
    mediaSrc:       ["'self'", 'blob:'],
    connectSrc:     ["'self'"],
    fontSrc:        ["'self'", 'data:'],
    workerSrc:      ["'self'"],
    manifestSrc:    ["'self'"],
    objectSrc:      ["'none'"],
    baseUri:        ["'self'"],
    formAction:     ["'self'"],
    frameAncestors: ["'none'"],
    reportUri:      ['/api/csp-report'],
  };
}

// Each distinct violation is logged once (the browser repeats them on every page).
const seen = new Set();
function logViolation(body) {
  const r = body?.['csp-report'] ?? body?.[0]?.body ?? body ?? {};
  const directive = r['effective-directive'] || r['violated-directive'] || r.effectiveDirective || '?';
  const blocked   = r['blocked-uri'] || r.blockedURL || '?';
  const page      = String(r['document-uri'] || r.documentURL || '?').replace(/\?.*/, '');
  const key = `${directive} ${blocked} ${page}`;
  if (seen.has(key) || seen.size >= 200) return false;
  seen.add(key);
  console.error(`CSP violation: ${directive} blocked ${blocked} on ${page}`);
  return true;
}

function _reset() { seen.clear(); }

module.exports = { TILE_ORIGIN, inlineScriptHashes, directives, logViolation, _reset };
