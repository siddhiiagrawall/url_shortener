// ─── Rate Limiter Middleware ───────────────────────────────────────────────────
//
// WHAT IS RATE LIMITING?
//   Restricting how many requests a client can make in a given time window.
//   Protects against: spam, DDoS attacks, brute force attempts, API abuse.
//
// WHY REDIS FOR RATE LIMITING?
//   If you stored counters in-memory (in Node.js), each SERVER would have its own counter.
//   User could make 10 requests to server A and 10 to server B = 20 requests.
//   Redis is SHARED across all servers — one source of truth.
//
// THE SLIDING WINDOW ALGORITHM (using Redis Sorted Set):
//   Fixed window problem: user sends 10 requests at 00:59 and 10 at 01:00 = 20 in 2 seconds!
//   Sliding window fix: the window is always "the last 60 seconds", not "the current minute".
//
//   Implementation with Sorted Set:
//     - Member: unique request ID (timestamp + random)
//     - Score: current timestamp in milliseconds
//     - On each request:
//       1. Remove all members with score < (now - 60000ms)  → outside window
//       2. Add current request with score = now
//       3. ZCARD → count of requests in the last 60 seconds
//       4. If count > limit → reject with 429
//
//   WHY PIPELINE? We send all 4 Redis commands in one network round-trip instead of 4.
//   Latency: 1×RTT instead of 4×RTT. Critical for middleware that runs on every request.
// ─────────────────────────────────────────────────────────────────────────────

const redis = require('../config/redis');

/**
 * Create a rate limiter middleware with given limits.
 * Returns an Express middleware function.
 *
 * @param {object} options
 * @param {number} options.windowSeconds - Size of the sliding window (e.g., 60)
 * @param {number} options.maxAnon - Max requests for anonymous users
 * @param {number} options.maxFree - Max requests for free-plan users
 * @param {number} options.maxPro  - Max requests for pro-plan users
 */
function createRateLimiter({ windowSeconds = 60, maxAnon = 10, maxFree = 50, maxPro = 500 } = {}) {
  return async function rateLimiterMiddleware(req, res, next) {
    // Determine the identifier for this client
    // Prefer user ID (logged in) over IP (anonymous) — more accurate per-user limiting
    const identifier = req.user
      ? `user:${req.user.id}`
      : `ip:${req.ip}`;

    // Determine their limit based on plan
    let limit = maxAnon;
    if (req.user) {
      limit = req.user.plan === 'pro' ? maxPro : maxFree;
    }

    const key = `ratelimit:${identifier}`;
    const now = Date.now();
    const windowMs = windowSeconds * 1000;
    const windowStart = now - windowMs;

    try {
      // Pipeline: send 4 commands in one network round-trip
      const pipeline = redis.pipeline();

      // 1. Remove expired entries (requests outside our sliding window)
      pipeline.zremrangebyscore(key, 0, windowStart);

      // 2. Add current request (score = timestamp allows range queries)
      pipeline.zadd(key, now, `${now}-${Math.random()}`);

      // 3. Count requests in the current window
      pipeline.zcard(key);

      // 4. Set key expiry so Redis auto-cleans up inactive users' keys
      pipeline.expire(key, windowSeconds);

      const results = await pipeline.exec();
      // results[2] is the ZCARD result: [error, count]
      const requestCount = results[2][1];

      // Set informational headers (standard practice — lets clients self-throttle)
      res.setHeader('X-RateLimit-Limit', limit);
      res.setHeader('X-RateLimit-Remaining', Math.max(0, limit - requestCount));
      res.setHeader('X-RateLimit-Reset', Math.ceil((now + windowMs) / 1000)); // Unix timestamp

      if (requestCount > limit) {
        return res.status(429).json({
          success: false,
          error: {
            code: 'RATE_LIMITED',
            message: `Too many requests. Limit: ${limit} per ${windowSeconds} seconds.`,
          },
          retry_after: windowSeconds,
        });
      }

      next();
    } catch (err) {
      // If Redis is down, allow the request (fail open).
      // WHY fail open? It's better to be slightly unprotected than to block all traffic.
      // In production, you'd add an alert here so ops team knows.
      console.error('Rate limiter error (failing open):', err.message);
      next();
    }
  };
}

// Pre-configured limiters for different endpoints
const shortenLimiter   = createRateLimiter({ maxAnon: 10,  maxFree: 50,  maxPro: 500 });
const redirectLimiter  = createRateLimiter({ maxAnon: 100, maxFree: 500, maxPro: 5000 });

module.exports = { createRateLimiter, shortenLimiter, redirectLimiter };
