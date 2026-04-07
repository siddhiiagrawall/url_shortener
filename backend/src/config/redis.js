// ─── Redis Configuration ──────────────────────────────────────────────────────
// We use 'ioredis' — the most feature-complete Redis client for Node.js.
//
// LOCAL:      REDIS_URL=redis://localhost:6379   (plain TCP)
// PRODUCTION: REDIS_URL=rediss://...upstash.io:6379  (TLS — Upstash requires it)
//
// WHY TLS for Upstash?
//   Upstash is a managed cloud Redis. All traffic goes over the internet,
//   so it must be encrypted. 'rediss://' = Redis over TLS (like HTTPS vs HTTP).
// ─────────────────────────────────────────────────────────────────────────────

const Redis = require('ioredis');

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

// When using Upstash (rediss://), we must explicitly enable TLS.
// ioredis reads the scheme but needs tls:{} to trust cloud certificates.
const tlsOptions = redisUrl.startsWith('rediss://')
  ? { tls: { rejectUnauthorized: false } }  // false = accept Upstash's cert
  : {};

const redis = new Redis(redisUrl, {
  ...tlsOptions,
  lazyConnect: false,
  maxRetriesPerRequest: 3,
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
  // Log but DON'T crash — Redis is a cache layer, not source of truth.
  // If Redis is down, requests fall back to Postgres (slower but correct).
  console.error('⚠️  Redis error (will fallback to DB):', err.message);
});

module.exports = redis;
