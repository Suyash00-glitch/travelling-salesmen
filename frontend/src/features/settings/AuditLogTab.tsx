import { useState } from 'react';
import {
  FileText,
  Search,
  RefreshCw,
  User,
  Clock,
} from 'lucide-react';
import { type PageResponse } from '@loomos/shared';
import { useData } from '../../hooks/useFactory';
import { Button } from '../../components/ui/button';
import { Panel, Spinner } from '../../components/shared/common';

interface AuditItem {
  id: string;
  actorId: string;
  actorName: string;
  action: string;
  entityId: string;
  detail: string;
  createdAt: string;
}

export function AuditLogTab() {
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('ALL');

  const auditQuery = useData<PageResponse<AuditItem>>('/audit?pageSize=200');
  const logs = auditQuery.data?.data ?? [];

  const categories = [
    { id: 'ALL', label: 'All Actions' },
    { id: 'rbac', label: 'RBAC & Access' },
    { id: 'order', label: 'Orders' },
    { id: 'production', label: 'Production' },
    { id: 'inventory', label: 'Inventory' },
    { id: 'machine', label: 'Machines' },
  ];

  const filteredLogs = logs.filter((log) => {
    const matchesSearch =
      `${log.actorName} ${log.action} ${log.detail} ${log.entityId}`
        .toLowerCase()
        .includes(search.toLowerCase());

    const matchesCategory =
      categoryFilter === 'ALL' ||
      log.action.toLowerCase().includes(categoryFilter.toLowerCase());

    return matchesSearch && matchesCategory;
  });

  return (
    <Panel
      title="Immutable Audit Trail"
      subtitle="Complete chronological log of all administrative, access, and operational events."
      action={
        <Button
          variant="outline"
          size="sm"
          onClick={() => void auditQuery.refetch()}
          disabled={auditQuery.isFetching}
        >
          <RefreshCw size={14} className={auditQuery.isFetching ? 'animate-spin' : ''} />
          Refresh
        </Button>
      }
    >
      {/* Controls */}
      <div
        style={{
          display: 'flex',
          gap: '1rem',
          flexWrap: 'wrap',
          alignItems: 'center',
          marginBottom: '1.25rem',
          paddingBottom: '1rem',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <div style={{ position: 'relative', flex: '1 1 280px' }}>
          <Search
            size={16}
            style={{
              position: 'absolute',
              left: '10px',
              top: '50%',
              transform: 'translateY(-50%)',
              color: 'var(--muted)',
            }}
          />
          <input
            type="text"
            placeholder="Search by actor, action code, or details..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              width: '100%',
              padding: '0.5rem 0.75rem 0.5rem 2rem',
              borderRadius: '6px',
              border: '1px solid var(--border)',
              background: 'var(--input-bg, transparent)',
              fontSize: '0.875rem',
            }}
          />
        </div>

        <div style={{ display: 'flex', gap: '0.375rem', flexWrap: 'wrap' }}>
          {categories.map((c) => (
            <button
              key={c.id}
              onClick={() => setCategoryFilter(c.id)}
              style={{
                padding: '0.375rem 0.75rem',
                borderRadius: '6px',
                border: '1px solid var(--border)',
                background:
                  categoryFilter === c.id ? 'var(--accent)' : 'transparent',
                color:
                  categoryFilter === c.id ? '#fff' : 'var(--text-secondary)',
                fontSize: '0.8125rem',
                cursor: 'pointer',
                fontWeight: categoryFilter === c.id ? 600 : 400,
                transition: 'all 0.15s ease',
              }}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {auditQuery.isPending ? (
        <Spinner />
      ) : filteredLogs.length === 0 ? (
        <div
          style={{
            padding: '3rem',
            textAlign: 'center',
            color: 'var(--muted)',
          }}
        >
          <FileText size={40} style={{ margin: '0 auto 1rem', opacity: 0.5 }} />
          <div>No matching audit records found.</div>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="data-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ width: '180px' }}>Recorded</th>
                <th style={{ width: '180px' }}>Actor</th>
                <th style={{ width: '220px' }}>Action</th>
                <th>Details & Entity</th>
              </tr>
            </thead>
            <tbody>
              {filteredLogs.map((item) => (
                <tr key={item.id}>
                  <td style={{ whiteSpace: 'nowrap', fontSize: '0.8125rem', color: 'var(--muted)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                      <Clock size={13} />
                      {new Date(item.createdAt).toLocaleString('en-IN', {
                        day: '2-digit',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      })}
                    </div>
                  </td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', fontWeight: 500 }}>
                      <User size={14} color="var(--accent)" />
                      {item.actorName || 'System'}
                    </div>
                  </td>
                  <td>
                    <code
                      style={{
                        padding: '3px 8px',
                        borderRadius: '4px',
                        background: item.action.startsWith('rbac')
                          ? 'rgba(168, 85, 247, 0.15)'
                          : 'rgba(59, 130, 246, 0.15)',
                        color: item.action.startsWith('rbac') ? '#c084fc' : '#60a5fa',
                        fontSize: '0.8125rem',
                        fontWeight: 600,
                        border: '1px solid rgba(255,255,255,0.06)',
                      }}
                    >
                      {item.action}
                    </code>
                  </td>
                  <td>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                      <span style={{ fontSize: '0.875rem' }}>{item.detail}</span>
                      {item.entityId && (
                        <span style={{ fontSize: '0.75rem', color: 'var(--muted)', fontFamily: 'monospace' }}>
                          Target ID: {item.entityId}
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
