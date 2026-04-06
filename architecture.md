# 🏗️ System Architecture — Scalable URL Shortener

> **How to use this doc:**
> Read each section once to *understand* it. Then re-read the "🎤 Say This In An Interview" boxes
> and practice saying them out loud. That's how you turn concepts into answers.

---

## The Big Picture — What Are We Actually Building?

Imagine you paste `https://www.amazon.com/some/very/long/product/url?ref=123` into our app.
We give you back `sho.rt/aB3k`. Anyone who clicks `sho.rt/aB3k` gets sent to Amazon instantly.

That's it. Simple idea. Hard to scale.

Why is it hard? Because:
- **Millions of people** might click the same short link at the same time
- The redirect must happen in **under 50 milliseconds** (humans notice anything slower)
- We need to **count every click** for analytics without slowing the redirect down
- Two people might try to create the **same custom short-code** at the same microsecond

These four challenges map exactly to the four pillars of this system:

```
┌─────────────────────────────────────────────────────────────────────┐
│                     THE 4 PILLARS                                    │
│                                                                      │
│  1. CONCURRENCY  → What happens when 10,000 people click at once?   │
│  2. CACHING      → How do we answer in <5ms without hitting the DB? │
│  3. PERSISTENCE  → How do we store URLs reliably and find them fast? │
│  4. API DESIGN   → How do clients talk to us? What are the rules?   │
└─────────────────────────────────────────────────────────────────────┘
```

---

## System Diagram

```
                    ┌────────────────────────────────┐
                    │        BROWSER (React App)      │
                    │   Dashboard + Login + Shorten   │
                    └──────────────┬─────────────────┘
                                   │  HTTPS request
                    ┌──────────────▼─────────────────┐
                    │          NGINX                  │
                    │  (Traffic Cop + SSL Terminator) │
                    └───────┬──────────────┬──────────┘
                            │              │
             ┌──────────────▼──┐      ┌───▼──────────────┐
             │  Node.js App #1  │ ...  │  Node.js App #N  │
             │  (Express API)   │      │  (Express API)   │
             └──────┬───────────┘      └───────┬──────────┘
                    │                          │
        ┌───────────▼──────────────────────────▼──────────┐
        │                    REDIS                         │
        │   ① Cache  (short_code → original_url)          │
        │   ② Rate Limiter  (IP → request count)          │
        │   ③ Event Queue  (click events stream)          │
        └───────────────────────┬──────────────────────────┘
                                │
        ┌───────────────────────▼──────────────────────────┐
        │                  POSTGRESQL                       │
        │   urls table      → permanent URL storage        │
        │   users table     → accounts + auth              │
        │   clicks table    → analytics data               │
        └───────────────────────┬──────────────────────────┘
                                │
        ┌───────────────────────▼──────────────────────────┐
        │            ANALYTICS BACKGROUND WORKER           │
        │   Reads Redis queue → batch-writes to Postgres   │
        └──────────────────────────────────────────────────┘
```

---

## Pillar 1: CONCURRENCY 🔄

### The Problem in Plain English

Concurrency means: **Many things happening at the same time.**

Example: A famous YouTuber posts your short link. 50,000 people click it within 5 seconds.
Or: Two users try to register the custom code `"sale"` at the exact same millisecond.

If your system isn't designed for concurrency, it breaks.

---

### Challenge A: Thundering Herd (50,000 simultaneous clicks)

**What happens without planning:**
- 50,000 requests all miss the cache (it just started)
- All 50,000 hit Postgres at the same time
- Postgres dies

**How we solve it:**
Node.js handles this naturally because of the **Event Loop**.

```
Traditional Servers (PHP/Java):
  Request 1 → Thread 1 (uses 2MB RAM)
  Request 2 → Thread 2 (uses 2MB RAM)
  ...
  Request 10,000 → Thread 10,000 (20GB RAM! Server crashes)

Node.js:
  All 50,000 requests → ONE thread
  Node doesn't wait for DB. It registers a callback and moves on.
  When DB responds → callback runs.
  
  Memory: constant, predictable, doesn't scale with connections.
```

