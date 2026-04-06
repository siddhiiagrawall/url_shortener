# 🎯 Interview Q&A — Everything You Learn Building This Project

> Every question here is something you'll be asked as an SDE-1.
> Organized by topic. Study the answer, then practice saying it out loud.

---

## 📦 SECTION 1: System Design

**Q: Design a URL shortener.**
> A: We have two main flows. The **write path**: validate the URL, check for duplicates, insert into Postgres to get an auto-increment ID, Base62-encode that ID as the short code, cache it in Redis, return the short URL. The **read path**: check Redis first (cache-aside), on miss query Postgres, then return a 302 redirect. We track analytics asynchronously via a Redis Stream so the redirect itself is never slowed down.

**Q: How do you scale this to handle 100 million URLs?**
> A: Horizontally scale Node.js behind a load balancer. Add Postgres read replicas for read-heavy workloads. Shard Redis if memory becomes a constraint. The main bottleneck is the DB write path — we can pre-generate short codes in batches to avoid DB round-trips on every request.

**Q: What are the core trade-offs in this system?**
> A: Speed vs. freshness (cache TTL), write performance vs. analytics accuracy (batch writes), simplicity vs. resilience (single Postgres vs. replicas). Every design decision is a trade-off — the key is knowing *which* trade-off you're making and *why*.

**Q: What is the CAP theorem? Where does this system sit?**
> A: CAP says a distributed system can only guarantee two of: Consistency, Availability, Partition Tolerance. Our system prioritizes **Availability + Partition Tolerance** (AP). If a Postgres replica is stale by a few seconds, that's acceptable. We'd rather serve a slightly stale URL than return an error.

**Q: What is a single point of failure in this system?**
> A: Without replication, Postgres is an SPOF. We mitigate this with read replicas and WAL-based backups. Redis is less critical — it's a cache; if it goes down, we fall back to Postgres with a performance hit but no data loss.

**Q: How would you handle a "viral" URL that gets 100k hits/second?**
> A: Redis handles this naturally — it serves from RAM. The concern is a **cache stampede** (cache is cold, 100k requests all hit Postgres simultaneously). We solve this with a **mutex lock**: only one request fetches from Postgres; the rest wait, then all get the now-cached result.

---

## 🗄️ SECTION 2: Databases & PostgreSQL

