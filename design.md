# 🎨 API & Database Design — Scalable URL Shortener

> This document is the **"what we're building"** companion to `architecture.md` (the "why").
> Every design decision here has a reason — and the reason is in `architecture.md`.

---

## Project Folder Structure

```
url_shortener/
│
├── backend/                         ← Node.js + Express API
│   ├── src/
│   │   ├── routes/                  ← HTTP layer: just maps URL paths to controllers
│   │   │   ├── auth.routes.js       
│   │   │   ├── shorten.routes.js
│   │   │   └── redirect.routes.js
│   │   │
│   │   ├── controllers/             ← Orchestration: calls services, formats responses
│   │   │   ├── auth.controller.js
│   │   │   ├── shorten.controller.js
│   │   │   └── redirect.controller.js
│   │   │
│   │   ├── services/                ← Business logic: all real decisions happen here
│   │   │   ├── auth.service.js      (password hashing, JWT creation)
│   │   │   ├── url.service.js       (shorten, deduplicate, generate code)
│   │   │   ├── cache.service.js     (Redis read/write with TTL)
│   │   │   └── rateLimit.service.js (sliding window logic)
│   │   │
│   │   ├── models/                  ← Data access: raw SQL queries only
│   │   │   ├── user.model.js
│   │   │   └── url.model.js
│   │   │
│   │   ├── middleware/              ← Express middleware (runs before controllers)
│   │   │   ├── authenticate.js      (verify JWT token)
│   │   │   ├── rateLimiter.js
│   │   │   └── errorHandler.js      (global error formatter)
│   │   │
│   │   ├── workers/                 ← Background processes
│   │   │   └── analyticsWorker.js
│   │   │
│   │   ├── utils/                   ← Pure helper functions, no side effects
│   │   │   ├── base62.js
│   │   │   └── validate.js
│   │   │
│   │   ├── config/                  ← DB + Redis connection setup
│   │   │   ├── db.js
│   │   │   └── redis.js
│   │   │
│   │   └── app.js                   ← Boots Express, registers all routes
│   │
│   ├── tests/
│   │   ├── unit/                    ← Test individual functions (base62, validate)
│   │   └── integration/             ← Test full request-response cycles
│   │
│   ├── .env.example
│   ├── Dockerfile
│   └── package.json
│
├── frontend/                        ← React (Vite) app
│   ├── src/
│   │   ├── pages/
│   │   │   ├── Home.jsx             (shorten a URL, landing page)
│   │   │   ├── Dashboard.jsx        (user's links list + stats)
│   │   │   ├── Login.jsx
│   │   │   └── Register.jsx
│   │   ├── components/
│   │   ├── api/                     ← Axios calls to backend
│   │   └── main.jsx
│   └── package.json
│
├── docker-compose.yml               ← One command starts everything
├── architecture.md
└── design.md
```

---

## Why Layered Architecture?

Think of it like a restaurant:

```
Routes      = The front door. Decides WHERE to send you.
Controller  = The waiter. Takes your order, brings it back.
Service     = The kitchen. Actually makes the food (business logic).
Model       = The pantry. Just stores and retrieves ingredients (DB access).
```

**Benefits:**
- You can swap Postgres for MySQL by only changing `models/` — services don't care
- Unit testing a `service` just requires mocking the `model` below it
- No service knows about HTTP, no model knows about business rules

> 🎤 **Say This In An Interview:**
> "We use a layered architecture — routes, controllers, services, models — based on the
> single responsibility principle. This gives us clean separation of concerns, testability,
> and the ability to swap infrastructure (like the database) without touching business logic."

---

## Database Schema

### Full Schema with SQL