> 🎤 **Say This In An Interview:**
> "Node.js uses a single-threaded event loop backed by libuv's thread pool for I/O operations.
> It handles concurrency not by spawning threads, but through non-blocking callbacks.
> This makes it ideal for I/O-heavy workloads like ours — we spend most time waiting on Redis
> and Postgres, not doing CPU work."

---

### Challenge B: The Duplicate Short-Code Race Condition

**Scenario:** Two servers receive requests for custom code `"flash-sale"` at the same millisecond.
- Server 1 checks DB: code not taken ✓
- Server 2 checks DB: code not taken ✓ (both checked before either wrote)
- Server 1 inserts `"flash-sale"` → success
- Server 2 inserts `"flash-sale"` → **BOOM. Duplicate.**

**Our 3-Layer Defense:**

```
Layer 1 (By Design):
  Regular short codes are Base62(auto_increment_id).
  Two inserts → two different IDs → two different codes.
  Race condition doesn't exist for generated codes.

Layer 2 (Database Level):
  UNIQUE INDEX on short_code column.
  Postgres rejects the second insert with a UNIQUE VIOLATION error.
  We catch that error and return "code taken" to the user.

Layer 3 (Application Level):
  We use INSERT ... ON CONFLICT DO NOTHING
  Instead of crashing, we gracefully handle the conflict.
```

> 🎤 **Say This In An Interview:**
> "We eliminate the race condition by design. Auto-generated codes derive from the database's
> auto-increment sequence, which is atomic — two concurrent inserts always get different IDs.
> For custom codes, we rely on Postgres's UNIQUE constraint as the final arbiter.
> The application catches the conflict error and returns a 409 to the client."

---

### Challenge C: Analytics Without Blocking Redirects

**Wrong approach:** Update `click_count = click_count + 1` in Postgres on every single click.
- A viral URL at 10,000 clicks/second = 10,000 DB writes/second
- Postgres maxes at ~5,000 writes/second for simple queries
- Your redirect slows to a crawl trying to update analytics

**Right approach (Asynchronous Write-Behind):**

```
User clicks → Redirect happens in <5ms
              ↓ (after response is SENT, runs asynchronously)
              Push {short_code, timestamp, ip} to Redis Stream

Every 60 seconds, Background Worker:
  1. Read all events from Redis Stream
  2. Group by short_code → count them
  3. Single UPDATE per URL: click_count += N
  
10,000 clicks/second = one batch DB write per minute. DB barely notices.
```

> 🎤 **Say This In An Interview:**
> "We decouple the user-facing redirect from analytics writes using the Write-Behind pattern.
> Click events go to a Redis Stream immediately after the response is sent.
> A background worker batches these into bulk Postgres updates every 60 seconds.
> This trades near-real-time analytics for massive write throughput."

---

## Pillar 2: CACHING ⚡

### The Problem in Plain English

Postgres lives on disk. Reading from disk is like going to a library.
Redis lives in RAM. Reading from RAM is like remembering something.

RAM reads: ~100 nanoseconds
Disk reads: ~1 millisecond = **10,000× slower**

For a URL shortener, the single most frequent operation is:
`GET /:code` → look up original URL → redirect.

If every redirect hits Postgres, we're going to the library 10,000 times a second.
Redis lets us answer from memory for 99% of requests.

---

### The Cache-Aside Pattern (Step by Step)

```
User hits http://sho.rt/aB3k

Step 1: Check Redis
        key = "cache:aB3k"
        
        ✅ CACHE HIT (key exists):
           Return the stored URL immediately. Done. ~0.5ms total.
        
        ❌ CACHE MISS (key doesn't exist):
           Continue to Step 2.

Step 2: Query Postgres
        SELECT original_url FROM urls WHERE short_code = 'aB3k'
        
        ❌ NOT FOUND: Cache the miss! Set "cache:aB3k" = "NOT_FOUND" for 30s
           Return 404.
        
        ✅ FOUND: Continue to Step 3.

Step 3: Populate the cache
        SET "cache:aB3k" = "https://amazon.com/..." EX 3600  (1 hour TTL)
        
Step 4: Return the URL, send 302 redirect. ~15ms total (only on first miss).
```

**Why TTL (Time-To-Live)?**

If a URL is updated or deleted, the cache would serve the old URL forever without TTL.
TTL = automatic expiry. After 1 hour, the cached value is gone. Next request re-fetches from Postgres.

