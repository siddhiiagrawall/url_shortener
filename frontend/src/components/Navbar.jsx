import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Navbar() {
  const { isLoggedIn, user, logout } = useAuth();
  const navigate = useNavigate();

  function handleLogout() {
    logout();
    navigate('/'); // Redirect to home after logout
  }

  return (
    <nav className="navbar">
      <Link to="/" className="navbar-brand">⚡ Snip</Link>
      <div className="navbar-links">
        {isLoggedIn ? (
          <>
            <span className="navbar-user">👋 {user?.email}</span>
            <Link to="/dashboard" className="btn btn-ghost">Dashboard</Link>
            <button onClick={handleLogout} className="btn btn-outline">Logout</button>
          </>
        ) : (
          <>
            <Link to="/login"    className="btn btn-ghost">Login</Link>
            <Link to="/register" className="btn btn-primary">Sign Up</Link>
          </>
        )}
      </div>
    </nav>
  );
}
