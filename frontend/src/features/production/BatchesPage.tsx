import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { ColumnDef } from '@tanstack/react-table';
import { AlertTriangle, ArrowUpRight, Ban, CheckCircle2, ClipboardList, Copy, History, Layers, Loader, Plus, RotateCcw, Wrench } from 'lucide-react';
import {
  batchStatusGroups,
  departments,
  hasPermission,
  productionPurposes,
  type BatchDetail,
  type BatchSummary,
  type OrderSummary,
  type PageResponse,
} from '@loomos/shared';
import { useData, useLookups } from '../../hooks/useFactory';
import { useAuth } from '../auth/Auth';
import { Button } from '../../components/ui/button';
import { Modal } from '../../components/ui/dialog';
import { ActionForm, type FormSpec } from '../../components/shared/ActionForm';
import { FilterBar, useFilters, type FilterDef } from '../../components/shared/FilterBar';
import { Badge, Empty, ErrorState, ExportButton, Kpi, Loading, PageHeader, Panel, Progress, SearchBox } from '../../components/shared/common';
import { DataTable } from '../../components/tables/DataTable';
import { date, exportCsv, label, number } from '../../lib/utils';
import {
  cancelBatchForm,
  cancelReworkForm,
  issueForm,
  reassignForm,
  replacementForm,
  resolveIssueForm,
  reworkForm,
  standaloneBatchForm,
} from './productionForms';

const filterNames = ['buyerId', 'orderId', 'status', 'department', 'machineId', 'purpose', 'rework', 'from', 'to'];

const dateTime = (value: string) =>
  new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }).format(new Date(value));