When a URL is explicitly deleted, we also manually run `DEL cache:aB3k` in Redis.
This is called **Cache Invalidation** — one of the hardest problems in CS.

> 🎤 **Say This In An Interview:**
> "We use the Cache-Aside pattern. On a read, we check Redis first. On a miss, we fetch from
> Postgres and populate Redis with a TTL. On a URL update, we explicitly delete the cache key
> so the next request gets fresh data. We also do negative caching — we cache 404s for 30 seconds
> to prevent repeated DB hits for non-existent codes."

---

### Cache Eviction: What Happens When Redis Is Full?

Redis has a memory limit (e.g., 256MB). When it fills up, it must evict (delete) some keys.

**Policy we use: `allkeys-lru`** (Least Recently Used)

```
Imagine 3 cached URLs:
  "abc" → last accessed 2 hours ago
  "xyz" → last accessed 30 seconds ago
  "qrs" → last accessed 1 minute ago

Redis is full. We cache a new URL. Something must go.
LRU evicts "abc" — the least recently used.

This is perfect for us: hot/popular URLs stay cached.
Cold/old URLs get evicted and re-fetched from DB if needed.
```

> 🎤 **Say This In An Interview:**
> "We configure Redis with `allkeys-lru` eviction policy. When memory is full, Redis evicts
> the least recently used keys. For a URL shortener, this naturally keeps hot URLs cached
> and lets cold ones expire, which is exactly the behavior we want."

---

## Pillar 3: PERSISTENCE 🗄️

### The Problem in Plain English

**Persistence** means: data survives even if the server crashes, restarts, or there's a power cut.

Redis is fast but it's in RAM — if it restarts, everything's gone.
PostgreSQL writes to disk — data survives forever.

That's why we have both. Redis = speed. Postgres = truth.

---

### Why PostgreSQL?

We need:
- **ACID** guarantees (data never corrupts, even during crashes)
- **Unique constraints** (enforce business rules at the DB level)
- **Indexed queries** (find a short_code in milliseconds even with 100 million rows)
- **Joins** (link URLs to users to clicks for analytics)

**ACID in plain English:**

```
A — Atomicity:   "All or nothing." 
    When you insert a URL, either every part succeeds or 
    nothing happens. No half-inserted data.

C — Consistency: "Rules are always enforced."
    The UNIQUE constraint on short_code is ALWAYS enforced,
    even during 10,000 concurrent inserts.

I — Isolation:   "Transactions don't interfere."
    Two people inserting simultaneously don't see each other's
    half-finished writes.

D — Durability:  "Once saved, always saved."
    After INSERT returns success, data is on disk.
    Even a power cut won't lose it.
```

> 🎤 **Say This In An Interview:**
> "We chose Postgres because we need ACID guarantees. The Durability property is critical —
> we can't afford to lose a URL mapping after telling the user it was saved. Atomicity
> and Isolation handle our concurrency challenges at the data layer."

---

### How Indexing Works (B-Trees Explained Simply)

Without an index, finding `short_code = 'aB3k'` in 10 million rows means scanning all 10 million rows.

With a **B-Tree Index**, Postgres builds a sorted tree structure:

```
                    [mN4x]
                   /       \
           [eK2p]           [tQ7z]
           /    \           /    \
       [aB3k] [hJ5m]   [qR8w] [xV1n]

Finding 'aB3k':
  Is aB3k < mN4x? Yes → go left
  Is aB3k < eK2p? Yes → go left  
  Found aB3k! ✓

10 million rows → about 23 comparisons (log₂ of 10 million)
vs sequential scan → up to 10,000,000 comparisons
```

**Indexes we create and why:**

| Index | On Column | Why |
|-------|-----------|-----|
| Primary Key (auto) | `id` | Auto-created; used for Base62 encoding |
| UNIQUE INDEX | `short_code` | The redirect hot path — every GET hits this |
| INDEX | `original_url` | Deduplication check on every POST |
| INDEX | `users.api_key` | Auth check on every protected request |
| COMPOSITE INDEX | `(short_code, clicked_at)` | Analytics: "clicks on URL X in last 7 days" |

