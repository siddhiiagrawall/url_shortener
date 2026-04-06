// ─── Express Application Bootstrap ───────────────────────────────────────────
//
// This file wires everything together:
//   1. Load environment variables
//   2. Create Express app
//   3. Register global middleware (CORS, JSON parsing, etc.)
//   4. Mount route files
//   5. Mount global error handler (MUST be last)
//
// WHY SEPARATE app.js FROM server.js?
//   app.js exports the Express app — useful for testing (import without starting server).
//   server.js (or the bottom of this file) starts listening on a port.
// ─────────────────────────────────────────────────────────────────────────────

require('dotenv').config(); // Must be first — loads .env before anything else reads process.env

const express     = require('express');
const cors        = require('cors');
const swaggerUi   = require('swagger-ui-express');
const YAML        = require('yamljs');
const path        = require('path');

const authRoutes  = require('./routes/auth.routes');
const urlRoutes   = require('./routes/url.routes');
const { redirectLimiter } = require('./middleware/rateLimiter');
const RedirectController  = require('./controllers/redirect.controller');
const errorHandler        = require('./middleware/errorHandler');

const app = express();

// ── 1. CORS ──────────────────────────────────────────────────────────────────
// CORS = Cross-Origin Resource Sharing
// Browsers block JS from calling APIs on a different domain by default.
// Our React frontend (localhost:5173) calling our API (localhost:3000) would be blocked.
// We explicitly allow our frontend's origin.
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true, // Allow cookies/auth headers
}));

// ── 2. Body Parsing ───────────────────────────────────────────────────────────
// Parse incoming JSON request bodies so req.body is available
app.use(express.json({ limit: '10kb' })); // Limit body size to prevent DoS

// ── 3. Trust Proxy ───────────────────────────────────────────────────────────
// When behind NGINX/load balancer, req.ip would be the proxy's IP, not the user's.
// This setting tells Express to trust the X-Forwarded-For header from the proxy.
app.set('trust proxy', 1);

// ── 4. Health Check ───────────────────────────────────────────────────────────
// Simple endpoint for load balancers and Docker health checks to call.
// Returns 200 if the server is alive. No auth needed.
app.get('/api/v1/health', (req, res) => {
  res.json({ success: true, data: { status: 'ok', timestamp: new Date().toISOString() } });
});

// ── 5. API Routes ─────────────────────────────────────────────────────────────
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1',      urlRoutes);

// ── 6. Swagger UI ─────────────────────────────────────────────────────────────
// Interactive API documentation at /docs
// Shows interviewers you know how to document APIs for other developers
try {
  const swaggerDoc = YAML.load(path.join(__dirname, '../swagger.yaml'));
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerDoc));
  console.log('📚 Swagger docs available at /docs');
} catch {
  console.log('ℹ️  No swagger.yaml found, skipping docs');
}

// ── 7. Redirect Route ─────────────────────────────────────────────────────────
// This MUST come after API routes so "/:code" doesn't catch "/api/..." paths
// Order matters in Express — routes are matched in registration order.
app.get('/:code', redirectLimiter, RedirectController.redirect);

// ── 8. 404 Handler ────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: { code: 'NOT_FOUND', message: 'Endpoint not found.' },
  });
});

// ── 9. Global Error Handler (MUST be last middleware) ─────────────────────────
app.use(errorHandler);

// ── 10. Start Server ──────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT} in ${process.env.NODE_ENV} mode`);
  console.log(`📖 API docs: http://localhost:${PORT}/docs`);
});

module.exports = app; // Export for testing
