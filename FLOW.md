# 📖 Build Flow — Read This Before You Touch Any Code

> **This is your "writer's map."**
> If you were building this app from scratch, this is the exact order you'd create each file,
> and WHY that order makes sense.
>
> Rule: every file depends only on files that came BEFORE it in this list.

---

## The Mental Model First

Before writing code, understand the request flow:

```
Browser Request
      ↓
   app.js          ← boots the server, wires everything
      ↓
  routes/          ← "which URL goes where?"
      ↓
middleware/         ← "is the request allowed?"  (auth, rate limit)
      ↓
controllers/        ← "parse request, call service, send response"
      ↓
  services/         ← "business logic — the real work"
      ↓
   models/          ← "talk to the database"
      ↓
config/db.js        ← "the actual database connection"
```

And cutting across all of these: **Redis** (cache + rate limit + analytics queue).

---

## Phase 1 — Foundation (no dependencies needed)

These files have ZERO dependencies on other files in our project.
Write them first — everything else will import from them.

### Step 1: `.env.example`
**Why first?** Before writing any code, decide what config your app needs.
Every secret, every URL, every toggle goes here. This shapes everything else.
```
What you decide here:
  - What DB will I use? → DATABASE_URL
  - What's my JWT secret name? → JWT_SECRET
  - How long are tokens valid? → JWT_EXPIRES_IN
```

### Step 2: `migrations/001_create_users.sql`
**Why second?** You can't write any code that touches users without a table to put them in.
SQL first — schema is your data contract.
```sql
-- Ask yourself: what data do I need to store about a user?
-- id, email, password_hash, plan, created_at
-- Why UUID not BIGINT? Why UNIQUE on email? Decide this here.
```

### Step 3: `migrations/002_create_urls.sql`
**Why third?** URLs reference users (foreign key). Users table must exist first.
```sql
-- Ask yourself: what data do I need to store about a URL?
-- id (BIGSERIAL ← needed for Base62), short_code, original_url, user_id, expires_at
-- What indexes do I need? The short_code index is the most critical.
```

### Step 4: `migrations/003_create_clicks.sql`
**Why fourth?** Clicks reference URLs (foreign key). URLs table must exist first.
```sql
-- Ask yourself: what analytics data do I need?
-- short_code, clicked_at, ip_hash, country
-- What's the analytics query? → composite index (short_code, clicked_at)
```

### Step 5: `config/migrate.js`
**Why now?** You have the SQL files. Now write the script that runs them.
Once written, run it once: `node src/config/migrate.js`
```
This is just file I/O: read *.sql files → run them on Postgres → done.
```

---

## Phase 2 — Infrastructure (low-level plumbing)

These files set up connections. Pure configuration, no business logic.

### Step 6: `config/db.js`
**Why now?** Models need a DB connection. Create it here, all models import from here.
```
Key decisions:
  - Connection pool (not single connection) — why?
  - What to do on connection error — crash or log?
  - min/max pool size — what numbers?
```

### Step 7: `config/redis.js`
**Why now?** CacheService, RateLimiter, and AnalyticsWorker all need Redis.
```
Key decisions:
  - What if Redis is down? → log but DON'T crash (graceful degradation)
  - Retry strategy → exponential backoff
```

---

## Phase 3 — Pure Utilities (no side effects, no DB)

These are just functions. They don't import anything from our project.
Easiest to write, easiest to test in isolation.

### Step 8: `utils/base62.js`
**Why now?** The URL service needs this to generate short codes.
Pure math — just encode(number) → string, decode(string) → number.
```
Test it right now in Node REPL:
  const { encode, decode } = require('./utils/base62')
  encode(3521)    // → 'ZP'
  decode('ZP')    // → 3521
```

### Step 9: `utils/validate.js`
**Why now?** The URL service needs this before saving any URL.
Pure logic — just validateUrl(url) → { valid, reason }.
```
Test it:
  validateUrl('https://google.com')  // { valid: true }
  validateUrl('not a url')            // { valid: false, reason: '...' }
  validateUrl('javascript://evil')    // { valid: false, reason: '...' }
```

---

## Phase 4 — Data Layer (models)

Models talk to the DB. They import config/db.js. Nothing else.
No business logic lives here — just SQL.

### Step 10: `models/user.model.js`
**Why now?** Auth service needs to create + find users.
```
Methods to write (think: what SQL operations do I need?):
  findByEmail(email)        ← login
  findById(id)              ← JWT verification
  create({ email, hash })   ← registration
  updateLastLogin(id)       ← after login
```

### Step 11: `models/url.model.js`
**Why now?** URL service needs to create + find + delete URLs.
```
Methods to write:
  create({ originalUrl, userId, expiresAt })          ← write path step 1
  setShortCode(id, shortCode)                         ← write path step 2
  createWithCustomCode({ ... })                       ← custom code path
  findByCode(shortCode)                               ← read path (HOT PATH)
  findByOriginalUrl(originalUrl, userId)              ← deduplication
  findByUserId(userId)                                ← dashboard
  deactivate(shortCode, userId)                       ← delete (soft)
  recordClick({ shortCode, ipHash, ... })             ← analytics
  getAnalytics(shortCode, userId)                     ← dashboard chart
```

