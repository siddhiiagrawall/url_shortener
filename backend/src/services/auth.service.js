// ─── Auth Service ─────────────────────────────────────────────────────────────
//
// Business logic for registration and login.
// This layer KNOWS business rules but does NOT know about HTTP (no req/res here).
//
// TOOLS USED:
//   bcryptjs  → password hashing (slow by design — prevents brute force)
//   jsonwebtoken → JWT creation and verification
// ─────────────────────────────────────────────────────────────────────────────

const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const UserModel = require('../models/user.model');

const AuthService = {
  /**
   * Register a new user.
   *
   * PASSWORD HASHING WITH BCRYPT:
   *   bcrypt.hash(password, rounds) is INTENTIONALLY SLOW.
   *   With 12 rounds, it takes ~250ms to hash ONE password.
   *   An attacker trying to brute-force would need 250ms per attempt.
   *   1 million attempts = 250,000 seconds = ~3 days. Effective deterrent.
   *   The "rounds" value is stored inside the hash, so you can increase it later
   *   and old hashes still work (they just use their original round count).
   */
  async register({ email, password }) {
    // 1. Normalize email: lowercase, trim whitespace
    const normalizedEmail = email.toLowerCase().trim();

    // 2. Check if email already exists
    const existing = await UserModel.findByEmail(normalizedEmail);
    if (existing) {
      const err = new Error('An account with this email already exists.');
      err.statusCode = 409;
      err.code = 'EMAIL_TAKEN';
      throw err;
    }

    // 3. Hash the password
    //    NEVER store plaintext. Even if your DB is breached, bcrypt hashes are useless to attackers.
    const rounds = parseInt(process.env.BCRYPT_ROUNDS) || 12;
    const passwordHash = await bcrypt.hash(password, rounds);

    // 4. Save user to DB
    const user = await UserModel.create({ email: normalizedEmail, passwordHash });

    // 5. Return user + JWT token (so they're logged in immediately after registering)
    const token = AuthService._createToken(user);
    return { user, token };
  },

  /**
   * Log in an existing user.
   *
   * TIMING ATTACK PREVENTION:
   *   We always call bcrypt.compare() even if the user doesn't exist.
   *   WHY? If we returned immediately on "user not found", attackers could
   *   measure response time to determine if an email is registered.
   *   Consistently slow responses reveal nothing.
   */
  async login({ email, password }) {
    const normalizedEmail = email.toLowerCase().trim();

    // 1. Find user (may be null)
    const user = await UserModel.findByEmail(normalizedEmail);

    // 2. Always compare — if user is null, compare against a dummy hash
    //    bcrypt.compare returns false for the dummy, so we still reject.
    const dummyHash = '$2b$12$invalidhashfortimingnormalization';
    const hashToCompare = user ? user.password_hash : dummyHash;
    const passwordMatch = await bcrypt.compare(password, hashToCompare);

    if (!user || !passwordMatch) {
      // Return a generic message — never tell them which part was wrong
      // (telling "email not found" helps attackers enumerate valid emails)
      const err = new Error('Invalid email or password.');
      err.statusCode = 401;
      err.code = 'INVALID_CREDENTIALS';
      throw err;
    }

    // 3. Update last login timestamp (async, non-blocking)
    UserModel.updateLastLogin(user.id).catch(() => {}); // Fire and forget

    // 4. Return JWT
    const token = AuthService._createToken(user);
    return { user: { id: user.id, email: user.email, plan: user.plan }, token };
  },

  /**
   * Create a signed JWT token.
   *
   * JWT STRUCTURE:
   *   Header.Payload.Signature
   *   The server signs with JWT_SECRET. Only the server can create valid tokens.
   *   Anyone can READ the payload (it's just base64), but cannot MODIFY it
   *   without invalidating the signature.
   *
   * STATELESS AUTH:
   *   We don't store sessions anywhere. The token itself is the proof of identity.
   *   Any server that knows JWT_SECRET can verify any token — perfect for scale-out.
   */
  _createToken(user) {
    return jwt.sign(
      {
        sub: user.id,         // "subject" — standard JWT claim for user identifier
        email: user.email,
        plan: user.plan,
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );
  },
};

module.exports = AuthService;