// Every production batch in one place, with filters that can be combined, and a detail
// window for corrective actions: rework, problems, reassignment, replacement, cancellation.
export function BatchesPage() {
  const { user } = useAuth();
  const lookups = useLookups();
  const filters = useFilters(filterNames);
  const [search, setSearch] = useState('');
  const [spec, setSpec] = useState<FormSpec | null>(null);
  const [params, setParams] = useSearchParams();
  const openId = params.get('open');

  const path = `/production/batches?pageSize=100${filters.query ? `&${filters.query}` : ''}${search ? `&search=${encodeURIComponent(search)}` : ''}`;
  const query = useData<PageResponse<BatchSummary>>(path);
  const orders = useData<PageResponse<OrderSummary>>('/orders?pageSize=100', hasPermission(user, 'orders', 'view'));
  const canManage = hasPermission(user, 'production', 'manage');

  const setOpen = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set('open', id);
    else next.delete('open');
    setParams(next, { replace: true });
  };

  const filterDefs: FilterDef[] = [
    { name: 'buyerId', label: 'Customer', options: (lookups.data?.buyers ?? []).map((b) => ({ value: b.id, label: b.name })) },
    { name: 'status', label: 'Status', options: batchStatusGroups.map((s) => ({ value: s, label: label(s) })) },
    { name: 'department', label: 'Department', options: departments.map((d) => ({ value: d, label: label(d) })) },
    { name: 'machineId', label: 'Machine', options: (lookups.data?.machines ?? []).map((m) => ({ value: m.id, label: `${String(m.code)} · ${m.name}` })) },
    { name: 'orderId', label: 'Order', options: (orders.data?.data ?? []).map((o) => ({ value: o.id, label: `${o.number} · ${o.buyer.name}` })) },
    {
      name: 'purpose',
      label: 'Type',
      options: [
        { value: 'ORDER', label: 'Customer orders' },
        { value: 'STANDALONE', label: 'All standalone' },
        ...productionPurposes.map((p) => ({ value: p, label: label(p) })),
      ],
    },
    { name: 'rework', label: 'Rework', options: [{ value: 'yes', label: 'Had rework' }] },
    { name: 'from', label: 'Created from', type: 'date' },
    { name: 'to', label: 'Created to', type: 'date' },
  ];

  const columns: ColumnDef<BatchSummary>[] = [
    {
      accessorKey: 'number',
      header: 'Batch',
      cell: ({ row }) => {
        const b = row.original;
        return (
          <div className="cell-stack">
            <span className="batch-number">{b.number}</span>
            <span>{b.fabric} · {b.color}</span>
            <div className="batch-flags">
              {b.purpose !== 'ORDER' && <span className="flag stock">{label(b.purpose)}</span>}
              {b.priority !== 'NORMAL' && <span className="flag urgent">{label(b.priority)}</span>}
              {b.openReworks > 0 && <span className="flag rework">Rework</span>}
              {b.openIssues > 0 && <span className="flag issue">{b.openIssues} problem{b.openIssues > 1 ? 's' : ''}</span>}
            </div>
          </div>
        );
      },
    },
    {
      id: 'customer',
      header: 'Customer / order',
      cell: ({ row }) =>
        row.original.order ? (
          <div className="cell-stack">
            <strong>{row.original.order.buyer.name}</strong>
            <span>{row.original.order.number}</span>
          </div>
        ) : (
          <span className="muted">No order · {label(row.original.purpose)}</span>
        ),
    },
    { accessorKey: 'department', header: 'Department', cell: ({ row }) => <Badge value={row.original.department} /> },
    { accessorKey: 'statusGroup', header: 'Status', cell: ({ row }) => <Badge value={row.original.statusGroup} /> },
    {
      id: 'progress',
      header: 'Output',
      cell: ({ row }) => {
        const pct = Math.min(100, Math.round((Number(row.original.produced) / Number(row.original.target)) * 100) || 0);
        return <Progress value={pct} label={`${number(row.original.produced)} / ${number(row.original.target)} m`} />;
      },
    },
    { accessorKey: 'dueDate', header: 'Due', cell: ({ row }) => (row.original.dueDate ? date(row.original.dueDate) : '—') },
    {
      id: 'open',
      header: '',
      cell: ({ row }) => (
        <button className="icon-button" onClick={() => setOpen(row.original.id)} aria-label={`Open ${row.original.number}`}>
          <ArrowUpRight size={17} />
        </button>
      ),
    },
  ];

  const rows = query.data?.data ?? [];

  return (
    <>
      <PageHeader
        eyebrow="PRODUCTION CONTROL"
        title="Production batches"
        description="Every batch, from order or stock, with its stage, problems and rework history."
      >
        <ExportButton
          onClick={() =>
            exportCsv('production-batches', rows.map((b) => ({
              batch: b.number,
              fabric: b.fabric,
              colour: b.color,
              customer: b.order?.buyer.name ?? '',
              order: b.order?.number ?? '',
              type: b.purpose,
              department: b.department,
              status: b.statusGroup,
              target: b.target,
              produced: b.produced,
              due: b.dueDate ?? '',
            })))
          }
        />
        {canManage && (
          <Button onClick={() => setSpec(standaloneBatchForm(lookups.data))}>
            <Plus size={16} />
            New batch
          </Button>
        )}
      </PageHeader>

      <div className="kpi-grid">
        <Kpi label="Batches" value={rows.length} icon={<ClipboardList size={19} />} meta={`${rows.filter((b) => b.purpose !== 'ORDER').length} standalone · ${rows.filter((b) => b.purpose === 'ORDER').length} for orders`} />
        <Kpi label="In production" value={rows.filter((b) => b.statusGroup === 'ONGOING' || b.statusGroup === 'PENDING').length} icon={<Loader size={19} />} meta={`${rows.filter((b) => b.statusGroup === 'PENDING').length} not started yet`} accent />
        <Kpi label="Rework & problems" value={rows.filter((b) => b.statusGroup === 'REWORK').length} icon={<RotateCcw size={19} />} meta={`${rows.reduce((s, b) => s + b.openIssues, 0)} open problems · ${rows.filter((b) => b.statusGroup === 'FAILED').length} failed`} />
        <Kpi label="Completed" value={rows.filter((b) => b.statusGroup === 'COMPLETED').length} icon={<CheckCircle2 size={19} />} meta={`${number(rows.reduce((s, b) => s + Number(b.produced), 0))} m produced`} />
      </div>

      <Panel>
        <FilterBar filters={filterDefs} values={filters.values} onChange={filters.setValue} onClear={filters.clear} active={filters.active} />
        <div className="table-toolbar">
          <SearchBox value={search} onChange={setSearch} placeholder="Search batch, fabric, colour, order or customer…" />
          <span className="muted">{rows.length} batch{rows.length === 1 ? '' : 'es'}</span>
        </div>
        {query.isPending ? (
          <Loading />
        ) : query.error ? (
          <ErrorState error={query.error} retry={() => void query.refetch()} />
        ) : rows.length ? (
          <DataTable data={rows} columns={columns} onRow={(b) => setOpen(b.id)} />
        ) : (
          <Empty title="No batches match these filters" description="Clear a filter or create a new batch." />
        )}
      </Panel>

      {openId && <BatchDetailModal id={openId} onClose={() => setOpen(null)} onAction={setSpec} />}
      {spec && <ActionForm spec={spec} onClose={() => setSpec(null)} />}
    </>
  );
}