---

## Phase 5 — Services (business logic)

Services import models + utils. They contain ALL business decisions.
No req/res here — just plain functions that take data and return data.

### Step 12: `services/cache.service.js`
**Why now?** URL service needs it (check cache before DB).
```
Methods:
  getUrl(shortCode)     ← returns: url string | null (negative cache) | undefined (miss)
  setUrl(code, url)     ← populate cache after DB hit
  setNull(code)         ← cache a 404 result (negative caching)
  deleteUrl(code)       ← cache invalidation on delete/update
```

### Step 13: `services/auth.service.js`
**Why now?** Auth controller needs it.
```
Think through the register flow:
  1. Normalize email
  2. Check duplicate → UserModel.findByEmail()
  3. Hash password → bcrypt.hash()   ← WHY bcrypt? WHY 12 rounds?
  4. Save → UserModel.create()
  5. Create JWT → jwt.sign()
  6. Return { user, token }

Think through the login flow:
  1. Find user → UserModel.findByEmail()
  2. ALWAYS bcrypt.compare() even if user not found  ← WHY? Timing attacks!
  3. If match → create JWT
  4. Return { user, token }
```

### Step 14: `services/url.service.js`
**Why now?** URL controller needs it. This is the most complex service.
```
Write path (POST /shorten):
  1. validateUrl()
  2. validateCustomCode() if provided
  3. Deduplication: UrlModel.findByOriginalUrl()
  4. UrlModel.create() → get id
  5. base62.encode(id) → shortCode
  6. UrlModel.setShortCode(id, shortCode)
  7. CacheService.setUrl() ← warm up cache immediately
  8. Return result

Read path (GET /:code):
  1. CacheService.getUrl()  ← HIT? Return immediately
  2. UrlModel.findByCode()  ← MISS? Go to DB
  3. CacheService.setUrl()  ← Populate cache
  4. Return url

Analytics push (after redirect):
  1. Hash the IP
  2. redis.xadd('stream:clicks', ...) ← async, non-blocking
```

---

## Phase 6 — Middleware

Middleware runs between route registration and controllers.
Imports: config/redis.js, jsonwebtoken. Nothing from services/models.

### Step 15: `middleware/authenticate.js`
```
Two exports:
  authenticate     ← MUST have valid JWT or reject 401
  optionalAuth     ← attach user if JWT valid, null if not (don't reject)

Flow:
  1. Read Authorization header
  2. jwt.verify(token, JWT_SECRET)
  3. Attach decoded payload to req.user
  4. next()
```

### Step 16: `middleware/rateLimiter.js`
```
Algorithm (Sliding Window with Redis Sorted Set):
  Key = 'ratelimit:{ip or user_id}'
  
  Pipeline (1 round trip for 4 commands):
    ZREMRANGEBYSCORE  ← remove entries older than window
    ZADD              ← add current request
    ZCARD             ← count requests in window
    EXPIRE            ← auto-cleanup inactive users
  
  If count > limit → 429
```

### Step 17: `middleware/errorHandler.js`
```
4-parameter Express function: (err, req, res, next)
Standardizes ALL errors into: { success: false, error: { code, message } }
Must be registered LAST in app.js.
```

---

## Phase 7 — Controllers (HTTP layer)

Controllers are THIN. They just:
1. Read from req (body, params, user)
2. Call a service
3. Send res

### Step 18: `controllers/auth.controller.js`
```
register() → AuthService.register() → res 201
login()    → AuthService.login()    → res 200
me()       → just return req.user   → res 200  (middleware already verified JWT)
```

### Step 19: `controllers/url.controller.js`
```
shorten()       → UrlService.shorten()       → res 201
listMyUrls()    → UrlModel.findByUserId()    → res 200
deleteUrl()     → UrlModel.deactivate()       → CacheService.deleteUrl() → res 200
getAnalytics()  → UrlModel.getAnalytics()    → res 200
```

### Step 20: `controllers/redirect.controller.js`
```
redirect()
  1. UrlService.resolve(code)   ← cache-aside lookup
  2. res.redirect(302, url)     ← SEND RESPONSE FIRST
  3. setImmediate(() => {       ← THEN push analytics (after response sent)
       UrlService.pushClickEvent(...)
     })
```

---

## Phase 8 — Routes

Thin files. Just connect HTTP method + path → middleware chain → controller.

### Step 21: `routes/auth.routes.js`
```
POST /register → AuthController.register
POST /login    → AuthController.login
GET  /me       → authenticate → AuthController.me
```

