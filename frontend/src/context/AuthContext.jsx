// ─── Auth Context ─────────────────────────────────────────────────────────────
//
// WHAT IS REACT CONTEXT?
//   A way to share state across the entire component tree without prop drilling.
//   "Prop drilling" = passing props through many intermediate components that don't need them.
//   Context = a global state that any component can read or update.
//
// WHY USE CONTEXT FOR AUTH?
//   The logged-in user's info (name, plan) is needed in:
//   - Navbar (show username)
//   - Dashboard (fetch user's links)
//   - ProtectedRoute (decide if redirect to login)
//   Without context, you'd pass user as a prop through every component.
// ─────────────────────────────────────────────────────────────────────────────

import { createContext, useContext, useState, useCallback } from 'react';
import api, { setToken, clearToken } from '../api/axios';

// 1. Create the context — this is the "channel" components subscribe to
const AuthContext = createContext(null);

// 2. Provider component — wraps the app, holds the state, provides it to children
export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null);   // null = not logged in
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(null);

  const login = useCallback(async ({ email, password }) => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.post('/auth/login', { email, password });
      const { user, token } = res.data.data;
      setToken(token);  // Store in memory — NOT localStorage
      setUser(user);
      return true;
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Login failed.');
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  const register = useCallback(async ({ email, password }) => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.post('/auth/register', { email, password });
      const { user, token } = res.data.data;
      setToken(token);
      setUser(user);
      return true;
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Registration failed.');
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(() => {
    clearToken();
    setUser(null);
  }, []);

  // The value object is what all consuming components receive
  const value = { user, loading, error, login, register, logout, isLoggedIn: !!user };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// 3. Custom hook — cleaner than calling useContext(AuthContext) in every component
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
}
