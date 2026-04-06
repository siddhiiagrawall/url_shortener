// ─── Dashboard Page ───────────────────────────────────────────────────────────
// Shows all of the user's shortened URLs with click counts and analytics chart.
// Uses Recharts for the click trend graph.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useCallback } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid
} from 'recharts';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';

export default function Dashboard() {
  const { user } = useAuth();
  const [urls, setUrls]           = useState([]);
  const [loading, setLoading]     = useState(true);
  const [analytics, setAnalytics] = useState(null);  // { short_code, clicks_by_day, ... }
  const [selectedCode, setSelectedCode] = useState(null);
  const [copiedCode, setCopiedCode]     = useState(null);
  const [deleteLoading, setDeleteLoading] = useState(null);

  // Fetch all user's URLs on mount
  // useEffect with [] = runs once after first render (like componentDidMount)
  const fetchUrls = useCallback(async () => {
    try {
      const res = await api.get('/me/urls');
      setUrls(res.data.data.urls);
    } catch (err) {
      console.error('Failed to fetch URLs:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchUrls(); }, [fetchUrls]);

  // Fetch analytics for a specific URL when user clicks "Stats"
  async function fetchAnalytics(code) {
    if (selectedCode === code) {
      // Toggle off if same code clicked again
      setSelectedCode(null);
      setAnalytics(null);
      return;
    }
    setSelectedCode(code);
    setAnalytics(null); // Clear old data
    try {
      const res = await api.get(`/me/urls/${code}/analytics`);
      setAnalytics(res.data.data);
    } catch (err) {
      console.error('Failed to fetch analytics:', err);
    }
  }

  async function handleDelete(code) {
    if (!confirm(`Delete link "/${code}"? This cannot be undone.`)) return;
    setDeleteLoading(code);
    try {
      await api.delete(`/me/urls/${code}`);
      setUrls(prev => prev.filter(u => u.short_code !== code));
      if (selectedCode === code) { setSelectedCode(null); setAnalytics(null); }
    } catch (err) {
      alert(err.response?.data?.error?.message || 'Delete failed.');
    } finally {
      setDeleteLoading(null);
    }
  }

  async function handleCopy(shortCode) {
    const shortUrl = `${window.location.origin}/${shortCode}`;
    await navigator.clipboard.writeText(shortUrl);
    setCopiedCode(shortCode);
    setTimeout(() => setCopiedCode(null), 2000);
  }

  // Derived stats
  const totalClicks = urls.reduce((sum, u) => sum + (u.click_count || 0), 0);

  return (
    <main className="page">
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <div>
          <h1 style={{ fontSize: '1.8rem', fontWeight: 700 }}>My Links</h1>
          <p style={{ color: 'var(--muted)', marginTop: '0.25rem' }}>
            Manage and track all your shortened URLs
          </p>
        </div>
        <span className="badge" style={{ fontSize: '0.8rem', padding: '0.4rem 0.8rem' }}>
          {user?.plan?.toUpperCase()} plan
        </span>
      </div>

      {/* Stats overview */}
      <div className="grid-3" style={{ marginBottom: '2rem' }}>
        <div className="card stat-card">
          <div className="stat-number">{urls.length}</div>
          <div className="stat-label">Total Links</div>
        </div>
        <div className="card stat-card">
          <div className="stat-number">{totalClicks.toLocaleString()}</div>
          <div className="stat-label">Total Clicks</div>
        </div>
        <div className="card stat-card">
          <div className="stat-number">
            {urls.length ? Math.round(totalClicks / urls.length) : 0}
          </div>
          <div className="stat-label">Avg Clicks / Link</div>
        </div>
      </div>

      {/* Analytics Chart (shown when user selects a URL) */}
      {selectedCode && (
        <div className="card" style={{ marginBottom: '2rem' }}>
          <h3 style={{ marginBottom: '1rem', fontSize: '1rem' }}>
            📈 Clicks for <span style={{ color: 'var(--accent2)', fontFamily: 'monospace' }}>/{selectedCode}</span>
            <span style={{ color: 'var(--muted)', fontWeight: 400 }}> (last 30 days)</span>
          </h3>
          {!analytics ? (
            <div className="spinner" />
          ) : analytics.clicks_by_day.length === 0 ? (
            <p style={{ color: 'var(--muted)', textAlign: 'center', padding: '2rem 0' }}>
              No click data yet. Share your link!
            </p>
          ) : (
            <>
              {/* Recharts AreaChart — shows click trend over time */}
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={analytics.clicks_by_day}>
                  <defs>
                    <linearGradient id="clickGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#7c3aed" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#7c3aed" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 11 }} />
                  <YAxis tick={{ fill: '#64748b', fontSize: 11 }} />
                  <Tooltip
                    contentStyle={{ background: '#1e1e2e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8 }}
                    itemStyle={{ color: '#e2e8f0' }}
                  />
                  <Area type="monotone" dataKey="count" stroke="#7c3aed" fill="url(#clickGrad)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>

              {/* Top countries */}
              {analytics.top_countries.length > 0 && (
                <div style={{ marginTop: '1rem' }}>
                  <div style={{ fontSize: '0.8rem', color: 'var(--muted)', marginBottom: '0.5rem' }}>Top Countries</div>
                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    {analytics.top_countries.map(c => (
                      <span key={c.country} className="badge">
                        {c.country} — {c.count}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* URL List */}
      {loading ? (
        <div className="spinner" style={{ marginTop: '3rem' }} />
      ) : urls.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '3rem' }}>
          <p style={{ color: 'var(--muted)', marginBottom: '1rem' }}>
            You haven't created any short links yet.
          </p>
          <a href="/" className="btn btn-primary">⚡ Create your first link</a>
        </div>
      ) : (
        <div>
          {urls.map(url => (
            <div key={url.id} className="url-row">
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="short-code">/{url.short_code}</div>
                <div className="original" title={url.original_url}>{url.original_url}</div>
              </div>
              <span className="click-count">
                🖱️ {(url.click_count || 0).toLocaleString()} clicks
              </span>
              <button
                className={`btn btn-ghost ${copiedCode === url.short_code ? 'copy-success' : ''}`}
                style={{ fontSize: '0.8rem', padding: '0.4rem 0.75rem' }}
                onClick={() => handleCopy(url.short_code)}
              >
                {copiedCode === url.short_code ? '✓' : '📋'}
              </button>
              <button
                className={`btn btn-ghost ${selectedCode === url.short_code ? 'btn-outline' : ''}`}
                style={{ fontSize: '0.8rem', padding: '0.4rem 0.75rem' }}
                onClick={() => fetchAnalytics(url.short_code)}
              >
                📈 Stats
              </button>
              <button
                className="btn btn-danger"
                style={{ fontSize: '0.8rem', padding: '0.4rem 0.75rem' }}
                onClick={() => handleDelete(url.short_code)}
                disabled={deleteLoading === url.short_code}
              >
                {deleteLoading === url.short_code
                  ? <span className="spinner" style={{ width: 12, height: 12 }} />
                  : '🗑️'}
              </button>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
