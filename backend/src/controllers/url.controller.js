// ─── URL / Shorten Controller ─────────────────────────────────────────────────
const UrlService = require('../services/url.service');
const UrlModel   = require('../models/url.model');
const CacheService = require('../services/cache.service');

const UrlController = {
  /**
   * POST /api/v1/shorten
   * Create a short URL. Auth is optional — anonymous users can shorten too.
   */
  async shorten(req, res, next) {
    try {
      const { original_url, custom_code, expires_in_days } = req.body;

      const result = await UrlService.shorten({
        originalUrl: original_url,
        customCode: custom_code || null,
        expiresInDays: expires_in_days || null,
        userId: req.user?.id || null, // req.user is set by optionalAuth middleware
      });

      const statusCode = result.is_duplicate ? 200 : 201;
      res.status(statusCode).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  },

  /**
   * GET /api/v1/me/urls
   * Get all shortened URLs for the authenticated user.
   */
  async listMyUrls(req, res, next) {
    try {
      const urls = await UrlModel.findByUserId(req.user.id);
      res.json({ success: true, data: { urls } });
    } catch (err) {
      next(err);
    }
  },

  /**
   * DELETE /api/v1/me/urls/:code
   * Soft-delete a URL. Only the owner can delete their links.
   */
  async deleteUrl(req, res, next) {
    try {
      const { code } = req.params;
      const deleted = await UrlModel.deactivate(code, req.user.id);

      if (!deleted) {
        // Could be "not found" OR "belongs to another user" — we return the same error
        // WHY? Don't tell attackers which codes exist. 404 for both cases.
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Short URL not found.' },
        });
      }

      // Invalidate the cache so deleted links stop working immediately
      await CacheService.deleteUrl(code);

      res.json({ success: true, data: { message: 'Link deleted successfully.' } });
    } catch (err) {
      next(err);
    }
  },

  /**
   * GET /api/v1/me/urls/:code/analytics
   */
  async getAnalytics(req, res, next) {
    try {
      const { code } = req.params;
      const analytics = await UrlModel.getAnalytics(code, req.user.id);

      if (!analytics) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Short URL not found.' },
        });
      }

      res.json({ success: true, data: analytics });
    } catch (err) {
      next(err);
    }
  },
};

module.exports = UrlController;
