// ─── Home Page ────────────────────────────────────────────────────────────────
// The main landing page with the URL shortening form.
// Available to both anonymous and logged-in users.
// ─────────────────────────────────────────────────────────────────────────────

import { useState } from 'react';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';
import { Link } from 'react-router-dom';

export default function Home() {
  const { isLoggedIn } = useAuth();
  const [url, setUrl]             = useState('');
  const [customCode, setCustomCode] = useState('');
  const [result, setResult]       = useState(null);  // { short_url, short_code }
  const [error, setError]         = useState('');
  const [loading, setLoading]     = useState(false);
  const [copied, setCopied]       = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  async function handleShorten(e) {
    e.preventDefault(); // Prevent default form submission (page reload)
    if (!url.trim()) return;

    setLoading(true);
    setError('');
    setResult(null);

    try {
      const res = await api.post('/shorten', {
        original_url: url.trim(),
        custom_code: customCode.trim() || undefined,
      });
      setResult(res.data.data);
      setUrl('');
      setCustomCode('');
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  }

  async function handleCopy() {
    await navigator.clipboard.writeText(result.short_url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000); // Reset after 2 seconds
  }

  return (
    <main className="page page-center">
      <div style={{ width: '100%', maxWidth: '640px' }}>
        {/* Hero */}
        <div className="hero">
          <h1>Shorten smarter,<br />share faster ⚡</h1>
          <p>Paste a long URL below and get a short, shareable link instantly.</p>
        </div>

        {/* Shorten Form */}
        <div className="card" style={{ marginBottom: '1rem' }}>
          <form onSubmit={handleShorten}>
            <div className="shorten-form" style={{ marginBottom: '0.75rem' }}>
              <input
                className="input"
                type="url"
                placeholder="https://your-very-long-url.com/..."
                value={url}
                onChange={e => setUrl(e.target.value)}
                required
              />
              <button className="btn btn-primary" type="submit" disabled={loading}>
                {loading ? <span className="spinner" style={{ width: 16, height: 16 }} /> : '⚡ Snip it'}
              </button>
            </div>

            {/* Advanced options (custom code) */}
            <button
              type="button"
              className="btn btn-ghost"
              style={{ fontSize: '0.8rem', padding: '0.25rem 0' }}
              onClick={() => setShowAdvanced(v => !v)}
            >
              {showAdvanced ? '▲ Hide' : '▼ Custom alias (optional)'}
            </button>

            {showAdvanced && (
              <div className="form-group" style={{ marginTop: '0.75rem' }}>
                <label>Custom short code</label>
                <input
                  className="input"
                  type="text"
                  placeholder="my-brand (3–10 chars)"
                  value={customCode}
                  onChange={e => setCustomCode(e.target.value)}
                  maxLength={10}
                />
              </div>
            )}
          </form>
        </div>

        {/* Error message */}
        {error && <div className="alert alert-error">⚠️ {error}</div>}

        {/* Success result */}
        {result && (
          <div className="card alert-success" style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '0.8rem', color: 'var(--muted)', marginBottom: '0.25rem' }}>
                {result.is_duplicate ? 'You already shortened this URL:' : 'Your short link is ready:'}
              </div>
              <a href={result.short_url} target="_blank" rel="noopener noreferrer"
                 style={{ color: 'var(--accent2)', fontWeight: 600, fontSize: '1.1rem' }}>
                {result.short_url}
              </a>
            </div>
            <button
              onClick={handleCopy}
              className={`btn btn-outline ${copied ? 'copy-success' : ''}`}
            >
              {copied ? '✓ Copied!' : '📋 Copy'}
            </button>
          </div>
        )}

        {/* CTA for non-logged-in users */}
        {!isLoggedIn && (
          <p style={{ textAlign: 'center', marginTop: '2rem', color: 'var(--muted)', fontSize: '0.9rem' }}>
            <Link to="/register" style={{ color: 'var(--accent)' }}>Create a free account</Link>
            {' '}to track clicks and manage your links.
          </p>
        )}
      </div>
    </main>
  );
}
