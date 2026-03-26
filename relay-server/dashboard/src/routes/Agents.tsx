import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';

const SCOPES = ['read', 'interact', 'navigate', 'execute'];

function AgentForm({ initial, onSubmit, onCancel, submitLabel }: {
  initial?: { id?: string; token?: string; scopes?: string[]; allowlist?: string[]; rateLimit?: number };
  onSubmit: (data: any) => void;
  onCancel: () => void;
  submitLabel: string;
}) {
  const [id, setId] = useState(initial?.id || '');
  const [token, setToken] = useState(initial?.token || '');
  const [scopes, setScopes] = useState<string[]>(initial?.scopes || ['read']);
  const [allowlist, setAllowlist] = useState((initial?.allowlist || ['*']).join('\n'));
  const [rateLimit, setRateLimit] = useState(initial?.rateLimit || 30);
  const isNew = !initial?.id;

  const autoGen = () => {
    const arr = new Uint8Array(24);
    crypto.getRandomValues(arr);
    setToken(Array.from(arr, b => b.toString(16).padStart(2, '0')).join(''));
  };

  const toggleScope = (s: string) =>
    setScopes(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]);

  return (
    <div className="card form-card">
      <div className="form-grid">
        {isNew && (
          <div>
            <label>Agent ID</label>
            <input value={id} onChange={e => setId(e.target.value)} placeholder="my-agent" />
          </div>
        )}
        <div>
          <label>
            Token{' '}
            <button className="btn btn-sm btn-outline" onClick={autoGen} type="button" style={{ marginLeft: 8 }}>
              Auto-generate
            </button>
          </label>
          <input value={token} onChange={e => setToken(e.target.value)} placeholder="secret-token" />
        </div>
        <div className="full-width">
          <label>Scopes</label>
          <div className="scopes-checks">
            {SCOPES.map(s => (
              <label key={s}>
                <input type="checkbox" checked={scopes.includes(s)} onChange={() => toggleScope(s)} /> {s}
              </label>
            ))}
          </div>
        </div>
        <div>
          <label>Allowlist (one per line)</label>
          <textarea value={allowlist} onChange={e => setAllowlist(e.target.value)} />
        </div>
        <div>
          <label>Rate Limit (req/min)</label>
          <input type="number" value={rateLimit} onChange={e => setRateLimit(parseInt(e.target.value) || 30)} />
        </div>
        <div className="full-width" style={{ textAlign: 'right', paddingTop: 8 }}>
          <button className="btn btn-outline" onClick={onCancel}>Cancel</button>
          <button
            className="btn btn-green"
            style={{ marginLeft: 8 }}
            onClick={() => onSubmit({
              ...(isNew ? { id } : {}),
              token: token || undefined,
              scopes,
              allowlist: allowlist.trim().split('\n').filter(Boolean),
              rateLimit,
            })}
          >
            {submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export function AgentsPage() {
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  const config = useQuery({
    queryKey: ['config'],
    queryFn: () => api('/api/config'),
    refetchInterval: 5000,
  });
  const status = useQuery({
    queryKey: ['status'],
    queryFn: () => api('/api/status'),
    refetchInterval: 5000,
  });

  const addMut = useMutation({
    mutationFn: (data: any) => api('/api/agents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['config'] }); setShowAdd(false); },
  });

  const editMut = useMutation({
    mutationFn: ({ id, ...data }: any) => api(`/api/agents/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['config'] }); setEditing(null); },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api(`/api/agents/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['config'] }),
  });

  const disconnectMut = useMutation({
    mutationFn: (id: string) => api(`/api/agents/${encodeURIComponent(id)}/disconnect`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['status'] }),
  });

  const connections = status.data?.connections || [];
  const agents = config.data?.agents || {};

  return (
    <>
      <div className="section-header">
        <h2 className="section-title">Agents</h2>
        <button className="btn btn-green" onClick={() => setShowAdd(!showAdd)}>+ Add Agent</button>
      </div>

      {showAdd && (
        <AgentForm
          onSubmit={data => addMut.mutate(data)}
          onCancel={() => setShowAdd(false)}
          submitLabel="Create Agent"
        />
      )}

      {editing && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setEditing(null)}>
          <div className="modal-content">
            <h3>Edit {editing}</h3>
            <AgentForm
              initial={{
                scopes: agents[editing]?.scopes || ['read'],
                allowlist: agents[editing]?.allowlist || ['*'],
                rateLimit: agents[editing]?.rateLimit || 30,
              }}
              onSubmit={data => editMut.mutate({ id: editing, ...data })}
              onCancel={() => setEditing(null)}
              submitLabel="Save Changes"
            />
          </div>
        </div>
      )}

      <div className="agent-grid">
        {Object.entries(agents).map(([id, agent]: [string, any]) => {
          const conn = connections.find((c: any) => c.agentId === id);
          return (
            <div className="card agent-card" key={id}>
              <div className="agent-id">{id}</div>
              <div className="status">{conn ? '🟢 Connected' : '⚪ Offline'}</div>
              <div className="pills">
                {(agent.scopes || []).map((s: string) => (
                  <span key={s} className={`pill pill-${s}`}>{s}</span>
                ))}
              </div>
              <div className="meta">Allowlist: {(agent.allowlist || []).join(', ')}</div>
              <div className="meta">Rate limit: {agent.rateLimit}/min</div>
              <div className="meta token-row">Token: <span className="token-val">{agent.token}</span></div>
              {conn && (
                <div className="meta">
                  Last action: {conn.lastAction || '—'}
                  {conn.lastActionAt && ` (${new Date(conn.lastActionAt).toLocaleTimeString()})`}
                </div>
              )}
              <div className="actions">
                <button className="btn btn-sm btn-outline" onClick={() => setEditing(id)}>Edit</button>
                {conn && (
                  <button
                    className="btn btn-sm btn-red"
                    onClick={() => { if (confirm(`Disconnect agent ${id}?`)) disconnectMut.mutate(id); }}
                  >
                    ⛔ Disconnect
                  </button>
                )}
                <button
                  className="btn btn-sm btn-red"
                  onClick={() => { if (confirm(`Delete agent ${id}?`)) deleteMut.mutate(id); }}
                >
                  Delete
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
