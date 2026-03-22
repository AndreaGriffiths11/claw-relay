import React, { useState, useEffect } from 'react';
import { Outlet, Link, useRouterState } from '@tanstack/react-router';
import { getToken, setToken, clearToken, api } from '../api';

export function Layout() {
  const [authed, setAuthed] = useState(!!getToken());
  const [tokenInput, setTokenInput] = useState('');
  const [error, setError] = useState('');
  const router = useRouterState();
  const currentPath = router.location.pathname;

  useEffect(() => {
    if (getToken()) {
      api('/api/status')
        .then(() => setAuthed(true))
        .catch((err) => {
          // Only clear token on auth failures, not network/transient errors
          if (err.message.includes('401') || err.message.includes('403') || err.message === 'Unauthorized') {
            clearToken();
            setAuthed(false);
            setError('Invalid token');
          } else {
            // Server may be down — keep token, show connection error
            setAuthed(false);
            setError('Could not reach server');
          }
        });
    }
  }, []);

  const handleAuth = async () => {
    const t = tokenInput.trim();
    if (!t) return;
    setError('');
    setToken(t);
    try {
      await api('/api/status');
      setAuthed(true);
      setTokenInput('');
    } catch (err: any) {
      clearToken();
      setAuthed(false);
      setError(err.message.includes('401') || err.message.includes('403') ? 'Invalid token' : 'Could not reach server');
    }
  };

  if (!authed) {
    return (
      <div className="auth-overlay">
        <div className="auth-modal">
          <h2>🦞 Dashboard Auth</h2>
          <p>Enter admin token to continue</p>
          {error && <div className="auth-error">{error}</div>}
          <input
            type="password"
            placeholder="Admin token"
            value={tokenInput}
            onChange={e => setTokenInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAuth()}
            autoFocus
          />
          <button className="btn btn-red" onClick={handleAuth}>
            Authenticate
          </button>
        </div>
      </div>
    );
  }

  const links = [
    { to: '/', label: 'Overview' },
    { to: '/agents', label: 'Agents' },
    { to: '/audit', label: 'Audit Log' },
    { to: '/settings', label: 'Settings' },
  ];

  return (
    <>
      <div className="topbar">
        <h1>🦞 Claw Relay</h1>
        <nav className="nav">
          {links.map(l => (
            <Link
              key={l.to}
              to={l.to}
              className={currentPath === l.to ? 'active' : ''}
            >
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="status-badge">
          <div className="status-dot" /> Running
        </div>
      </div>
      <div className="container">
        <Outlet />
      </div>
      <footer className="footer">
        <span>Built with 🦞 by <a href="https://ag11.dev" target="_blank" rel="noopener noreferrer">ag11.dev</a></span>
        <span><a href="https://github.com/AndreaGriffiths11/claw-relay" target="_blank" rel="noopener noreferrer">GitHub</a></span>
        <span><a href="https://clawrelay.dev" target="_blank" rel="noopener noreferrer">clawrelay.dev</a></span>
      </footer>
    </>
  );
}
