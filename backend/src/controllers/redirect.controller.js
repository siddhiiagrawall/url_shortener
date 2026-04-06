// ─── Redirect Controller ──────────────────────────────────────────────────────
//
// This is the HOT PATH — the most frequently called endpoint.
// It must be as fast as possible.
//
// FLOW:
//   1. Look up URL (Redis cache → Postgres fallback)
//   2. Send HTTP 302 redirect immediately  ← USER GETS RESPONSE HERE
//   3. Push click event to Redis Stream    ← HAPPENS AFTER, non-blocking
//
// WHY 302 NOT 301?
//   301 = Permanent redirect. Browser caches it FOREVER. Never hits our server again.
//   302 = Temporary redirect. Browser checks our server every time.
//   We NEED every click to reach us so we can count it. 302 is the only choice.
// ─────────────────────────────────────────────────────────────────────────────

const UrlService = require('../services/url.service');

const RedirectController = {
  async redirect(req, res, next) {
    try {
      const { code } = req.params;

      // Resolve the short code → original URL (cache-aside)
      const originalUrl = await UrlService.resolve(code);

      if (!originalUrl) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Short URL not found or has expired.' },
        });
      }

      // ── Send the redirect FIRST — user experience priority ───────────────
      // 302: Temporary redirect. Browser will always check us on future clicks.
      res.redirect(302, originalUrl);

      // ── Push analytics AFTER the response is sent ────────────────────────
      // setImmediate() schedules this to run after the current event loop tick.
      // The response is already sent to the client by this point.
      // WHY setImmediate? Ensures the redirect response is flushed before we do more work.
      setImmediate(() => {
        UrlService.pushClickEvent({
          shortCode: code,
          ip: req.ip,
          userAgent: req.headers['user-agent'],
          referer: req.headers['referer'] || null,
        }).catch(() => {}); // Silently ignore analytics errors — redirect already succeeded
      });

    } catch (err) {
      next(err);
    }
  },
};

module.exports = RedirectController;
