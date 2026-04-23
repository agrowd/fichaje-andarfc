// api/_db.js — Shared Neon database connection
const { neon } = require('@neondatabase/serverless');

let _sql = null;

function getSQL() {
  if (!_sql) {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL environment variable is not set');
    }
    _sql = neon(process.env.DATABASE_URL);
  }
  return _sql;
}

module.exports = { getSQL };
