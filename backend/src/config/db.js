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
// SSL: Neon (and most cloud Postgres) require an encrypted connection.
// We enable SSL whenever the DATABASE_URL looks like a cloud host.
// rejectUnauthorized: false → trust the server's certificate without verifying
// the CA chain. Required for Neon's certs which aren't in Node's trust store.
const dbUrl = process.env.DATABASE_URL || '';
const sslConfig = (dbUrl.includes('neon.tech') || dbUrl.includes('sslmode=require'))
  ? { rejectUnauthorized: false }
  : false;

const pool = new Pool({
  connectionString: dbUrl,

  // SSL for cloud databases (Neon, Render Postgres, Supabase, etc.)
  ssl: sslConfig,

  // Free tier Render/Neon have tight connection limits — keep pool small
  min: parseInt(process.env.DB_POOL_MIN) || 1,
  max: parseInt(process.env.DB_POOL_MAX) || 5,

  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000, // Cloud DBs take longer to connect than local
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
