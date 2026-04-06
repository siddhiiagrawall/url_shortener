// ─── App.jsx — Root Component & Router ───────────────────────────────────────
//
// REACT ROUTER v6:
//   Handles client-side navigation — URL changes without full page reload.
//   BrowserRouter: uses the History API to sync URL with the UI state.
//   Routes + Route: declarative route matching.
//
// PROTECTED ROUTES:
//   Some pages (Dashboard) require the user to be logged in.
//   ProtectedRoute checks auth status and redirects to /login if not authenticated.
// ─────────────────────────────────────────────────────────────────────────────

import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import Navbar from './components/Navbar';
import ProtectedRoute from './components/ProtectedRoute';
import Home from './pages/Home';
import Login from './pages/Login';
import Register from './pages/Register';
import Dashboard from './pages/Dashboard';

export default function App() {
  return (
    // AuthProvider wraps everything so any component can access auth state
    <AuthProvider>
      <BrowserRouter>
        <Navbar />
        <Routes>
          {/* Public routes — anyone can access */}
          <Route path="/"         element={<Home />} />
          <Route path="/login"    element={<Login />} />
          <Route path="/register" element={<Register />} />

          {/* Protected route — redirect to /login if not authenticated */}
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <Dashboard />
              </ProtectedRoute>
            }
          />

          {/* Catch-all: redirect unknown paths to home */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
