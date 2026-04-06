// ─── Routes: URL Shortening ───────────────────────────────────────────────────
const express = require('express');
const router  = express.Router();
const UrlController = require('../controllers/url.controller');
const { authenticate, optionalAuth } = require('../middleware/authenticate');
const { shortenLimiter } = require('../middleware/rateLimiter');

// POST /api/v1/shorten
// optionalAuth: logged-in users get the URL saved to their account; anonymous get a code too
// shortenLimiter: prevents spam (10 req/min for anon, 50 for free users)
router.post('/shorten', optionalAuth, shortenLimiter, UrlController.shorten);

// GET /api/v1/me/urls — list all URLs for the logged-in user
router.get('/me/urls', authenticate, UrlController.listMyUrls);

// DELETE /api/v1/me/urls/:code — soft-delete a URL (must own it)
router.delete('/me/urls/:code', authenticate, UrlController.deleteUrl);

// GET /api/v1/me/urls/:code/analytics
router.get('/me/urls/:code/analytics', authenticate, UrlController.getAnalytics);

module.exports = router;
