-- ─── Migration 004: Fix short_code column size ────────────────────────────────
-- The original VARCHAR(10) caused a truncation error (PostgreSQL 22001)
-- because the temporary placeholder '__pending__' (11 chars) exceeded the limit.
-- Fix: widen to VARCHAR(20) which fits all real codes AND the __tmp__ placeholder.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE urls ALTER COLUMN short_code TYPE VARCHAR(20);
