'use strict';
// The last server errors, for the admin System tab (F8). console.error is
// wrapped once at startup: every call still prints, and is also kept in a
// small ring buffer (newest first). Nothing is written to disk.

const MAX = 50;
const MAX_LEN = 500;
const entries = [];
let installed = false;

// an Error keeps its message and the first frames of its stack
const text = (a) => (a instanceof Error ? (a.stack || a.message).split('\n').slice(0, 3).join('\n') : typeof a === 'string' ? a : (() => {
  try { return JSON.stringify(a); } catch { return String(a); }
})());

function record(args) {
  const message = args.map(text).join(' ').slice(0, MAX_LEN);
  entries.unshift({ at: new Date().toISOString(), message });
  if (entries.length > MAX) entries.length = MAX;
}

function install(con = console) {
  if (installed) return;
  installed = true;
  const original = con.error.bind(con);
  con.error = (...args) => { record(args); original(...args); };
}

const recent = () => entries.slice();
function _reset() { entries.length = 0; }

module.exports = { install, record, recent, MAX, _reset };
