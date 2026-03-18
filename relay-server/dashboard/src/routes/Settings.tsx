import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, clearToken } from '../api';

export function SettingsPage() {
  const qc = useQueryClient();

  const config = useQuery({
    queryKey: ['config'],
    queryFn: () => api('/api/config'),
  });

  const health = useQuery({
    queryKey: ['health'],
    queryFn: () => fetch('/health').then(r => r.json()),
  });

  const handleLogout = () => {
    clearToken();
    window.location.reload();
  };

  return (
    <>
      <h2 className="section-title" style={{ marginBottom: 16 }}>Settings</h2>

      <div style={{ display: 'grid', gap: 20 }}>
        <div className="card">
          <h3 style={{ marginBottom: 12 }}>Dashboard Info</h3>
          <div className="meta">Version: {health.data?.version || '—'}</div>
          <div className="meta">Port: {config.data?.dashboard?.port || '—'}</div>
          <div className="meta">Server port: {config.data?.server?.port || '—'}</div>
          <div className="meta">Uptime: {health.data?.uptime ? `${Math.floor(health.data.uptime)}s` : '—'}</div>
          <div style={{ marginTop: 16 }}>
            <button className="btn btn-outline" onClick={handleLogout}>
              🔒 Logout
            </button>
          </div>
        </div>

        <div className="card">
          <h3 style={{ marginBottom: 12 }}>Current Configuration</h3>
          {config.data ? (
            <div className="config-block">
              {JSON.stringify(config.data, null, 2)}
            </div>
          ) : (
            <div className="meta">Loading…</div>
          )}
        </div>
      </div>
    </>
  );
}
