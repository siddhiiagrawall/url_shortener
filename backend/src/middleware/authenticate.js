// ─── JWT Authentication Middleware ────────────────────────────────────────────
//
// WHAT IS MIDDLEWARE?
//   A function that runs BETWEEN receiving a request and your controller.
//   Express chains middleware with next() — call next() to pass to the next handler.
//   If you don't call next(), the request stops here.
//
// HOW JWT VERIFICATION WORKS:
//   1. Client sends: Authorization: Bearer eyJhbGc...
//   2. We extract the token from the header.
//   3. jwt.verify() checks:
//      a. Is the signature valid? (was it signed with our JWT_SECRET?)
//      b. Is the token expired? (is exp in the future?)
//   4. If valid, we attach the decoded payload to req.user.
//   5. If invalid, we return 401 — the request goes no further.
//
// WHY IS THIS STATELESS?
//   We DON'T query the database. The token itself proves identity.
//   Any server with the same JWT_SECRET can verify any token — scales for free.
// ─────────────────────────────────────────────────────────────────────────────

const jwt = require('jsonwebtoken');

/**
 * Strict auth: request MUST have a valid JWT. Reject if not.
 */
function authenticate(req, res, next) {
  // Extract token from the Authorization header
  const authHeader = req.headers['authorization'];

  // Format must be: "Bearer <token>"
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Authentication token required.' },
    });
  }

  const token = authHeader.split(' ')[1]; // Get the part after "Bearer "

  try {
    // verify() throws if the token is invalid or expired
    const payload = jwt.verify(token, process.env.JWT_SECRET);

    // Attach decoded user info to the request — available in all downstream handlers
    req.user = {
      id: payload.sub,    // "sub" is the standard JWT claim for the subject (user id)
      email: payload.email,
      plan: payload.plan,
    };

    next(); // Token is valid — proceed to controller
  } catch (err) {
    // JsonWebTokenError: signature mismatch
    // TokenExpiredError: token past its exp date
    return res.status(401).json({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token.' },
    });
  }
}

/**
 * Optional auth: attach user if token exists, but don't reject if it doesn't.
 * Used on POST /shorten — anonymous users can shorten too, but logged-in users
 * get their URLs saved to their account.
 */
function optionalAuth(req, res, next) {
  const authHeader = req.headers['authorization'];

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    req.user = null; // No token — anonymous request
    return next();
  }

  const token = authHeader.split(' ')[1];

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = { id: payload.sub, email: payload.email, plan: payload.plan };
  } catch {
    req.user = null; // Invalid token — treat as anonymous, don't reject
  }

  next();
}

module.exports = { authenticate, optionalAuth };
