// ─── Routes: Auth ─────────────────────────────────────────────────────────────
const express = require('express');
const router  = express.Router();
const AuthController = require('../controllers/auth.controller');
const { authenticate } = require('../middleware/authenticate');

// POST /api/v1/auth/register
router.post('/register', AuthController.register);

// POST /api/v1/auth/login
router.post('/login', AuthController.login);

// GET /api/v1/auth/me  — requires valid JWT
router.get('/me', authenticate, AuthController.me);

module.exports = router;