### Step 22: `routes/url.routes.js`
```
POST   /shorten              → optionalAuth → shortenLimiter → UrlController.shorten
GET    /me/urls              → authenticate → UrlController.listMyUrls
DELETE /me/urls/:code        → authenticate → UrlController.deleteUrl
GET    /me/urls/:code/analytics → authenticate → UrlController.getAnalytics
```

---

## Phase 9 — App Bootstrap

### Step 23: `app.js`
Now you wire everything together. ORDER MATTERS in Express:
```
1. cors()           ← must be before routes
2. express.json()   ← must be before routes (to parse body)
3. trust proxy      ← must be before rate limiter (to get real IP)
4. /api/v1/health   ← no auth needed
5. /api/v1/auth     ← auth routes
6. /api/v1          ← URL routes
7. /:code           ← redirect (MUST be after /api routes!)
8. 404 handler
9. errorHandler()   ← MUST be absolutely last
```

---

## Phase 10 — Background Worker

### Step 24: `workers/analyticsWorker.js`
Separate process — imports db.js and redis.js only.
```
1. Create Redis consumer group (once)
2. Loop forever:
   a. XREADGROUP → read up to 100 events from stream
   b. INSERT all click events to Postgres
   c. XACK → acknowledge processed events
   d. Repeat
```

---

## Phase 11 — Frontend (reads the API, doesn't affect it)

### Step 25: `frontend/src/api/axios.js`
**Why first in frontend?** Every page uses this.
```
- Set baseURL = '/api/v1'
- Request interceptor: add JWT to every request
- Response interceptor: auto-logout on 401
```

### Step 26: `frontend/src/context/AuthContext.jsx`
**Why second?** App.jsx and all pages need auth state.
```
Provides: user, isLoggedIn, login(), register(), logout()
Wraps entire app — any component can call useAuth()
```

### Step 27: `frontend/src/components/ProtectedRoute.jsx`
```
if (!isLoggedIn) → redirect to /login
else → render children
```

### Step 28: `frontend/src/App.jsx`
```
Wraps everything in <AuthProvider>
Defines all routes: /, /login, /register, /dashboard
/dashboard wrapped in <ProtectedRoute>
```

### Step 29: Pages in order of complexity
```
Login.jsx      ← simplest: controlled form → api.post('/auth/login')
Register.jsx   ← same pattern + password validation
Home.jsx       ← shorten form + show result + copy button
Dashboard.jsx  ← fetch URLs + analytics chart + delete
```

---

## 🗺️ Dependency Graph (who imports who)

```
app.js
├── routes/auth.routes.js
│   ├── controllers/auth.controller.js
│   │   └── services/auth.service.js
│   │       ├── models/user.model.js
│   │       │   └── config/db.js
│   │       └── (bcrypt, jsonwebtoken)
│   └── middleware/authenticate.js
│       └── (jsonwebtoken)
│
├── routes/url.routes.js
│   ├── controllers/url.controller.js
│   │   ├── services/url.service.js
│   │   │   ├── models/url.model.js
│   │   │   │   └── config/db.js
│   │   │   ├── services/cache.service.js
│   │   │   │   └── config/redis.js
│   │   │   ├── utils/base62.js
│   │   │   └── utils/validate.js
│   │   └── services/cache.service.js
│   ├── middleware/authenticate.js
│   └── middleware/rateLimiter.js
│       └── config/redis.js
│
├── controllers/redirect.controller.js
│   └── services/url.service.js (same tree as above)
│
└── middleware/errorHandler.js
```

---

## ⚡ TL;DR — The 24-Step Build Order

```
1.  .env.example            (what config do I need?)
2.  migrations/001_users    (schema first)
3.  migrations/002_urls
4.  migrations/003_clicks
5.  config/migrate.js       (run the SQL files)
6.  config/db.js            (postgres connection pool)
7.  config/redis.js         (redis client)
8.  utils/base62.js         (encode/decode — pure math)
9.  utils/validate.js       (url validation — pure logic)
10. models/user.model.js    (SQL queries for users)
11. models/url.model.js     (SQL queries for urls + analytics)
12. services/cache.service.js  (Redis cache wrapper)
13. services/auth.service.js   (bcrypt + JWT logic)
14. services/url.service.js    (the main orchestrator)
15. middleware/authenticate.js (JWT guard)
16. middleware/rateLimiter.js  (sliding window)
17. middleware/errorHandler.js (global error format)
18. controllers/auth.controller.js
19. controllers/url.controller.js
20. controllers/redirect.controller.js
21. routes/auth.routes.js
22. routes/url.routes.js
23. app.js                  (wire it all together)
24. workers/analyticsWorker.js (separate process)
--- frontend ---
25. api/axios.js            (shared API client)
26. context/AuthContext.jsx (global auth state)
27. components/ProtectedRoute.jsx
28. App.jsx                 (router)
29. pages: Login → Register → Home → Dashboard
```
