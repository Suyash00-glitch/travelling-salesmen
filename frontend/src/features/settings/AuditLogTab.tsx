import { useState } from 'react';
import { RefreshCw, Clock } from 'lucide-react';
import { type PageResponse } from '@loomos/shared';
import { useData } from '../../hooks/useFactory';
import { Button } from '../../components/ui/button';
import { Panel, Spinner, Empty, SearchBox } from '../../components/shared/common';
import { DataTable } from '../../components/tables/DataTable';

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
    { id: 'ALL', label: 'All actions' },
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

  const getActionCategory = (action: string) => {
    if (action.startsWith('rbac')) return 'rbac';
    if (action.startsWith('order')) return 'order';
    if (action.startsWith('production')) return 'production';
    return '';
  };

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
          <RefreshCw
            size={14}
            className={auditQuery.isFetching ? 'animate-spin' : ''}
          />
          Refresh
        </Button>
      }
    >
      <div className="table-toolbar">
        <div className="tabs">
          {categories.map((c) => (
            <button
              key={c.id}
              className={categoryFilter === c.id ? 'active' : ''}
              onClick={() => setCategoryFilter(c.id)}
            >
              {c.label}
            </button>
          ))}
        </div>
        <SearchBox
          value={search}
          onChange={setSearch}
          placeholder="Search by actor, action code, or details…"
        />
      </div>

      {auditQuery.isPending ? (
        <Spinner />
      ) : filteredLogs.length === 0 ? (
        <Empty
          title="No audit records"
          description={
            search
              ? 'No events match your search or filter.'
              : 'Audit events will appear here as administrative actions occur.'
          }
        />
      ) : (
        <DataTable
          data={filteredLogs}
          columns={[
            {
              accessorKey: 'createdAt',
              header: 'Recorded',
              cell: ({ row }) => (
                <div className="cell-stack">
                  <div className="flex gap-1.5 items-center">
                    <Clock size={13} className="muted" />
                    <strong>
                      {new Date(row.original.createdAt).toLocaleDateString(
                        'en-IN',
                        {
                          day: '2-digit',
                          month: 'short',
                          year: 'numeric',
                        },
                      )}
                    </strong>
                  </div>
                  <span className="muted">
                    {new Date(row.original.createdAt).toLocaleTimeString(
                      'en-IN',
                      {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      },
                    )}
                  </span>
                </div>
              ),
            },
            {
              accessorKey: 'actorName',
              header: 'Actor',
              cell: ({ row }) => (
                <div className="buyer-cell">
                  <span className="avatar avatar-small">
                    {row.original.actorName?.slice(0, 2).toUpperCase() || 'SY'}
                  </span>
                  <div className="cell-stack">
                    <strong>{row.original.actorName || 'System'}</strong>
                  </div>
                </div>
              ),
            },
            {
              accessorKey: 'action',
              header: 'Action',
              cell: ({ row }) => (
                <code
                  className={`audit-code ${getActionCategory(row.original.action)}`}
                >
                  {row.original.action}
                </code>
              ),
            },
            {
              accessorKey: 'detail',
              header: 'Details & Entity',
              cell: ({ row }) => (
                <div className="cell-stack">
                  <span>{row.original.detail}</span>
                  {row.original.entityId && (
                    <small className="muted font-mono">
                      Target ID: {row.original.entityId}
                    </small>
                  )}
                </div>
              ),
            },
          ]}
        />
      )}
    </Panel>
  );
}