**Q: Why use a relational database (Postgres) and not MongoDB?**
> A: We need ACID guarantees (can't lose a URL after telling the user it was saved), strict schema enforcement, and JOIN-capable queries for analytics. MongoDB's flexibility is a disadvantage here — we don't need it, and it costs us consistency guarantees.

**Q: What is ACID? Explain each property.**
> A: **Atomicity** — all or nothing (no partial inserts). **Consistency** — DB rules (like UNIQUE constraints) are always enforced. **Isolation** — concurrent transactions don't interfere with each other. **Durability** — once committed, data survives crashes (written to disk via WAL).

**Q: Why use a UNIQUE INDEX on `short_code`?**
> A: Without it, finding a short code requires a full table scan — O(n). With a B-Tree index, it's O(log n). At 10 million rows, that's ~23 comparisons vs 10 million. It also enforces uniqueness at the DB level as the final safety net against race conditions.

**Q: What is a B-Tree index?**
> A: A self-balancing tree where data is sorted. Finding a value requires traversing from the root to a leaf node. With n rows, this takes O(log₂ n) comparisons. Postgres uses B-Trees for all standard indexes. They're great for equality (`=`) and range (`BETWEEN`, `>`, `<`) queries.

**Q: What is a composite index? When do you use one?**
> A: An index on multiple columns together, e.g., `(short_code, clicked_at)`. Postgres can use this index for queries that filter by `short_code` AND sort/filter by `clicked_at`. Rule: put the **equality** column first, the **range** column second.

**Q: What is a database connection pool?**
> A: Instead of opening a new DB connection on every request (slow, expensive), a pool keeps N connections open and reuses them. We configure `min: 2, max: 10`. If all 10 are busy, new requests wait. This is managed by the `pg` library's `Pool` class.

**Q: What is a database migration?**
> A: A versioned SQL script that changes the DB schema in a controlled, repeatable way. Instead of manually running SQL, you run migration files in order. Tools like `node-postgres-migrate` or `db-migrate` track which migrations have been applied.

**Q: What is a soft delete?**
> A: Instead of `DELETE FROM urls WHERE id = ?`, you set `is_active = FALSE`. The row remains in the DB, preserving history and foreign key relationships, and the action is reversible. Hard deletes are permanent and cascade to related rows.

**Q: What is `ON DELETE SET NULL` vs `ON DELETE CASCADE`?**
> A: When a referenced row is deleted: `SET NULL` sets the foreign key to NULL (URL still exists, just loses user ownership). `CASCADE` deletes the referencing row too (deleting a user deletes all their URLs). We use `SET NULL` on `user_id` so URLs survive account deletion.

**Q: What is a database transaction?**
> A: A group of SQL statements that execute as a single unit. Either ALL succeed (commit) or ALL are rolled back on failure. Example: when creating a URL + logging the creation event, wrap both in a transaction so you never have a URL without a log entry.

**Q: Why is BIGSERIAL better than INT for the URL id?**
> A: `INT` maxes at ~2.1 billion. `BIGSERIAL` goes to 9.2 quintillion. Base62 of 2.1 billion = 5-6 chars. We'd run out of short codes much sooner with INT. BIGSERIAL costs only 8 bytes vs INT's 4 bytes — a small price for 3.5 trillion short codes.

---

## ⚡ SECTION 3: Redis & Caching

**Q: What is the Cache-Aside pattern?**
> A: Check cache → if HIT, return. If MISS, fetch from DB → store in cache → return. The application manages the cache manually. Alternative patterns: Write-Through (write to cache AND DB simultaneously), Write-Behind (write to cache, async write to DB later).

**Q: What is a TTL (Time-To-Live)?**
> A: An expiry time on a cache key. After TTL seconds, Redis automatically deletes the key. Without TTL, stale data lives forever. With TTL, the worst-case staleness is bounded. We set 1 hour for regular URLs.

**Q: What is cache invalidation? Why is it hard?**
> A: The process of removing stale cache entries when the source data changes. It's hard because in a distributed system, you might have multiple cache servers, and you need to ensure ALL of them are invalidated at the right moment. "There are only two hard things in CS: cache invalidation and naming things."

**Q: What is negative caching?**
> A: Caching a "not found" result. If someone requests a non-existent code, we cache `short_code → NULL` for 30 seconds. Without this, every request for a bad code hits Postgres. With it, we stop the DB hammering.

**Q: What LRU eviction policy do we use and why?**
> A: `allkeys-lru` — evict the Least Recently Used key across ALL keys when memory is full. This naturally keeps hot/popular URLs cached and evicts cold/rarely-accessed ones. Alternative: `volatile-lru` (only evict keys with TTL set) — we don't use this because not all our keys have TTL.

**Q: Why is Redis single-threaded? Isn't that a problem?**
> A: Redis processes commands in a single thread, which makes ALL commands atomic by default. No locks needed. `INCR` is guaranteed to be atomic. This is actually a feature, not a bug. Redis can handle 100k+ ops/second single-threaded because it's all in-memory with no disk I/O per command.

**Q: What are Redis Streams? How are they different from Pub/Sub?**
> A: Streams are a persistent, ordered log of messages. Pub/Sub is fire-and-forget — if no one is listening, the message is lost. Streams store messages on disk — if the worker crashes, messages are not lost and can be replayed. We use Streams for analytics click events because losing clicks is bad.

**Q: What is a Redis pipeline?**
> A: Sending multiple commands to Redis in a single network round-trip instead of one by one. Instead of 4 round-trips for our sliding-window rate limiter, we batch all 4 commands into one pipeline call. Reduces latency from 4 × RTT to 1 × RTT.

---

## 🔐 SECTION 4: Authentication & Security

**Q: Why do we hash passwords with bcrypt and not MD5/SHA256?**
> A: MD5/SHA256 are designed to be FAST — they can hash billions of passwords per second, making brute force easy. bcrypt is intentionally slow (configurable cost factor). At cost 12, it takes ~250ms per hash. An attacker trying billions of combinations would take centuries.

**Q: What is a JWT? What are its three parts?**
> A: JSON Web Token — a self-contained auth credential. Three parts separated by dots: **Header** (algorithm used), **Payload** (claims: user_id, email, expiry), **Signature** (HMAC of header + payload using secret key). Only the server knows the secret, so only the server can create valid tokens.

**Q: Why JWT over sessions?**
> A: Sessions store state on the SERVER (in memory or a DB). Every server needs access to session state → requires sticky sessions or a shared session store. JWTs are STATELESS — any server can verify the signature without network calls. Scales horizontally for free.

**Q: What is the trade-off of JWT?**
> A: You can't instantly revoke a JWT (short of maintaining a blocklist, which kills the stateless benefit). Once issued, it's valid until expiry. This is why we use short expiry times (7 days) and encourage refresh tokens for longer sessions.

**Q: Where should the frontend store the JWT?**
> A: NOT in `localStorage` — vulnerable to XSS attacks (any JavaScript on the page can read it). Better options: **HttpOnly cookie** (JS can't read it, but requires CSRF protection) or **in-memory** (React state — lost on page refresh, most secure).

**Q: What is XSS? How do we prevent it?**
> A: Cross-Site Scripting — injecting malicious JS into a page. Prevents by: sanitizing all user input, using `Content-Security-Policy` headers, never embedding raw user data in HTML, storing JWT in HttpOnly cookies instead of localStorage.

**Q: What is CSRF? How does it relate to cookies?**
> A: Cross-Site Request Forgery — a malicious site tricks a logged-in user's browser into making requests to your API using their cookies. Mitigation: use `SameSite=Strict` cookie attribute, or a CSRF token in request headers (cookies are auto-sent by browser, custom headers require JS → same origin).

**Q: What is bcrypt's salt and why does it matter?**
> A: A random value added to the password before hashing. bcrypt generates a unique salt per password automatically. This means two users with the same password have different hashes, and rainbow table attacks (precomputed hash lookups) are useless.

**Q: What does `Authorization: Bearer <token>` mean?**
> A: `Authorization` is the HTTP header. `Bearer` is the auth scheme meaning "the bearer of this token should be granted access." The token follows. Our middleware extracts this header, verifies the JWT, and attaches the user to the request.

---

## 🌐 SECTION 5: APIs & REST

**Q: What's the difference between 301 and 302 redirects?**
> A: **301 Permanent** — browser caches it forever. Next click goes directly to the destination without hitting your server. **302 Temporary** — browser always checks your server. We use 302 so every click registers in our analytics.

**Q: What does "REST" actually mean?**
> A: Representational State Transfer — an architectural style with 6 constraints. The key ones: **Stateless** (each request contains all info needed, no server-side session), **Uniform Interface** (consistent resource-based URLs + HTTP verbs), **Client-Server** (separated concerns), **Cacheable** (responses can declare themselves cacheable).

**Q: What HTTP status codes should every developer know?**
> A: 200 OK, 201 Created, 204 No Content, 301/302 Redirect, 400 Bad Request, 401 Unauthorized (not authenticated), 403 Forbidden (authenticated but not allowed), 404 Not Found, 409 Conflict, 410 Gone, 422 Unprocessable Entity, 429 Too Many Requests, 500 Internal Server Error.

**Q: What is idempotency? Which HTTP methods are idempotent?**
> A: An operation is idempotent if calling it N times has the same result as calling it once. `GET`, `PUT`, `DELETE` are idempotent. `POST` is NOT — calling POST twice creates two resources. This matters for retry logic: safe to retry idempotent calls, dangerous to retry POST.

**Q: Why do we version APIs with `/api/v1/`?**
> A: So you can release breaking changes in `/api/v2/` while old clients continue using `/api/v1/`. Without versioning, every breaking change breaks every existing client. Run both versions simultaneously during a migration window, then deprecate v1.

**Q: What is CORS? Why does it exist?**
> A: Cross-Origin Resource Sharing — a browser security policy that blocks JavaScript from making requests to a different domain than the page was served from. Our React frontend (localhost:5173) calling our API (localhost:3000) would be blocked by default. We configure CORS headers on the backend to explicitly allow trusted origins.

**Q: What is the difference between authentication and authorization?**
> A: **Authentication** = proving who you are (login, JWT). **Authorization** = proving you're allowed to do something (your JWT says you're user A, but you can't delete user B's URLs). Both checks happen but are separate concerns.

**Q: What is input validation and why does it matter at the API layer?**
> A: Checking that incoming data matches expected format before processing it. Prevents: garbage data in the DB, SQL injection (use parameterized queries), downstream errors. Validate at the route/controller level, before hitting any service or DB.

**Q: What are parameterized queries? Why SQL injection matters?**
> A: Instead of string-concatenating user input into SQL: `"SELECT * FROM urls WHERE code = '" + input + "'"` (injectable!), use placeholders: `SELECT * FROM urls WHERE code = $1` with `[input]` passed separately. The DB driver escapes it safely. SQL injection is the #1 web vulnerability.

---

## 🔄 SECTION 6: Concurrency & Node.js

**Q: What is the Node.js Event Loop?**
> A: Node.js runs JavaScript in a single thread. When it encounters an async operation (DB query, file read), it registers a callback and moves on instead of waiting. When the operation completes, the callback is queued. The event loop continuously checks: "Is JS idle? Run the next callback." This allows handling thousands of concurrent requests without threads.

**Q: What is the difference between `async/await` and callbacks?**
> A: Callbacks are the old approach — nest functions inside functions (callback hell). `async/await` is syntactic sugar over Promises — write async code that looks synchronous, is easier to read, and handles errors with try/catch. Under the hood, both use the same event loop mechanism.

**Q: What is a race condition?**
> A: When the correctness of a program depends on the relative timing of events. Example: two requests both check "is code X taken?" → both see "no" → both insert X → duplicate. Prevention: use atomic DB operations (UNIQUE constraint), locks, or design around the race (derive code from atomic auto-increment ID).

**Q: What does "atomic" mean in computing?**
> A: An operation that is indivisible — it either completes fully or not at all, with no intermediate state visible to other operations. Postgres's UNIQUE constraint check + insert is atomic (uses locks). Redis's `INCR` command is atomic (single-threaded). Atomicity prevents race conditions.

**Q: What is a mutex/lock? When would you use it?**
> A: Mutual exclusion — only one thread/process can hold the lock at a time. Used when multiple concurrent operations must not interleave. In our cache stampede scenario: the first request acquires a Redis lock, fetches from DB, populates cache, releases lock. All others wait, then read from cache.

**Q: What is horizontal vs vertical scaling?**
> A: **Vertical** = make one server bigger (more RAM/CPU). Has limits and is expensive. **Horizontal** = add more servers behind a load balancer. Requires stateless application design (each request can go to any server). Node.js + JWT auth is designed for horizontal scaling.

---

## 🐳 SECTION 7: Docker & DevOps

**Q: What is Docker? What problem does it solve?**
> A: Docker packages your app + its dependencies into a portable container. Solves "works on my machine" — the container runs identically on any OS. Also provides isolation (Postgres in a container doesn't conflict with your local Postgres).

**Q: What's the difference between a Docker image and a container?**
> A: An **image** is the blueprint (like a class). A **container** is a running instance (like an object). You can run multiple containers from the same image. `docker-compose up` creates containers from images.

**Q: What is docker-compose? Why use it?**
> A: A tool to define and run multi-container applications. One `docker-compose.yml` file defines all services (app, postgres, redis), their configs, and how they connect. One command (`docker-compose up`) starts everything. Perfect for local development.

**Q: How do containers talk to each other?**
> A: Docker Compose creates a private network. Containers reference each other by **service name** (not `localhost`). Our Node app connects to Postgres at `postgres:5432` (the service name), not `localhost:5432`.

**Q: What is a Docker volume?**
> A: A way to persist data outside the container's filesystem. Without a volume, Postgres data is deleted when the container stops. With `volumes: [pgdata:/var/lib/postgresql/data]`, data persists on the host machine across container restarts.

**Q: What is a health check in Docker?**
> A: A command Docker runs periodically to verify a container is healthy. Our Postgres health check: `pg_isready -U user`. The app container waits for Postgres to be healthy before starting (using `depends_on + condition: service_healthy`).

**Q: What is an environment variable? Why not hardcode config?**
> A: Variables set outside the code (in OS, `.env` file, Docker config) that the app reads at runtime. Hardcoding `password=abc123` in code is a security disaster — anyone with repo access sees it. Env vars keep secrets out of source control. `.env` is in `.gitignore`. `env.example` shows the shape without real values.

---

## ⚛️ SECTION 8: Frontend (React + Vite)

**Q: What is Vite? Why use it over Create React App?**
> A: Vite is a modern build tool that uses native ES modules in the browser during development. No bundling step on every save — instant hot module replacement. CRA uses Webpack which re-bundles everything on changes. Vite is 10-100x faster in dev.

**Q: What is a React controlled component?**
> A: A form element where React state is the single source of truth. The input's value is bound to state, and onChange updates state. This lets React fully control the form, enabling validation and submission logic. Opposite: uncontrolled components (use refs, not state).

**Q: What is React Router? What is a protected route?**
> A: React Router handles client-side navigation without full page reloads. A protected route is a wrapper that checks if the user is logged in (has a JWT). If not, it redirects to `/login`. This prevents unauthenticated users from accessing `/dashboard`.

**Q: What is CORS and how do you configure it on the backend for React?**
> A: Configure `cors` npm package in Express: `app.use(cors({ origin: 'http://localhost:5173', credentials: true }))`. This tells the browser "requests from localhost:5173 are allowed." In production, replace with your actual frontend domain.

**Q: What is Axios? Why use it over `fetch`?**
> A: Axios is an HTTP client with quality-of-life improvements: automatic JSON parsing, request/response interceptors (great for adding JWT headers to every request automatically), better error handling (throws on 4xx/5xx), and request cancellation.

---

## 📐 SECTION 9: Software Engineering Principles

**Q: What is the Single Responsibility Principle?**
> A: A module/class/function should have one reason to change. In our layered architecture: routes only handle routing, services only handle business logic, models only handle DB access. If DB changes, only `models/` changes. Nothing else is affected.

**Q: What is DRY (Don't Repeat Yourself)?**
> A: Every piece of knowledge should have a single, unambiguous representation. If you write the same validation logic in three routes, bug fixes must be applied in three places. Extract it into `utils/validate.js` — one place to fix, one place to test.

**Q: What is an environment and why have multiple (dev/staging/prod)?**
> A: **Dev** — local development, fake data, debug logs on. **Staging** — mirrors production exactly, for testing before release. **Prod** — real users, real data, errors are costly. Never test unproven code in prod. Use env vars to switch behavior across environments.

**Q: What is logging? What should you log?**
> A: Recording events that happened in your app. Good to log: incoming requests (method, path, duration), errors (with stack traces), significant business events (URL created, user registered). Don't log: passwords, JWT tokens, PII (email in prod logs). Use structured logging (JSON) so logs are queryable.

**Q: What is a linter? What is Prettier?**
> A: A **linter** (ESLint) analyzes code for bugs and style issues before runtime. A **formatter** (Prettier) auto-formats code to a consistent style. Both reduce code review friction and catch bugs early. Run both in CI before merging.

**Q: What is a unit test vs integration test vs end-to-end test?**
> A: **Unit** — tests one function in isolation, mocking dependencies (test `base62.encode(125) === "21"`). **Integration** — tests multiple layers together (POST /shorten → actually hits a test DB). **E2E** — tests the full system through the UI (Cypress/Playwright). Unit tests are fastest; E2E tests are slowest but most realistic.

**Q: What is the test pyramid?**
> A: A guideline: many unit tests, fewer integration tests, fewer E2E tests. Unit tests are fast and cheap. E2E tests are slow and brittle. A good ratio: 70% unit, 20% integration, 10% E2E.

---

## 🌍 SECTION 10: Networking & HTTP

**Q: What happens when you type a URL and press Enter?**
> A: DNS lookup (domain → IP), TCP connection (3-way handshake), TLS handshake (for HTTPS), HTTP request sent, server processes and responds, browser renders. The redirect path in our system fits between the HTTP request and response steps.

**Q: What is DNS?**
> A: Domain Name System — the internet's phone book. Translates human-readable domains (`sho.rt`) to IP addresses (`192.168.1.1`). Without DNS, you'd have to remember IP addresses for every website.

**Q: What is TCP? Why is it reliable?**
> A: Transmission Control Protocol — guarantees delivery via acknowledgments (ACKs). Sender waits for ACK before continuing. Lost packets are retransmitted. HTTP runs over TCP. This reliability is why your Redis operations and DB queries always complete or explicitly fail — no mysteriously lost data.

**Q: What are HTTP headers?**
> A: Key-value metadata sent with every request and response. Important ones: `Content-Type` (what format is the body?), `Authorization` (who are you?), `Cache-Control` (how long can you cache this?), `X-RateLimit-Remaining` (how many requests left?), `Location` (where to redirect to?).

**Q: What is SSL/TLS? What does HTTPS mean?**
> A: TLS (Transport Layer Security) encrypts HTTP traffic. HTTPS = HTTP + TLS. Without it, anyone on the same network can read your API requests (including JWTs and passwords). NGINX handles TLS termination — decrypts incoming HTTPS, forwards plain HTTP to Node internally.

---

## 📊 SECTION 11: Algorithms & Data Structures

**Q: Explain Base62 encoding and why 7 characters gives 3.5 trillion combinations.**
> A: Base62 uses 62 characters (0-9, a-z, A-Z). 7 characters = 62^7 = 3,521,614,606,208. It's just like base 10 but with 62 symbols instead of 10. We convert a decimal number (the DB auto-increment ID) to base 62, giving a short, URL-safe string.

**Q: What is the difference between encoding and encryption?**
> A: **Encoding** (Base62, Base64) just changes representation — no secret, fully reversible, anyone can decode. **Encryption** requires a key to decode — without the key, data is unreadable. Don't use encoding to hide data. Use encryption (AES, RSA) for secrets.

**Q: What is a hash function? How is it different from encoding?**
> A: A hash function maps data to a fixed-size output. It's **one-way** — you can't reverse it to get the original. Same input always gives same output. Used for password storage (bcrypt), data integrity checks, fingerprinting. Encoding is reversible; hashing is not.

**Q: What is a Sliding Window algorithm?**
> A: A technique that maintains a "window" of relevant elements as you iterate. In rate limiting, the window is the last N seconds of requests. As time passes, old requests fall out the "left" side, new ones join the "right" side. More accurate than fixed-window buckets.

**Q: What is the time complexity of a hash map lookup?**
> A: O(1) average case. This is why Redis is so fast — it uses hash maps internally. Worst case is O(n) if all keys hash to the same bucket (hash collision), but good hash functions make this astronomically unlikely.

---

## 🏗️ SECTION 12: Common Interview Follow-Ups

**Q: How would you add custom short codes?**
> A: Add `custom_code` field to POST /shorten request. Validate format (alphanumeric, 3-10 chars, no reserved words like "api", "docs"). Try to insert with the custom code directly (skip Base62 encoding). Catch UNIQUE constraint violation → return 409 Conflict.

**Q: How would you add link expiry?**
> A: Store `expires_at` in the `urls` table. On redirect, check `expires_at IS NULL OR expires_at > NOW()`. If expired, return 410 Gone. Clean up expired rows with a nightly cron job (`DELETE FROM urls WHERE expires_at < NOW()`).

**Q: How would you add a QR code for each short URL?**
> A: Use the `qrcode` npm library. Generate QR code as a base64 PNG on URL creation, store URL to access it, or generate on-demand (cheaper on storage). Return the QR code URL in the POST /shorten response.

**Q: How would you implement a dashboard showing click trends?**
> A: Query: `SELECT DATE(clicked_at) as day, COUNT(*) as clicks FROM clicks WHERE short_code = $1 AND clicked_at > NOW() - INTERVAL '30 days' GROUP BY day ORDER BY day`. The composite index on `(short_code, clicked_at)` makes this fast. Display with Recharts in React.

**Q: How do you prevent someone from shortening a malicious URL?**
> A: Integrate with a URL safety API (Google Safe Browsing API) on every POST /shorten. Check the domain against a blocklist. Validate the URL actually resolves (optional HEAD request). Flag suspicious patterns (IP addresses as hostnames, known phishing domains).

**Q: How would you add a "link preview" page before redirect?**
> A: Instead of direct 302 redirect, serve a simple HTML page at `sho.rt/preview/aB3k` showing the destination URL and asking if user wants to proceed. The actual redirect goes to a confirmation endpoint. Useful for fighting phishing, but adds friction.

**Q: What if two users shorten the same URL?**
> A: By default, we generate unique codes per request. For deduplication: `SELECT short_code FROM urls WHERE original_url = $1 AND user_id = $2`. If a match exists, return the existing code. This is a business decision — two users might want separate codes for the same URL to track their individual shares.

**Q: How would you implement an API key system?**
> A: Generate a cryptographically random 32-byte string (`crypto.randomBytes(32).toString('hex')`), store its hash in `users.api_key_hash`, return the raw key to the user once. On API calls, accept `X-API-Key: <key>` header, hash it, look up in DB. The user stores their key; you store the hash.
