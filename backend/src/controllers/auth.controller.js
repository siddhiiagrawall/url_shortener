// ─── Auth Controller ──────────────────────────────────────────────────────────
//
// WHAT IS A CONTROLLER?
//   The controller's ONLY job: parse HTTP request → call service → format HTTP response.
//   It should be thin — no business logic. All real work is in the service.
//
// WHY SEPARATE CONTROLLER FROM SERVICE?
//   If you wanted to add a CLI (command-line interface) or a GraphQL layer,
//   you'd call the same service — only the controller changes.
// ─────────────────────────────────────────────────────────────────────────────

const AuthService = require('../services/auth.service');

const AuthController = {
  async register(req, res, next) {
    try {
      // Destructure body — only take what we need (ignore extra fields)
      const { email, password } = req.body;

      // Basic presence check (deeper validation in the service)
      if (!email || !password) {
        return res.status(400).json({
          success: false,
          error: { code: 'MISSING_FIELDS', message: 'Email and password are required.' },
        });
      }

      if (password.length < 8) {
        return res.status(400).json({
          success: false,
          error: { code: 'WEAK_PASSWORD', message: 'Password must be at least 8 characters.' },
        });
      }

      const { user, token } = await AuthService.register({ email, password });

      // 201 Created — standard for successfully creating a resource
      res.status(201).json({
        success: true,
        data: {
          user: { id: user.id, email: user.email, plan: user.plan },
          token, // Client stores this and sends it with every protected request
        },
      });
    } catch (err) {
      next(err); // Pass to global error handler
    }
  },

  async login(req, res, next) {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        return res.status(400).json({
          success: false,
          error: { code: 'MISSING_FIELDS', message: 'Email and password are required.' },
        });
      }

      const { user, token } = await AuthService.login({ email, password });

      res.status(200).json({
        success: true,
        data: { user, token },
      });
    } catch (err) {
      next(err);
    }
  },

  // Get current user's profile — req.user is set by authenticate middleware
  async me(req, res) {
    res.json({
      success: true,
      data: { user: req.user },
    });
  },
};

module.exports = AuthController;
