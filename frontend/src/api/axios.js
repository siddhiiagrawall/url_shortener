// ─── Axios Instance ───────────────────────────────────────────────────────────
//
// WHY CREATE A CUSTOM AXIOS INSTANCE?
//   1. Set baseURL once — no need to write full URL in every component
//   2. Add request interceptor — auto-attach JWT to every request
//   3. Add response interceptor — handle 401s globally (auto logout)
//
// INTERCEPTORS:
//   Request interceptor: runs BEFORE every request is sent
//   Response interceptor: runs AFTER every response is received
// ─────────────────────────────────────────────────────────────────────────────

import axios from 'axios';

const api = axios.create({
  baseURL: '/api/v1', // Vite proxy forwards this to http://localhost:3000/api/v1
  headers: {
    'Content-Type': 'application/json',
  },
});

// ── Request Interceptor: Attach JWT ───────────────────────────────────────────
// Before EVERY request, read the token from memory and add it to the header.
// WHY NOT localStorage? localStorage is accessible to ANY JS on the page (XSS risk).
// We store the token in a module-level variable (in-memory) — safer.
let authToken = null;

export function setToken(token) {
  authToken = token; // Call this after login/register
}

export function clearToken() {
  authToken = null; // Call this on logout
}

api.interceptors.request.use(
  (config) => {
    if (authToken) {
      config.headers['Authorization'] = `Bearer ${authToken}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// ── Response Interceptor: Handle 401 ─────────────────────────────────────────
// If the server returns 401 (token expired/invalid), auto-logout the user.
api.interceptors.response.use(
  (response) => response, // Pass successful responses through unchanged
  (error) => {
    if (error.response?.status === 401) {
      // Token is expired or invalid — clear it and redirect to login
      clearToken();
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export default api;
