import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Register() {
  const { register, loading, error } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: '', password: '' });
  const [clientError, setClientError] = useState('');

  function handleChange(e) {
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setClientError('');

    // Client-side validation before hitting the API
    // WHY do this? Faster feedback than a server round-trip.
    // The server ALSO validates — never trust client-only validation.
    if (form.password.length < 8) {
      return setClientError('Password must be at least 8 characters.');
    }

    const ok = await register(form);
    if (ok) navigate('/dashboard');
  }

  const displayError = clientError || error;

  return (
    <main className="page page-center">
      <div style={{ width: '100%', maxWidth: '400px' }}>
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <h2 style={{ fontSize: '1.8rem', fontWeight: 700 }}>Create your account</h2>
          <p style={{ color: 'var(--muted)', marginTop: '0.5rem' }}>
            Free forever. No credit card required.
          </p>
        </div>

        <div className="card">
          <form onSubmit={handleSubmit}>
            {displayError && <div className="alert alert-error">{displayError}</div>}

            <div className="form-group">
              <label htmlFor="email">Email</label>
              <input id="email" className="input" type="email" name="email"
                placeholder="you@example.com" value={form.email}
                onChange={handleChange} required autoComplete="email" />
            </div>

            <div className="form-group">
              <label htmlFor="password">
                Password <span style={{ color: 'var(--muted)', fontWeight: 400 }}>(min 8 chars)</span>
              </label>
              <input id="password" className="input" type="password" name="password"
                placeholder="••••••••" value={form.password}
                onChange={handleChange} required autoComplete="new-password" />
            </div>

            <button className="btn btn-primary" type="submit" disabled={loading}
              style={{ width: '100%', justifyContent: 'center', marginTop: '0.5rem' }}>
              {loading ? <span className="spinner" style={{ width: 16, height: 16 }} /> : 'Create Account'}
            </button>
          </form>
        </div>

        <p style={{ textAlign: 'center', marginTop: '1.5rem', color: 'var(--muted)', fontSize: '0.9rem' }}>
          Already have an account?{' '}
          <Link to="/login" style={{ color: 'var(--accent)' }}>Sign in</Link>
        </p>
      </div>
    </main>
  );
}