> 🎤 **Say This In An Interview:**
> "A primary key search is faster because Postgres automatically creates a B-Tree index on it.
> B-Trees maintain sorted data, allowing O(log n) lookups instead of O(n) sequential scans.
> With 1 million rows, a B-Tree finds a record in ~20 comparisons. A full table scan reads
> all 1 million rows."

---

### The Schema (With Reasoning)

```sql
-- USERS (with auth)
CREATE TABLE users (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email      VARCHAR(255) UNIQUE NOT NULL,
    password_hash  VARCHAR(255) NOT NULL,        -- bcrypt hash, never plaintext
    api_key    VARCHAR(64) UNIQUE,               -- for programmatic access
    plan       VARCHAR(20) DEFAULT 'free',
    created_at TIMESTAMP DEFAULT NOW()
);

-- URLS
CREATE TABLE urls (
    id           BIGSERIAL PRIMARY KEY,          -- the number we Base62-encode
    short_code   VARCHAR(10) NOT NULL UNIQUE,    -- "aB3k"
    original_url TEXT NOT NULL,
    user_id      UUID REFERENCES users(id),       -- NULL = anonymous
    expires_at   TIMESTAMP,                       -- NULL = never
    created_at   TIMESTAMP DEFAULT NOW()
);

-- CLICKS (analytics)
CREATE TABLE clicks (
    id          BIGSERIAL PRIMARY KEY,
    short_code  VARCHAR(10) REFERENCES urls(short_code),
    clicked_at  TIMESTAMP DEFAULT NOW(),
    ip_hash     VARCHAR(64),                     -- hashed for GDPR privacy
    country     VARCHAR(2)
);
```

---

### Why BIGSERIAL for ID?

`BIGSERIAL` auto-increments from 1 to 9,223,372,036,854,775,807 (9 quintillion).
We Base62-encode this number to get the short code.

```
ID 1       → Base62 → "1"      (1 character)
ID 3,521   → Base62 → "ZP"     (2 characters)
ID 238,328 → Base62 → "ZZZ"    (3 characters)
ID 62^7    → Base62 → "aaaaaaa" (7 characters = 3.5 Trillion unique codes)
```

> 🎤 **Say This In An Interview:**
> "The short code is derived from the database's auto-increment ID using Base62 encoding.
> This means uniqueness is guaranteed without any lookup or collision handling — the DB's
> sequence is atomic and always produces a new, unique number."

---

## Pillar 4: API DESIGN 🌐

### The Problem in Plain English

An API is a contract. You tell the world: "Send me *this*, I'll give you *that*."

A well-designed API is:
- **Predictable** — same structure every time, even for errors
- **Versioned** — old clients still work when you update the API
- **Documented** — other developers can use it without asking you
- **Secure** — authenticated routes can't be called without credentials
- **Rate Limited** — one bad actor can't bring down the whole service

---

### The Endpoints

```
PUBLIC (no auth needed):
  POST /api/v1/shorten            → Create a short URL
  GET  /:code                     → Redirect to original URL
  GET  /api/v1/health             → Is the server alive?

AUTH REQUIRED:
  GET  /api/v1/me/urls            → List my shortened URLs
  GET  /api/v1/me/urls/:code/analytics → Click data for my URL
  DELETE /api/v1/me/urls/:code    → Delete my short URL
  POST /api/v1/auth/register      → Create account
  POST /api/v1/auth/login         → Get JWT token
```

**Why `/api/v1/` prefix?**

When you inevitably need to change the API (rename a field, restructure a response),
you release `/api/v2/` and run both versions simultaneously.
Old clients keep using `/api/v1/` while new clients use `/api/v2/`.
No breaking changes. No angry users.

---

### Request & Response Contracts

**POST /api/v1/shorten**
```json
Request:
{
  "original_url": "https://amazon.com/...",
  "custom_code": "flash-sale",         ← optional
  "expires_in_days": 30                ← optional
}

Response 201 Created:
{
  "success": true,
  "data": {
    "short_code": "flash-sale",
    "short_url": "https://sho.rt/flash-sale",
    "original_url": "https://amazon.com/...",
    "expires_at": "2026-04-30T00:00:00Z"
  }
}

Response 400 Bad Request (invalid URL):
{
  "success": false,
  "error": {
    "code": "INVALID_URL",
    "message": "The provided URL is not valid."
  }
}

Response 409 Conflict (code taken):
{
  "success": false,
  "error": {
    "code": "CODE_TAKEN",
    "message": "The code 'flash-sale' is already in use."
  }
}
```

