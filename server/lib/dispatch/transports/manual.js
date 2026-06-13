'use strict';

async function sendManual() {
  return { ok: false, dispatch_status: 'not_configured', error: 'No dispatch transport configured.' };
}

module.exports = { sendManual };
