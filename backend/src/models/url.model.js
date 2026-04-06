// ─── URL Model ────────────────────────────────────────────────────────────────
// All database operations for URLs and click analytics.
// ─────────────────────────────────────────────────────────────────────────────

const pool = require('../config/db');

const UrlModel = {
  /**
   * Insert a new URL row WITHOUT the short_code initially.
   * We need the auto-generated `id` FIRST to compute the Base62 short_code.
   *
   * Flow: INSERT → get id → Base62(id) = short_code → UPDATE short_code
   * This is a 2-step process because we need the DB-assigned id to make the code.
   */
  async create({ originalUrl, userId, expiresAt }) {
    const result = await pool.query(
      `INSERT INTO urls (short_code, original_url, user_id, expires_at)
       VALUES ('__pending__', $1, $2, $3)
       RETURNING id`,
      [originalUrl, userId || null, expiresAt || null]
    );
    return result.rows[0]; // { id: 42 }
  },

  /**
   * After computing the Base62 code from the id, store it.
   */
  async setShortCode(id, shortCode) {
    const result = await pool.query(
      `UPDATE urls SET short_code = $1 WHERE id = $2
       RETURNING id, short_code, original_url, user_id, expires_at, created_at`,
      [shortCode, id]
    );
    return result.rows[0];
  },

  /**
   * Create with a custom short code (user-provided).
   * This is a single INSERT — we already have the code before inserting.
   * If the code is already taken, Postgres throws a UNIQUE VIOLATION error.
   * The service layer catches that error and returns a 409 Conflict.
   */
  async createWithCustomCode({ originalUrl, shortCode, userId, expiresAt }) {
    const result = await pool.query(
      `INSERT INTO urls (short_code, original_url, user_id, expires_at)
       VALUES ($1, $2, $3, $4)
       RETURNING id, short_code, original_url, user_id, expires_at, created_at`,
      [shortCode, originalUrl, userId || null, expiresAt || null]
    );
    return result.rows[0];
  },

  /**
   * The HOT PATH — called on every single redirect.
   * This query MUST use the idx_urls_short_code index (it will, because WHERE short_code = ?).
   *
   * We also check is_active and expires_at here to avoid returning dead links.
   * Checking in SQL is faster than fetching the row and checking in JS.
   */
  async findByCode(shortCode) {
    const result = await pool.query(
      `SELECT id, short_code, original_url, user_id, expires_at
       FROM urls
       WHERE short_code = $1
         AND is_active = TRUE
         AND (expires_at IS NULL OR expires_at > NOW())`,
      [shortCode]
    );
    return result.rows[0] || null;
  },

  /**
   * Check if a user already has a short URL for this original URL (deduplication).
   * WHY deduplicate? No reason to create two codes for the same URL for the same user.
   */
  async findByOriginalUrl(originalUrl, userId) {
    const result = await pool.query(
      `SELECT short_code FROM urls
       WHERE original_url = $1 AND user_id = $2 AND is_active = TRUE`,
      [originalUrl, userId]
    );
    return result.rows[0] || null;
  },

  /**
   * Get all URLs for a user (for the dashboard).
   * LEFT JOIN with a click count subquery — efficient because it's computed per row.
   */
  async findByUserId(userId) {
    const result = await pool.query(
      `SELECT
         u.id, u.short_code, u.original_url, u.created_at, u.expires_at, u.is_active,
         COUNT(c.id)::int AS click_count
       FROM urls u
       LEFT JOIN clicks c ON c.short_code = u.short_code
       WHERE u.user_id = $1
       GROUP BY u.id
       ORDER BY u.created_at DESC`,
      [userId]
    );
    return result.rows;
  },

  /**
   * Soft delete a URL — set is_active = FALSE instead of deleting the row.
   * Also verifies ownership: user_id must match, so users can't delete others' links.
   */
  async deactivate(shortCode, userId) {
    const result = await pool.query(
      `UPDATE urls SET is_active = FALSE
       WHERE short_code = $1 AND user_id = $2
       RETURNING short_code`,
      [shortCode, userId]
    );
    return result.rows[0] || null; // null means code not found OR not owned by user
  },

  /**
   * Record a click event.
   * Called asynchronously — AFTER the redirect response is sent to the user.
   * This way we never slow down the redirect to log analytics.
   */
  async recordClick({ shortCode, ipHash, userAgent, country, referer }) {
    await pool.query(
      `INSERT INTO clicks (short_code, ip_hash, user_agent, country, referer)
       VALUES ($1, $2, $3, $4, $5)`,
      [shortCode, ipHash || null, userAgent || null, country || null, referer || null]
    );
  },

  /**
   * Get click analytics for a specific short code.
   * Returns total clicks and daily breakdown for the last 30 days.
   */
  async getAnalytics(shortCode, userId) {
    // First verify ownership
    const urlResult = await pool.query(
      'SELECT id FROM urls WHERE short_code = $1 AND user_id = $2',
      [shortCode, userId]
    );
    if (!urlResult.rows[0]) return null;

    // Total clicks
    const totalResult = await pool.query(
      'SELECT COUNT(*)::int AS total FROM clicks WHERE short_code = $1',
      [shortCode]
    );

    // Clicks per day for last 30 days
    // DATE_TRUNC truncates timestamp to day boundary
    const dailyResult = await pool.query(
      `SELECT
         DATE_TRUNC('day', clicked_at)::date AS date,
         COUNT(*)::int AS count
       FROM clicks
       WHERE short_code = $1 AND clicked_at > NOW() - INTERVAL '30 days'
       GROUP BY DATE_TRUNC('day', clicked_at)
       ORDER BY date ASC`,
      [shortCode]
    );

    // Top countries
    const countryResult = await pool.query(
      `SELECT country, COUNT(*)::int AS count
       FROM clicks
       WHERE short_code = $1 AND country IS NOT NULL
       GROUP BY country
       ORDER BY count DESC
       LIMIT 5`,
      [shortCode]
    );

    return {
      total_clicks: totalResult.rows[0].total,
      clicks_by_day: dailyResult.rows,
      top_countries: countryResult.rows,
    };
  },
};

module.exports = UrlModel;
