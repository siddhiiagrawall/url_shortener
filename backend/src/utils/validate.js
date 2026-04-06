// ─── URL Validation ───────────────────────────────────────────────────────────
//
// WHY validate at all?
//   - Garbage in = garbage out. If we store invalid URLs, redirects will 404.
//   - Security: prevents storing javascript: or data: URIs (XSS vectors).
//   - UX: give users clear errors instead of mysterious failures.
//
// WHY use the 'validator' library instead of a regex?
//   URL validation regex is notoriously complex and error-prone.
//   'validator' is battle-tested by millions of projects.
// ─────────────────────────────────────────────────────────────────────────────

const validator = require('validator');

/**
 * Validate a URL for shortening.
 * Returns { valid: true } or { valid: false, reason: "..." }
 */
function validateUrl(url) {
  // Check 1: Is it even a string?
  if (typeof url !== 'string' || url.trim().length === 0) {
    return { valid: false, reason: 'URL is required.' };
  }

  // Check 2: Is it a valid URL format?
  // The options object enforces:
  //   - require_protocol: must start with http:// or https://
  //   - require_tld: must have a real top-level domain (no "http://test")
  const isValid = validator.isURL(url, {
    require_protocol: true,
    require_tld: true,
    protocols: ['http', 'https'], // Block ftp://, javascript://, etc.
  });

  if (!isValid) {
    return { valid: false, reason: 'Please provide a valid http or https URL.' };
  }

  // Check 3: Block URLs pointing to ourselves (infinite redirect loop)
  const baseUrl = process.env.BASE_URL || '';
  if (baseUrl && url.startsWith(baseUrl)) {
    return { valid: false, reason: 'Cannot shorten a URL that points to this service.' };
  }

  // Check 4: Max length check — TEXT in Postgres can hold unlimited, but sanity check
  if (url.length > 2048) {
    return { valid: false, reason: 'URL is too long (max 2048 characters).' };
  }

  return { valid: true };
}

/**
 * Validate a custom short code.
 * Rules: 3-10 chars, alphanumeric + hyphens + underscores only.
 */
function validateCustomCode(code) {
  if (typeof code !== 'string') {
    return { valid: false, reason: 'Custom code must be a string.' };
  }

  if (code.length < 3 || code.length > 10) {
    return { valid: false, reason: 'Custom code must be 3–10 characters long.' };
  }

  // Only allow URL-safe characters
  if (!/^[a-zA-Z0-9_-]+$/.test(code)) {
    return { valid: false, reason: 'Custom code can only contain letters, numbers, hyphens, and underscores.' };
  }

  // Block reserved words that conflict with our routes
  const reserved = ['api', 'docs', 'health', 'admin', 'login', 'register', 'dashboard'];
  if (reserved.includes(code.toLowerCase())) {
    return { valid: false, reason: `"${code}" is a reserved word and cannot be used as a code.` };
  }

  return { valid: true };
}

module.exports = { validateUrl, validateCustomCode };
