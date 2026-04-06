// ─── Redis Configuration ──────────────────────────────────────────────────────
// We use 'ioredis' — the most feature-complete Redis client for Node.js.
//
// WHY Redis?
//   Postgres lives on disk → reads take ~1-5ms
//   Redis lives in RAM   → reads take ~0.1-0.5ms (10x faster)
//
// We use Redis for 3 things:
//   1. Cache: short_code → original_url (avoids DB hit on every redirect)
//   2. Rate Limiting: per-IP/user request counters
//   3. Analytics Queue: click events stream (async, non-blocking)
// ─────────────────────────────────────────────────────────────────────────────

const Redis = require('ioredis');

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  // ioredis automatically retries failed commands on reconnect.
  // lazyConnect: false means it connects immediately on startup.
  lazyConnect: false,

  // How many times to retry a failed command before giving up.
  maxRetriesPerRequest: 3,

  // Reconnect strategy: wait 50ms, then 100ms, then 200ms... up to 2 seconds.
  // This is an exponential backoff — prevents thundering herd on reconnect.
  retryStrategy(times) {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
});

redis.on('connect', () => {
  if (process.env.NODE_ENV !== 'test') {
    console.log('✅ Redis connected');
  }
});

redis.on('error', (err) => {
  // LEARNING: We log but DON'T crash on Redis errors.
  // Redis is a cache — if it's down, we fall back to Postgres.
  // The app degrades gracefully (slower) but doesn't die.
  console.error('⚠️  Redis error (will fallback to DB):', err.message);
});

module.exports = redis;
