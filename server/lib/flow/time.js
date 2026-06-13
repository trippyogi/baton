'use strict';

function toSqliteDateTime(date = new Date()) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function sqliteDateTimeAfterMs(ms) {
  return toSqliteDateTime(new Date(Date.now() + ms));
}

module.exports = { toSqliteDateTime, sqliteDateTimeAfterMs };
