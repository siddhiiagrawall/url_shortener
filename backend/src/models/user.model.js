// ─── User Model ───────────────────────────────────────────────────────────────
//
// WHAT IS A MODEL?
//   The model layer is responsible for ALL database interactions.
//   It knows SQL. Nothing outside this file should write raw SQL.
//
// WHY ISOLATE SQL HERE?
//   If you ever switch databases (Postgres → MySQL), you only change the models.
//   Controllers and services are completely unaffected.
//
// PARAMETERIZED QUERIES ($1, $2, ...):
//   We NEVER concatenate user input into SQL strings. That would allow SQL injection.
//   Instead we pass values separately: pool.query("... WHERE email = $1", [email])
//   The pg driver escapes the values safely before sending to Postgres.
// ─────────────────────────────────────────────────────────────────────────────

const pool = require('../config/db');

const UserModel = {
  /**
   * Find a user by their email address.
   * Used during login to fetch the user and compare their password hash.
   */
  async findByEmail(email) {
    const result = await pool.query(
      'SELECT * FROM users WHERE email = $1',
      [email] // $1 is safely replaced with the email value — not concatenated!
    );
    return result.rows[0] || null; // Return the first (and only) match, or null
  },

  /**
   * Find a user by their UUID.
   * Used when decoding a JWT — the token contains user_id, we fetch full user.
   */
  async findById(id) {
    const result = await pool.query(
      'SELECT id, email, plan, created_at FROM users WHERE id = $1',
      [id]
      // Notice: we select specific columns, NOT *
      // WHY? We never want to accidentally return the password_hash to the client
    );
    return result.rows[0] || null;
  },

  /**
   * Create a new user.
   * RETURNING *: Postgres gives us the inserted row back (including auto-generated id).
   * WHY RETURNING? Without it, we'd need a second query to fetch the new user.
   */
  async create({ email, passwordHash }) {
    const result = await pool.query(
      `INSERT INTO users (email, password_hash)
       VALUES ($1, $2)
       RETURNING id, email, plan, created_at`,
      [email, passwordHash]
    );
    return result.rows[0];
  },

  /**
   * Update the last_login_at timestamp.
   * Good practice: helps detect stale/inactive accounts.
   */
  async updateLastLogin(id) {
    await pool.query(
      'UPDATE users SET last_login_at = NOW() WHERE id = $1',
      [id]
    );
  },
};

module.exports = UserModel;
