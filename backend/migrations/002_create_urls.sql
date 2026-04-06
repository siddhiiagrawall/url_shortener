-- ─── Migration 002: Create URLs Table ────────────────────────────────────────
--
-- This is the CORE table. Every redirect query hits the short_code index.
-- Performance here is critical — it must be sub-millisecond.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS urls (
    -- BIGSERIAL: auto-incrementing 64-bit integer (up to 9.2 quintillion)
    -- WHY BIGSERIAL and not UUID?
    --   We Base62-encode this integer to create the short code.
    --   We need a sequential number, not a random ID.
    --   BIGSERIAL goes to 9.2 quintillion → Base62 gives us 3.5 trillion codes at 7 chars.
    id           BIGSERIAL PRIMARY KEY,

    -- The short code, e.g., "aB3k"
    -- Derived from Base62(id) — we update this after getting the id back from INSERT
    -- VARCHAR(10): 7-char codes + room for custom codes up to 10 chars
    short_code   VARCHAR(10) NOT NULL,

    -- TEXT: no length limit — original URLs can be very long
    original_url TEXT NOT NULL,

    -- Foreign key to users. NULL = anonymous link (no account needed to shorten)
    -- ON DELETE SET NULL: if user deletes account, the link still works (just anonymous)
    user_id      UUID REFERENCES users(id) ON DELETE SET NULL,

    -- Soft delete flag: instead of deleting rows, we set this to FALSE
    -- WHY soft delete? Preserves history, keeps foreign key references intact, reversible
    is_active    BOOLEAN DEFAULT TRUE,

    -- NULL = never expires. A future timestamp = expires at that time.
    expires_at   TIMESTAMP WITH TIME ZONE,

    created_at   TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ── THE MOST IMPORTANT INDEX ────────────────────────────────────────────────
-- Every single redirect query is: SELECT * FROM urls WHERE short_code = ?
-- This index makes that lookup O(log n) instead of O(n).
-- At 10 million URLs: with index = ~23 comparisons. Without = 10,000,000 reads.
CREATE UNIQUE INDEX IF NOT EXISTS idx_urls_short_code   ON urls(short_code);

-- For deduplication: "Has this user already shortened this exact URL?"
-- Used in: SELECT short_code FROM urls WHERE original_url = ? AND user_id = ?
CREATE INDEX IF NOT EXISTS idx_urls_original_url ON urls(original_url);

-- For dashboard: "Show all URLs for user X"
CREATE INDEX IF NOT EXISTS idx_urls_user_id      ON urls(user_id);

-- Partial index: only index active URLs — makes the hot path even faster
-- WHY partial? We almost never query inactive URLs. Don't waste index space on them.
CREATE INDEX IF NOT EXISTS idx_urls_active ON urls(short_code) WHERE is_active = TRUE;