**Notice:** Every response has the same shape (`success`, `data`/`error`). Clients can always check `success` first without parsing different formats for different endpoints.

---

### Authentication Design (JWT)

```
REGISTRATION / LOGIN FLOW:

  1. POST /api/v1/auth/register { email, password }
     → Store bcrypt(password) in users table (never plaintext)
     → Return JWT token

  2. Client stores JWT in memory (not localStorage — XSS risk)
  
  3. Every protected request:
     Header: Authorization: Bearer eyJhbG...
     
  4. Server middleware:
     - Decode JWT (no DB lookup needed!)
     - Verify signature with SECRET_KEY
     - Extract user_id from payload
     - Attach to request object

JWT PAYLOAD:
{
  "sub": "user_uuid",        ← user's ID
  "email": "user@test.com",
  "plan": "free",
  "iat": 1711843200,         ← issued at (unix timestamp)
  "exp": 1712448000          ← expires at (7 days from now)
}
```

**Why JWT and not sessions?**

Sessions store state on the server (in memory or DB). Multiple servers need to share session state — requires sticky sessions or a session store.

JWT is **stateless** — the token itself contains the user info. Any server can verify it without talking to a database.

> 🎤 **Say This In An Interview:**
> "We use JWT for authentication because it's stateless. The server signs the token with a secret
> key, and any server instance can verify the signature independently without a DB lookup.
> This is critical for horizontal scaling — any app server can handle any request."

---

### Rate Limiting Design

**Why rate limit?**
- One user spamming POST /shorten could create millions of garbage rows in your DB
- DDoS attacks try to overwhelm your API with fake traffic
- Fair usage: free users get less than paid users

**How it works (Sliding Window Algorithm):**

```
Redis Sorted Set key:  "rate:{ip_address}"
Member:                unique request ID
Score (sort key):      current timestamp in milliseconds

On every request:
  1. Remove all members with score < (now - 60 seconds)  ← outside the window
  2. Add current request with score = now
  3. Count members in the set  ← requests in last 60 seconds
  4. If count > limit → reject with 429
  5. Set TTL on the key to auto-cleanup

Why sorted set and not a simple counter?
  Simple counter resets at minute boundaries.
  At 00:59 → send 100 requests (limit)
  At 01:00 → counter resets, send 100 more
  = 200 requests in 2 seconds. Limit bypassed!
  
  Sorted set tracks EXACT timestamps.
  Window is always the last 60 seconds, not the current minute.
```

> 🎤 **Say This In An Interview:**
> "We implement rate limiting in Redis using a sorted set where the score is the request timestamp.
> We use a sliding window: on each request, we remove entries older than 60 seconds, add the
> current request, and count. This gives us an accurate rolling window unlike fixed-window counters
> which can be gamed at boundary edges. Redis is used because it's shared across all server
> instances — a Redis-only solution would reset per server."

---

## Interview Quick-Fire Answers

| Question | Answer |
|----------|--------|
| **Why 302 not 301?** | 301 is permanent — browser caches it and never hits our server again. 302 is temporary — browser always checks us, so we can count clicks. |
| **What if Redis goes down?** | We fall back to Postgres. Performance degrades (adds ~10ms per redirect) but no data is lost. Redis is a speed layer, not the source of truth. |
| **How do you handle a viral URL?** | Redis caches it, absorbing the load. If cache is cold and 50,000 requests hit simultaneously, we use a mutex/lock to let only one request fetch from Postgres; others wait and then get the cached result. |
| **How do you scale the DB?** | Add Postgres read replicas. All GET queries go to replicas, writes go to primary. |
| **How does the short_code guarantee uniqueness?** | It's derived from BIGSERIAL — Postgres's atomic sequence counter. Two inserts always get different numbers. |
| **What's your disaster recovery?** | Postgres has WAL (Write-Ahead Log) — every change is logged before being applied. Point-in-time recovery is possible. Redis data is a cache, so loss is acceptable (slight performance hit). |
