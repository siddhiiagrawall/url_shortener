// ─── Cache Service ────────────────────────────────────────────────────────────
//
// This is our interface to Redis for caching.
// All Redis key naming and TTL logic lives here — nowhere else.
//
// KEY NAMING CONVENTION: "namespace:identifier"
//   url:aB3k     → the original URL for short code "aB3k"
//   null:aB3k    → "this code does not exist" (negative cache entry)
//
// WHY NEGATIVE CACHING?
//   If someone requests /doesNotExist 1000 times, without negative caching
//   every request queries Postgres. With it, after the first miss, we cache
//   "this code doesn't exist" for 30s so Postgres never sees the rest.
// ─────────────────────────────────────────────────────────────────────────────

const redis = require('../config/redis');

const CACHE_TTL = parseInt(process.env.CACHE_TTL_SECONDS) || 3600; // 1 hour
const NULL_TTL  = 30; // Cache "not found" results for 30 seconds
const NULL_VAL  = '__NULL__'; // Sentinel value meaning "we checked, it doesn't exist"

const CacheService = {
  /**
   * Get a URL from cache.
   * Returns: the URL string, null (not found), or undefined (cache miss → check DB)
   */
  async getUrl(shortCode) {
    try {
      const value = await redis.get(`url:${shortCode}`);

      if (value === null) return undefined;  // Key doesn't exist in Redis → cache miss
      if (value === NULL_VAL) return null;   // Negative cache hit → 404

      return value; // Real URL string → redirect to this
    } catch (err) {
      // IMPORTANT: If Redis is down, we return undefined (cache miss).
      // This causes a DB fallback, not an error. Graceful degradation.
      console.error('Cache get error (falling back to DB):', err.message);
      return undefined;
    }
  },

  /**
   * Store a URL in cache with TTL.
   * Called after a DB hit (cache-aside: populate on miss).
   */
  async setUrl(shortCode, originalUrl) {
    try {
      // EX sets expiry in seconds. After CACHE_TTL seconds, Redis auto-deletes the key.
      await redis.set(`url:${shortCode}`, originalUrl, 'EX', CACHE_TTL);
    } catch (err) {
      console.error('Cache set error:', err.message);
      // Non-fatal: the request still succeeds, just without caching next time
    }
  },

  /**
   * Cache a "not found" result — negative caching.
   * Prevents hammering Postgres for non-existent codes.
   */
  async setNull(shortCode) {
    try {
      await redis.set(`url:${shortCode}`, NULL_VAL, 'EX', NULL_TTL);
    } catch (err) {
      console.error('Cache setNull error:', err.message);
    }
  },

  /**
   * Remove a URL from cache.
   * Called when a URL is updated or deleted — forces next request to re-fetch from DB.
   * This is CACHE INVALIDATION — one of the hardest problems in CS!
   */
  async deleteUrl(shortCode) {
    try {
      await redis.del(`url:${shortCode}`);
    } catch (err) {
      console.error('Cache delete error:', err.message);
    }
  },
};

module.exports = CacheService;