```sql
-- ─────────────────────────────────────────────
-- USERS TABLE
-- ─────────────────────────────────────────────
CREATE TABLE users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email         VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,      -- bcrypt, NEVER store plaintext
    api_key       VARCHAR(64) UNIQUE,
    plan          VARCHAR(20) DEFAULT 'free' CHECK (plan IN ('free','pro','enterprise')),
    created_at    TIMESTAMP DEFAULT NOW(),
    last_login_at TIMESTAMP
);

CREATE UNIQUE INDEX idx_users_email   ON users(email);
CREATE UNIQUE INDEX idx_users_api_key ON users(api_key);


-- ─────────────────────────────────────────────
-- URLS TABLE
-- ─────────────────────────────────────────────
CREATE TABLE urls (
    id           BIGSERIAL PRIMARY KEY,
    short_code   VARCHAR(10) NOT NULL,
    original_url TEXT NOT NULL,
    user_id      UUID REFERENCES users(id) ON DELETE SET NULL,
    is_active    BOOLEAN DEFAULT TRUE,
    expires_at   TIMESTAMP,                  -- NULL = never expires
    created_at   TIMESTAMP DEFAULT NOW()
);

-- THE most important index — every redirect hits this
CREATE UNIQUE INDEX idx_urls_short_code   ON urls(short_code);

-- For deduplication: "has this URL been shortened before by this user?"
CREATE INDEX idx_urls_original_url ON urls(original_url);
CREATE INDEX idx_urls_user_id      ON urls(user_id);


-- ─────────────────────────────────────────────
-- CLICKS TABLE (raw analytics events)
-- ─────────────────────────────────────────────
CREATE TABLE clicks (
    id          BIGSERIAL PRIMARY KEY,
    short_code  VARCHAR(10) NOT NULL REFERENCES urls(short_code),
    clicked_at  TIMESTAMP DEFAULT NOW(),
    ip_hash     VARCHAR(64),                 -- SHA-256 of IP (GDPR compliant)
    user_agent  TEXT,
    country     VARCHAR(2),
    referer     TEXT
);

-- For dashboard query: "clicks on code X in the last 7 days"
CREATE INDEX idx_clicks_code_time ON clicks(short_code, clicked_at DESC);
```

---

### Schema Design Decisions (Interview Flashcards)

