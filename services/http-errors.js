'use strict';
// A bad request (e.g. an album path that leaves the photo folder) is the
// client's error: answered 400 and not logged. Anything else is a server
// error: logged — it then shows in the admin System tab — and answered 500.

class BadRequest extends Error {
  constructor(message) { super(message); this.status = 400; }
}

function sendError(res, err) {
  if (err?.status >= 400 && err.status < 500) return res.status(err.status).json({ error: err.message });
  console.error(err);
  return res.status(500).json({ error: 'Internal server error' });
}

module.exports = { BadRequest, sendError };
