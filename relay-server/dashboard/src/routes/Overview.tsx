import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { api } from '../api';

function formatUptime(started: string) {
  const ms = Date.now() - new Date(started).getTime();
  const s = Math.floor(ms / 1000), m = Math.floor(s / 60), h = Math.floor(m / 60), d = Math.floor(h / 24);
  if (d > 0) return `${d}d ${h % 24}h`;
  if (h > 0) return `${h}h ${m % 60}m`;
  return `${m}m ${s % 60}s`;
}

export function OverviewPage() {
  const navigate = useNavigate();
  const status = useQuery({
    queryKey: ['status'],
    queryFn: () => api('/api/status'),
    refetchInterval: 5000,
  });
  const config = useQuery({
    queryKey: ['config'],
    queryFn: () => api('/api/config'),
    refetchInterval: 5000,
  });

  const connections = status.data?.connections || [];
  const totalActions = connections.reduce((sum: number, c: any) => sum + (c.actionCount || 0), 0);
  const agentCount = Object.keys(config.data?.agents || {}).length;
  const connectedCount = connections.length;

  return (
    <>
      <div className="stats-row">
        <div className="card stat-card">
          <div className="value">{connectedCount}</div>
          <div className="label">Connected Agents</div>
        </div>
        <div className="card stat-card">
          <div className="value">{totalActions}</div>
          <div className="label">Total Actions</div>
        </div>
        <div className="card stat-card">
          <div className="value">{status.data?.startedAt ? formatUptime(status.data.startedAt) : '—'}</div>
          <div className="label">Uptime</div>
        </div>
        <div className="card stat-card">
          <div className="value">{agentCount}</div>
          <div className="label">Registered Agents</div>
        </div>
      </div>

      <h2 className="section-title" style={{ marginBottom: 16 }}>Quick Status</h2>
      <div className="agent-grid">
        {Object.entries(config.data?.agents || {}).map(([id, agent]: [string, any]) => {
          const conn = connections.find((c: any) => c.agentId === id);
          return (
            <div className="card agent-card-link" key={id} onClick={() => navigate({ to: '/agents' })} style={{ cursor: 'pointer' }}>
              <div className="agent-id">{id}</div>
              <div className="status">{conn ? '🟢 Connected' : '⚪ Offline'}</div>
              <div className="pills">
                {(agent.scopes || []).map((s: string) => (
                  <span key={s} className={`pill pill-${s}`}>{s}</span>
                ))}
              </div>
              {conn && (
                <div className="meta">
                  Actions: {conn.actionCount || 0}
                  {conn.lastAction && ` · Last: ${conn.lastAction}`}
                </div>
              )}
            </div>
          );
        })}
        {agentCount === 0 && (
          <div className="card" style={{ color: '#888' }}>
            No agents configured. Go to Agents page to add one.
          </div>
        )}
      </div>
    </>
  );
}