| Decision | Why |
|----------|-----|
| `UUID` for user ID | UUIDs don't leak how many users you have (unlike INT 1, 2, 3...) |
| `BIGSERIAL` for url ID | We Base62-encode this number. Needs to be a large integer sequence. |
| `password_hash` not `password` | Never store plaintext. bcrypt's output goes here. |
| `ON DELETE SET NULL` on user_id | If a user deletes their account, the short URL still works (it's just anonymous now) |
| `is_active` boolean | Soft delete — we don't actually DELETE rows, we just flag them inactive. Safer + preserves history. |
| `ip_hash` not `ip` | Store SHA-256(IP + salt) for GDPR compliance. Can detect unique visitors without storing PII. |

---

## Base62 Encoding — The Core Algorithm

```javascript
// utils/base62.js

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
//                ←── 10 ──→ ←────────────── 26 ────────────→ ←────────── 26 ──────────→
//                                    total: 62 characters

function encode(id) {
  if (id === 0) return ALPHABET[0];
  
  let result = '';
  let num = id;
  
  while (num > 0) {
    result = ALPHABET[num % 62] + result;
    num = Math.floor(num / 62);
  }
  
  return result;
}

function decode(code) {
  let result = 0;
  for (const char of code) {
    result = result * 62 + ALPHABET.indexOf(char);
  }
  return result;
}

// Examples:
// encode(1)       = "1"
// encode(125)     = "21"
// encode(3844)    = "100"
// encode(62^7)    = "aaaaaaa"  ← 7 chars = 3.5 Trillion combinations
```

**Why not just use UUID?**
`550e8400-e29b-41d4-a716-446655440000` is 36 characters. Nobody wants that in a URL.
Base62 of `125` is `"21"` — clean, short, human-readable.

---

## The Write Path: Shortening a URL

```
POST /api/v1/shorten
{
  "original_url": "https://amazon.com/...",
  "custom_code": null  ← auto-generate
}

Step 1: VALIDATE (validate.js)
   - Is it a valid URL format? (uses the 'validator' npm package)
   - Is it http:// or https://?
   - Does it have a real TLD? (not "http://test")

Step 2: DEDUPLICATE (url.service.js)
   - Has this user already shortened this exact URL?
   - SELECT short_code FROM urls WHERE original_url = ? AND user_id = ?
   - If yes → return existing short_code (don't create duplicate)

Step 3: INSERT to Postgres (url.model.js)
   - INSERT INTO urls (original_url, user_id) VALUES (?, ?)
   - RETURNING id  ← get the auto-generated BIGSERIAL id

Step 4: GENERATE CODE (base62.js)
   - short_code = encode(id)  ← e.g., id 3521 → "ZP"
   - UPDATE urls SET short_code = ? WHERE id = ?

Step 5: CACHE (cache.service.js)
   - SET "cache:ZP" = "https://amazon.com/..." EX 3600

Step 6: RESPOND
   → 201 { short_url: "https://sho.rt/ZP" }
```

**Why insert first, then generate the code?**

We need the DB-assigned ID to generate the code. So we must insert first to get the ID back.
Some implementations use two DB round-trips (insert then update). A cleaner approach uses a
separate `id_sequence` table to pre-fetch IDs, but we'll keep it simple for now.

---

## The Read Path: Following a Short Link

```
GET /aB3k (browser clicks link)

Step 1: RATE CHECK (rateLimiter.js middleware)
   - 100 redirects/minute per IP for anonymous users
   - If exceeded → 429 Too Many Requests

Step 2: CACHE LOOKUP (cache.service.js)
   - redis.get("cache:aB3k")
   - HIT  → jump to Step 5 (skips DB entirely! ~0.5ms total)
   - MISS → continue

Step 3: DB LOOKUP (url.model.js)
   - SELECT original_url, expires_at FROM urls
     WHERE short_code = 'aB3k' AND is_active = TRUE
   - NOT FOUND → 404

Step 4: POPULATE CACHE
   - redis.set("cache:aB3k", originalUrl, "EX", 3600)

Step 5: LOG CLICK (async — does NOT block the response)
   - redis.xadd("stream:clicks", "*", "short_code", "aB3k", "ip_hash", hash, ...)

Step 6: REDIRECT
   → HTTP 302
     Location: https://amazon.com/...
```

Notice: Step 5 (analytics) happens **asynchronously after Step 6** (the redirect).
The user gets their redirect in ~1ms. The analytics event is logged in the background.

---

## Authentication Flow (JWT)

```
REGISTER:
  Client: POST /api/v1/auth/register { email, password }
  Server:
    1. Check email not already in DB
    2. bcrypt.hash(password, 12)  ← 12 rounds = slow enough to prevent brute force
    3. INSERT INTO users (email, password_hash)
    4. Create JWT: sign({ sub: userId, email, plan }, SECRET, { expiresIn: '7d' })
    5. Return: { token: "eyJhbG..." }

LOGIN:
  Client: POST /api/v1/auth/login { email, password }
  Server:
    1. SELECT password_hash FROM users WHERE email = ?
    2. bcrypt.compare(password, password_hash)  ← timing-safe comparison
    3. If match → return new JWT
    4. If no match → 401 Unauthorized

PROTECTED REQUEST:
  Client sends: Authorization: Bearer eyJhbG...
  
  middleware/authenticate.js:
    1. Extract token from header
    2. jwt.verify(token, SECRET)  ← verify signature, check expiry
    3. Attach decoded payload to req.user
    4. Call next() → request proceeds to controller
    
    If invalid → 401 immediately
```

**JWT Structure:**
```
Header:  { alg: "HS256", typ: "JWT" }
Payload: { sub: "uuid", email: "user@...", plan: "free", iat: 1711843200, exp: 1712448000 }
Signature: HMAC-SHA256(base64(header) + "." + base64(payload), SECRET_KEY)
```

The signature is what makes JWTs tamper-proof. If anyone changes the payload,
the signature won't match when we verify it.

---

## Error Handling

**Every error follows the same structure:**

```json
{
  "success": false,
  "error": {
    "code": "MACHINE_READABLE",
    "message": "Human-readable explanation",
    "details": {}
  }
}
```

**Error Code Registry:**

| HTTP Status | Code | When |
|-------------|------|------|
| 400 | `INVALID_URL` | URL format validation failed |
| 400 | `MISSING_FIELDS` | Required fields not provided |
| 401 | `UNAUTHORIZED` | No JWT token / invalid token |
| 403 | `FORBIDDEN` | Valid token but wrong user (trying to delete someone else's URL) |
| 404 | `NOT_FOUND` | Short code doesn't exist or is inactive |
| 409 | `CODE_TAKEN` | Custom code already in use |
| 410 | `LINK_EXPIRED` | Short code existed but is past its expiry date |
| 429 | `RATE_LIMITED` | Too many requests |
| 500 | `INTERNAL_ERROR` | Something unexpected went wrong |

**Global error handler (middleware/errorHandler.js):**
```javascript
// All errors thrown anywhere in the app land here
app.use((err, req, res, next) => {
  const status = err.statusCode || 500;
  const code   = err.code || 'INTERNAL_ERROR';
  const msg    = err.message || 'Something went wrong';
  
  // Log to monitoring (never expose stack traces to clients)
  logger.error({ err, requestId: req.id });
  
  res.status(status).json({
    success: false,
    error: { code, message: msg }
  });
});
```

---

## Environment Configuration

```bash
# backend/.env.example

# ── Server ────────────────────────────────
PORT=3000
NODE_ENV=development
BASE_URL=http://localhost:3000
CORS_ORIGIN=http://localhost:5173        # Vite dev server

# ── PostgreSQL ─────────────────────────────
DATABASE_URL=postgresql://dev:devpass@localhost:5432/urlshortener
DB_POOL_MIN=2
DB_POOL_MAX=10

# ── Redis ──────────────────────────────────
REDIS_URL=redis://localhost:6379
CACHE_TTL_SECONDS=3600

# ── Auth ───────────────────────────────────
JWT_SECRET=change-this-to-a-long-random-string
JWT_EXPIRES_IN=7d
BCRYPT_ROUNDS=12

# ── Rate Limiting ──────────────────────────
RATE_LIMIT_WINDOW_SECONDS=60
RATE_LIMIT_ANON_MAX=10            # shorten requests per minute
RATE_LIMIT_FREE_MAX=50
RATE_LIMIT_PRO_MAX=500

# ── Analytics Worker ───────────────────────
ANALYTICS_FLUSH_INTERVAL_MS=60000
```

---

## Swagger / OpenAPI Spec

Add this to your backend and run `swagger-ui-express`. Interviewers love this — it shows
you know how to document APIs for other developers.

```yaml
# backend/swagger.yaml
openapi: 3.0.0
info:
  title: URL Shortener API
  version: 1.0.0
  description: |
    Production-grade URL Shortener API.
    Supports user authentication, custom codes, expiry, and click analytics.

servers:
  - url: http://localhost:3000/api/v1
    description: Local development

paths:
  /auth/register:
    post:
      summary: Register a new user
      tags: [Auth]
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [email, password]
              properties:
                email:
                  type: string
                  format: email
                password:
                  type: string
                  minLength: 8
      responses:
        "201":
          description: User created, JWT returned
        "409":
          description: Email already registered

  /shorten:
    post:
      summary: Create a short URL
      tags: [URLs]
      security:
        - bearerAuth: []          # Optional — anonymous users can also shorten
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [original_url]
              properties:
                original_url:
                  type: string
                  format: uri
                custom_code:
                  type: string
                  minLength: 3
                  maxLength: 10
                  pattern: '^[a-zA-Z0-9-_]+$'
                expires_in_days:
                  type: integer
                  minimum: 1
                  maximum: 365
      responses:
        "201":
          description: Short URL created
        "400":
          description: Invalid URL
        "409":
          description: Custom code already in use
        "429":
          description: Rate limit exceeded

components:
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT
```

---

## Build Phases — What to Build in What Order

| Phase | Files to Create | Concept You Learn |
|-------|----------------|-------------------|
| 1 | `config/db.js`, migration SQL files | Postgres setup, schema design, B-Tree indexes |
| 2 | `utils/base62.js`, `utils/validate.js` | Algorithm design, URL validation |
| 3 | Auth routes + JWT middleware | Bcrypt, JWT, stateless auth |
| 4 | `POST /shorten` full stack | Layered architecture, deduplication |
| 5 | `GET /:code` + Redis | Cache-Aside, 302 redirects, TTL |
| 6 | `middleware/rateLimiter.js` | Redis Sorted Sets, Sliding Window |
| 7 | `workers/analyticsWorker.js` | Redis Streams, async processing |
| 8 | `docker-compose.yml` | Containers, networking, volumes |
| 9 | React frontend (Vite) | Dashboard, Login/Register pages |
| 10 | `swagger.yaml` + swagger-ui-express | API documentation |