function BatchDetailModal({ id, onClose, onAction }: { id: string; onClose: () => void; onAction: (spec: FormSpec) => void }) {
  const { user } = useAuth();
  const lookups = useLookups();
  const navigate = useNavigate();
  const query = useData<BatchDetail>(`/production/batches/${id}`);
  const canManage = hasPermission(user, 'production', 'manage');
  const canUpdate = hasPermission(user, 'production', 'update') || hasPermission(user, 'quality', 'update');

  const b = query.data;
  const open = b && !['COMPLETED', 'CANCELLED'].includes(b.status);
  // Rework can only go back to stages the batch has already reached.
  const reachedStages = b?.jobs.filter((j) => ['IN_PROGRESS', 'COMPLETED', 'PAUSED', 'BLOCKED'].includes(j.status)).map((j) => j.stage) ?? [];
  const inRework = b?.reworks.some((r) => r.returnStage && ['OPEN', 'IN_PROGRESS'].includes(r.status));

  return (
    <Modal open onClose={onClose} wide title={b ? `${b.number} · ${b.fabric}` : 'Production batch'} description={b ? `${b.color} · ${number(b.target)} m · ${b.order ? `${b.order.buyer.name} · ${b.order.number}` : `${label(b.purpose)} batch (no customer order)`}` : undefined}>
      {query.isPending ? (
        <Loading />
      ) : query.error || !b ? (
        <ErrorState error={query.error ?? new Error('Batch not found')} retry={() => void query.refetch()} />
      ) : (
        <div className="batch-modal-body">
          <div className="batch-flags" style={{ marginBottom: 12 }}>
            <Badge value={b.statusGroup} />
            <Badge value={b.department}>Now in {label(b.department)}</Badge>
            {b.priority !== 'NORMAL' && <Badge value={b.priority} />}
            {b.dueDate && <span className="flag">Due {date(b.dueDate)}</span>}
            {b.replaces && <span className="flag stock">Replaces {b.replaces.number}</span>}
            {b.replacements.map((r) => (
              <span key={r.id} className="flag stock">Replaced by {r.number}</span>
            ))}
          </div>
          {b.notes && <p className="muted" style={{ marginTop: 0 }}>{b.notes}</p>}

          <div className="stage-track">
            {b.jobs.map((j) => (
              <div key={j.id} className={`stage-step ${j.status === 'IN_PROGRESS' ? 'is-active' : ''} ${j.status === 'COMPLETED' ? 'is-done' : ''}`}>
                <header>
                  <strong>{label(j.stage)}</strong>
                  <Badge value={j.status} />
                </header>
                <small>{number(j.output)} / {number(j.target)} m</small>
                <small>{j.machineCode ?? 'Machine not set'} · {j.workerName ?? 'No worker'}</small>
                {canManage && !['COMPLETED', 'CANCELLED'].includes(j.status) && (
                  <Button size="sm" variant="outline" onClick={() => onAction(reassignForm(j, b.number, lookups.data))}>
                    Reassign
                  </Button>
                )}
              </div>
            ))}
          </div>

          <div className="detail-actions">
            {canUpdate && b.status !== 'CANCELLED' && (
              <Button size="sm" variant="outline" onClick={() => onAction(issueForm(b, b.jobs.find((j) => j.status === 'IN_PROGRESS')?.id))}>
                <AlertTriangle size={14} /> Report problem
              </Button>
            )}
            {canUpdate && b.status !== 'CANCELLED' && !inRework && reachedStages.length > 0 && (
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  onAction(
                    reworkForm(
                      b,
                      reachedStages,
                      lookups.data,
                      b.status === 'COMPLETED'
                        ? {
                            ids: b.rolls.filter((r) => r.quality !== 'PASSED' && !r.activeShipmentId).map((r) => r.id),
                            codes: b.rolls.filter((r) => r.quality !== 'PASSED' && !r.activeShipmentId).map((r) => r.code),
                          }
                        : undefined,
                    ),
                  )
                }
              >
                <RotateCcw size={14} /> Send back for rework
              </Button>
            )}
            {canManage && (
              <Button size="sm" variant="outline" onClick={() => onAction(replacementForm(b))}>
                <Copy size={14} /> Replacement batch
              </Button>
            )}
            {canManage && open && (
              <Button size="sm" variant="outline" onClick={() => onAction(cancelBatchForm(b))}>
                <Ban size={14} /> Cancel batch
              </Button>
            )}
          </div>

          <section className="detail-section">
            <h3><RotateCcw size={15} /> Rework ({b.reworks.length})</h3>
            {b.reworks.length ? (
              <div className="record-list">
                {b.reworks.map((r) => (
                  <div className="record" key={r.id}>
                    <div>
                      <strong>{label(r.defectType)}</strong> · {r.returnStage ? `${label(r.fromStage)} → back to ${label(r.returnStage)}` : 'Repair at rework bay'}
                      <p>{r.reason}</p>
                      <p>
                        {number(r.quantity)} m{r.rollCodes.length ? ` · rolls ${r.rollCodes.join(', ')}` : ''}
                        {r.machine ? ` · ${r.machine.code}` : ''}{r.worker ? ` · ${r.worker.name}` : ''}
                      </p>
                      {r.outcome && <p>Outcome: {r.outcome}</p>}
                    </div>
                    <div className="cell-stack" style={{ alignItems: 'flex-end' }}>
                      <Badge value={r.status} />
                      <span className="record-meta">Raised by {r.raisedBy || '—'} · {dateTime(r.createdAt)}</span>
                      {r.completedAt && <span className="record-meta">Closed by {r.resolvedBy} · {dateTime(r.completedAt)}</span>}
                      {canManage && r.status === 'OPEN' && r.returnStage && (
                        <Button size="sm" variant="outline" onClick={() => onAction(cancelReworkForm(r))}>Cancel rework</Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted">No rework on this batch.</p>
            )}
          </section>

          <section className="detail-section">
            <h3><Wrench size={15} /> Problems ({b.issues.length})</h3>
            {b.issues.length ? (
              <div className="record-list">
                {b.issues.map((i) => (
                  <div className="record" key={i.id}>
                    <div>
                      <strong>{label(i.type)}</strong>{i.stage ? ` · ${label(i.stage)}` : ''}
                      <p>{i.description}</p>
                      {i.resolution && <p>Action taken: {i.resolution}</p>}
                    </div>
                    <div className="cell-stack" style={{ alignItems: 'flex-end' }}>
                      <Badge value={i.status} />
                      <span className="record-meta">{i.reportedBy} · {dateTime(i.createdAt)}</span>
                      {i.resolvedAt && <span className="record-meta">Resolved by {i.resolvedBy} · {dateTime(i.resolvedAt)}</span>}
                      {canUpdate && i.status === 'OPEN' && (
                        <Button size="sm" variant="outline" onClick={() => onAction(resolveIssueForm(i))}>Mark resolved</Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted">No problems reported.</p>
            )}
          </section>

          {b.rolls.length > 0 && (
            <section className="detail-section">
              <h3><Layers size={15} /> Fabric rolls ({b.rolls.length})</h3>
              <div className="batch-flags">
                {b.rolls.map((r) => (
                  <button key={r.id} className="flag" onClick={() => navigate(`/rolls/${r.id}`)} style={{ border: 0, cursor: 'pointer' }}>
                    {r.code} · {number(r.length)} m · {label(r.quality)}
                  </button>
                ))}
              </div>
            </section>
          )}

          <section className="detail-section">
            <h3><History size={15} /> History</h3>
            <div className="history-list">
              {b.history.map((h) => (
                <div key={h.id}>
                  <p>{h.detail}</p>
                  <small>{h.actorName} · {dateTime(h.createdAt)}</small>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}
    </Modal>
  );
}
