// ─── Database Configuration ───────────────────────────────────────────────────
// We use the 'pg' library's Pool class.
//
// WHY a connection pool?
//   Opening a new TCP connection to Postgres on every request takes ~50ms.
//   A pool keeps N connections open and reuses them — reuse takes ~0ms.
//   This is critical for performance under load.
//
// HOW it works:
//   When your code calls pool.query(), pg grabs an idle connection from the pool.
//   When the query finishes, the connection is returned to the pool (not closed).
//   If all connections are busy, new requests queue and wait.
// ─────────────────────────────────────────────────────────────────────────────

const { Pool } = require('pg');

// Create a single pool instance for the entire app.
// This is a singleton — we export it and reuse it everywhere.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,

  // Minimum connections kept open even when idle.
  // WHY 2? So the first request after a quiet period doesn't pay connection cost.
  min: parseInt(process.env.DB_POOL_MIN) || 2,

  // Maximum simultaneous connections.
  // WHY 10? Postgres has a default max of 100 connections.
  // With multiple app instances, keep this low enough to share.
  max: parseInt(process.env.DB_POOL_MAX) || 10,

  // Kill idle connections after 30 seconds to free resources.
  idleTimeoutMillis: 30000,

  // Reject a connection attempt if it takes longer than 2 seconds.
  connectionTimeoutMillis: 2000,
});

// Test the connection when the app starts.
// LEARNING: This is called "eager validation" — fail fast if DB is unreachable.
pool.on('connect', () => {
  if (process.env.NODE_ENV !== 'test') {
    console.log('✅ PostgreSQL connected');
  }
});

pool.on('error', (err) => {
  console.error('❌ Unexpected Postgres error:', err.message);
  // In production, this would trigger an alert to your monitoring system.
  process.exit(-1); // Exit so the process manager (Docker) restarts us.
});

module.exports = pool;
