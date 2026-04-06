// ─── Protected Route Component ────────────────────────────────────────────────
//
// WHY A WRAPPER COMPONENT FOR AUTH GUARD?
//   Instead of checking "is logged in?" in every protected page,
//   we wrap the page in ProtectedRoute. It handles the redirect once.
//   DRY principle — one place to update if auth logic changes.
// ─────────────────────────────────────────────────────────────────────────────

import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function ProtectedRoute({ children }) {
  const { isLoggedIn } = useAuth();

  if (!isLoggedIn) {
    // Replace: true means the /login page replaces the current history entry
    // So pressing "back" from login doesn't go back to the protected page
    return <Navigate to="/login" replace />;
  }

  return children;
}
