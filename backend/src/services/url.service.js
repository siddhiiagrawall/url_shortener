// ─── URL Service ──────────────────────────────────────────────────────────────
//
// Business logic for URL shortening and retrieval.
// Coordinates between: validation → deduplication → DB → cache → analytics queue.
// ─────────────────────────────────────────────────────────────────────────────

const crypto = require('crypto');
const { encode }   = require('../utils/base62');
const { validateUrl, validateCustomCode } = require('../utils/validate');
const UrlModel     = require('../models/url.model');
const CacheService = require('./cache.service');
const redis        = require('../config/redis');

const UrlService = {
  /**
   * Shorten a URL.
   * Full write path: validate → deduplicate → insert → encode → cache → return.
   */
  async shorten({ originalUrl, customCode, expiresInDays, userId }) {
    // ── Step 1: Validate the URL ────────────────────────────────────────────
    const urlValidation = validateUrl(originalUrl);
    if (!urlValidation.valid) {
      const err = new Error(urlValidation.reason);
      err.statusCode = 400;
      err.code = 'INVALID_URL';
      throw err;
    }

    // ── Step 2: Validate custom code (if provided) ──────────────────────────
    if (customCode) {
      const codeValidation = validateCustomCode(customCode);
      if (!codeValidation.valid) {
        const err = new Error(codeValidation.reason);
        err.statusCode = 400;
        err.code = 'INVALID_CODE';
        throw err;
      }
    }

    // ── Step 3: Deduplication check ─────────────────────────────────────────
    // If this user already shortened this exact URL, return the existing code.
    // Prevents creating 10 codes for the same URL on repeated submissions.
    if (userId && !customCode) {
      const existing = await UrlModel.findByOriginalUrl(originalUrl, userId);
      if (existing) {
        const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
        return {
          short_code: existing.short_code,
          short_url: `${baseUrl}/${existing.short_code}`,
          original_url: originalUrl,
          is_duplicate: true, // Tell the client this was an existing link
        };
      }
    }

    // ── Step 4: Calculate expiry date ───────────────────────────────────────
    let expiresAt = null;
    if (expiresInDays) {
      expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + parseInt(expiresInDays));
    }

    // ── Step 5: Insert to DB and generate short code ────────────────────────
    let urlRecord;

    if (customCode) {
      // Custom code: single INSERT with the provided code
      try {
        urlRecord = await UrlModel.createWithCustomCode({
          originalUrl, shortCode: customCode, userId, expiresAt,
        });
      } catch (err) {
        // Postgres UNIQUE VIOLATION error code is '23505'
        if (err.code === '23505') {
          const conflict = new Error(`The code "${customCode}" is already in use.`);
          conflict.statusCode = 409;
          conflict.code = 'CODE_TAKEN';
          throw conflict;
        }
        throw err; // Re-throw unexpected errors
      }
    } else {
      // Auto-generated code: INSERT first (get id), then Base62-encode the id
      const row = await UrlModel.create({ originalUrl, userId, expiresAt });
      const shortCode = encode(row.id); // e.g., id=3521 → "ZP"
      urlRecord = await UrlModel.setShortCode(row.id, shortCode);
    }

    // ── Step 6: Warm up the cache ───────────────────────────────────────────
    // Pre-populate Redis so the first redirect is a cache hit (not a miss).
    await CacheService.setUrl(urlRecord.short_code, urlRecord.original_url);

    const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
    return {
      short_code: urlRecord.short_code,
      short_url: `${baseUrl}/${urlRecord.short_code}`,
      original_url: urlRecord.original_url,
      expires_at: urlRecord.expires_at,
      created_at: urlRecord.created_at,
    };
  },

  /**
   * Resolve a short code to its original URL.
   * Full read path: cache → DB → push analytics event → return URL.
   */
  async resolve(shortCode) {
    // ── Step 1: Check Redis cache ───────────────────────────────────────────
    const cached = await CacheService.getUrl(shortCode);

    if (cached !== undefined) {
      // Cache HIT (either a real URL or a cached null/404)
      return cached; // null → 404, string → redirect
    }

    // ── Step 2: Cache MISS — query Postgres ─────────────────────────────────
    const url = await UrlModel.findByCode(shortCode);

    if (!url) {
      // Cache the miss (negative caching) so Postgres isn't hit again for 30s
      await CacheService.setNull(shortCode);
      return null;
    }

    // ── Step 3: Populate the cache (cache-aside pattern) ────────────────────
    await CacheService.setUrl(shortCode, url.original_url);

    return url.original_url;
  },

  /**
   * Push a click event to the Redis Stream for async analytics processing.
   *
   * WHY ASYNC? The redirect already happened. We never block the redirect
   * for analytics. This runs "fire-and-forget" after the response is sent.
   *
   * WHY REDIS STREAM? Streams are persistent — events aren't lost if the
   * worker is down. The worker reads & processes them when it comes back up.
   *
   * IP HASHING: We hash the IP with SHA-256 + a salt.
   * One-way hash: we can detect unique visitors without storing PII.
   */
  async pushClickEvent({ shortCode, ip, userAgent, referer }) {
    try {
      const ipHash = ip
        ? crypto.createHash('sha256').update(ip + (process.env.JWT_SECRET || '')).digest('hex')
        : null;

      // XADD: add an entry to the Redis Stream named 'stream:clicks'
      // '*' tells Redis to auto-generate the entry ID (timestamp-based)
      await redis.xadd(
        'stream:clicks',
        '*', // auto-generate entry ID
        'short_code', shortCode,
        'ip_hash',    ipHash || '',
        'user_agent', userAgent || '',
        'referer',    referer || '',
        'ts',         Date.now().toString()
      );
    } catch (err) {
      // Non-fatal: analytics miss is acceptable, redirect must not fail
      console.error('Analytics push error:', err.message);
    }
  },
};

module.exports = UrlService;
