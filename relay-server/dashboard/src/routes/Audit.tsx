import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, getToken } from '../api';

const PAGE_SIZE = 50;

export function AuditPage() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'ok' | 'fail'>('all');
  const [page, setPage] = useState(0);
  const [confirmClear, setConfirmClear] = useState(false);

  const audit = useQuery({
    queryKey: ['audit'],
    queryFn: () => api<{ entries: any[] }>('/api/audit'),
    refetchInterval: 10000,
  });

  const clearMut = useMutation({
    mutationFn: () => api('/api/audit', { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['audit'] }),
  });

  const entries = (audit.data?.entries || []).slice().reverse();
  const filtered = entries.filter(e => {
    if (statusFilter === 'ok' && !e.ok) return false;
    if (statusFilter === 'fail' && e.ok) return false;
    if (filter) {
      const term = filter.toLowerCase();
      return (
        (e.agent_id || '').toLowerCase().includes(term) ||
        (e.action || '').toLowerCase().includes(term) ||
        (e.target || '').toLowerCase().includes(term)
      );
    }
    return true;
  });

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const pageEntries = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const download = async () => {
    const token = getToken();
    const resp = await fetch('/api/audit/download', { headers: { Authorization: `Bearer ${token}` } });
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `claw-relay-audit-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <div className="section-header">
        <h2 className="section-title">Audit Log</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-outline" onClick={download}>⬇ Download</button>
          <button
            className={confirmClear ? 'btn btn-red btn-confirm' : 'btn btn-red'}
            onClick={() => {
              if (confirmClear) {
                clearMut.mutate();
                setConfirmClear(false);
              } else {
                setConfirmClear(true);
                setTimeout(() => setConfirmClear(false), 3000);
              }
            }}
          >
            {confirmClear ? '⚠ Confirm Clear?' : '🗑 Clear'}
          </button>
        </div>
      </div>

      <div className="filter-bar">
        <input
          placeholder="Filter by agent, action, target…"
          value={filter}
          onChange={e => { setFilter(e.target.value); setPage(0); }}
          style={{ flex: 1, minWidth: 200 }}
        />
        <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value as any); setPage(0); }}>
          <option value="all">All Status</option>
          <option value="ok">Success</option>
          <option value="fail">Errors</option>
        </select>
      </div>

      <div className="audit-wrap">
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Agent</th>
              <th>Action</th>
              <th>Target</th>
              <th>Status</th>
              <th>Duration</th>
            </tr>
          </thead>
          <tbody>
            {pageEntries.map((e, i) => (
              <tr key={i} className={e.ok ? 'ok' : 'fail'}>
                <td>{e.timestamp ? new Date(e.timestamp).toLocaleTimeString() : '—'}</td>
                <td>{e.agent_id || '—'}</td>
                <td>{e.action || '—'}</td>
                <td>{e.target || '—'}</td>
                <td>{e.ok ? '✓' : '✗'}</td>
                <td>{e.duration_ms != null ? `${e.duration_ms}ms` : '—'}</td>
              </tr>
            ))}
            {pageEntries.length === 0 && (
              <tr><td colSpan={6} style={{ textAlign: 'center', color: '#888', padding: 24 }}>No entries</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="pagination">
          <button className="btn btn-sm btn-outline" disabled={page === 0} onClick={() => setPage(p => p - 1)}>← Prev</button>
          <span>Page {page + 1} of {totalPages}</span>
          <button className="btn btn-sm btn-outline" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>Next →</button>
        </div>
      )}
    </>
  );
}
