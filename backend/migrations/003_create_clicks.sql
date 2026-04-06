-- ─── Migration 003: Create Clicks Table ──────────────────────────────────────
--
-- WHY a separate clicks table instead of a `click_count` column on urls?
--   A single counter column requires a row lock on UPDATE.
--   At high traffic, this becomes a serious bottleneck.
--   A separate table lets us INSERT (non-conflicting) and aggregate later.
--   It also stores rich per-click data (country, user agent) for analytics.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS clicks (
    id          BIGSERIAL PRIMARY KEY,

    -- Link back to the urls table via short_code
    -- ON DELETE CASCADE: if the URL is hard-deleted, clean up its click history
    short_code  VARCHAR(10) NOT NULL REFERENCES urls(short_code) ON DELETE CASCADE,

    clicked_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- WHY hash the IP instead of storing it raw?
    --   GDPR and privacy laws consider IP addresses PII (Personal Identifiable Info).
    --   We hash it with SHA-256 so we can detect unique visitors without storing real IPs.
    --   The hash is one-way — we can't reverse it to get the original IP.
    ip_hash     VARCHAR(64),

    -- ISO 3166-1 alpha-2 country code, e.g., "US", "IN", "GB"
    -- Derived from IP geolocation (can use a free library like 'geoip-lite')
    country     VARCHAR(2),

    -- The full browser user-agent string
    -- Useful for device/browser analytics
    user_agent  TEXT,

    -- The page that linked to the short URL (e.g., "https://twitter.com/...")
    referer     TEXT
);

-- ── Composite Index ─────────────────────────────────────────────────────────
-- Used for: SELECT COUNT(*) FROM clicks WHERE short_code = ? AND clicked_at > ?
-- This is the query powering the "clicks in last 7 days" chart.
--
-- WHY composite (two columns) instead of two separate indexes?
--   Postgres can use one composite index for BOTH the equality filter (short_code)
--   AND the range filter (clicked_at > ?). Two separate indexes would require
--   Postgres to merge results, which is less efficient.
--
-- WHY short_code first, clicked_at second?
--   Always put the EQUALITY column first, RANGE column second.
--   This way Postgres jumps directly to all rows for a given short_code,
--   then scans within that group for the date range.
CREATE INDEX IF NOT EXISTS idx_clicks_code_time
    ON clicks(short_code, clicked_at DESC);
