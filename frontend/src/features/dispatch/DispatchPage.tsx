import { useState } from 'react';
import { Truck, Plus, ScanLine, Check, PackageCheck, ClipboardList, Ban, MapPin, Clock } from 'lucide-react';
import { hasPermission, type PageResponse } from '@loomos/shared';
import { useData, useAction, useLookups } from '../../hooks/useFactory';
import { useAuth } from '../auth/Auth';
import { Button } from '../../components/ui/button';
import { Modal } from '../../components/ui/dialog';
import { ActionForm, type FormSpec } from '../../components/shared/ActionForm';
import { FilterBar, useFilters } from '../../components/shared/FilterBar';
import { PageHeader, Panel, Loading, ErrorState, Badge, SearchBox, Empty, Kpi } from '../../components/shared/common';
import { DataTable } from '../../components/tables/DataTable';
import { ScanDialog } from '../quality/ScanDialog';
import { number, date, money } from '../../lib/utils';
import { NewShipment } from './NewShipment';

export interface ShipmentView {
  id: string;
  number: string;
  status: string;
  transport: string;
  driverName: string;
  driverPhone: string;
  quantity: string;
  createdAt: string;
  confirmedAt: string | null;
  expectedAt: string | null;
  deliveredAt: string | null;
  receivedBy: string;
  dispatcher: string | null;
  events: { action: string; detail: string; actorName: string; createdAt: string }[];
  order: { number: string; buyer: { name: string; city?: string } };
  rolls: { id: string; verified: boolean; roll: { id: string; code: string; length: string; quality: string; fabric: string; color: string } }[];
  invoice: { number: string; total: string; status: string } | null;
}

// Status tabs keep pending work apart from finished deliveries.
const tabs = [
  { key: 'DRAFT', title: 'Ready to dispatch' },
  { key: 'DISPATCHED', title: 'On the road' },
  { key: 'DELIVERED', title: 'Delivered' },
  { key: 'CANCELLED', title: 'Cancelled' },
];

const isLate = (s: ShipmentView) => s.status === 'DISPATCHED' && !!s.expectedAt && new Date(s.expectedAt) < new Date();

export function DispatchPage({ buyer = false }: { buyer?: boolean }) {
  const { user } = useAuth();
  const lookups = useLookups();
  const filters = useFilters(['buyerId']);
  const query = useData<PageResponse<ShipmentView>>(`/shipments?pageSize=100${filters.query ? `&${filters.query}` : ''}`);
  const [tab, setTab] = useState('DRAFT');
  const [create, setCreate] = useState(false);
  const [scan, setScan] = useState<string | null>(null);
  const [spec, setSpec] = useState<FormSpec | null>(null);
  const [manifest, setManifest] = useState<ShipmentView | null>(null);
  const [search, setSearch] = useState('');
  const action = useAction();
  const canManage = !buyer && hasPermission(user, 'dispatch', 'update');

  if (query.isPending) return <Loading />;
  if (query.error) return <ErrorState error={query.error} retry={() => void query.refetch()} />;

  const all = query.data?.data ?? [];
  const rows = all
    .filter((s) => s.status === tab)
    .filter((s) => `${s.number} ${s.order.number} ${s.order.buyer.name} ${s.transport}`.toLowerCase().includes(search.toLowerCase()));
  const count = (key: string) => all.filter((s) => s.status === key).length;
  const late = all.filter(isLate);

  const deliverForm = (s: ShipmentView): FormSpec => ({
    title: `Delivered · ${s.number}`,
    description: `${s.order.buyer.name} · ${number(s.quantity)} m`,
    path: `/shipments/${s.id}/deliver`,
    fields: [
      { name: 'receivedBy', label: 'Received by', required: false },
      { name: 'note', label: 'Note', required: false, span: true },
    ],
    submit: 'Mark delivered',
  });

  const cancelForm = (s: ShipmentView): FormSpec => ({
    title: `Cancel ${s.number}`,
    description: 'Rolls go back to finished stock. Invoiced shipments are voided if nothing has been paid.',
    path: `/shipments/${s.id}/cancel`,
    fields: [{ name: 'reason', label: 'Reason', type: 'textarea', span: true }],
    submit: 'Cancel shipment',
  });

  function actionsFor(s: ShipmentView) {
    const verified = s.rolls.every((r) => r.verified);
    return (
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {canManage && s.status === 'DRAFT' && (
          <>
            <Button variant="outline" size="sm" onClick={() => setScan(s.id)}><ScanLine size={14} /> Verify roll</Button>
            <Button size="sm" disabled={action.isPending || !verified} title={verified ? undefined : 'Verify every roll label first'} onClick={() => action.mutate({ path: `/shipments/${s.id}/confirm` })}>
              <Check size={14} /> Confirm · truck leaves
            </Button>
          </>
        )}
        {canManage && s.status === 'DISPATCHED' && (
          <Button size="sm" onClick={() => setSpec(deliverForm(s))}><PackageCheck size={14} /> Delivered</Button>
        )}
        {canManage && ['DRAFT', 'DISPATCHED'].includes(s.status) && (
          <Button variant="outline" size="icon" title="Cancel" onClick={() => setSpec(cancelForm(s))}><Ban size={14} /></Button>
        )}
        <Button variant="outline" size="sm" onClick={() => setManifest(s)}><ClipboardList size={14} /> Details</Button>
      </div>
    );
  }

  return (
    <>
      {!buyer && (
        <PageHeader eyebrow="LOGISTICS" title="Dispatch" description="Load passed rolls, verify labels, confirm the truck, then mark it delivered.">
          {canManage && (
            <Button onClick={() => setCreate(true)}><Plus size={16} /> New dispatch</Button>
          )}
        </PageHeader>
      )}

      <div className="kpi-grid">
        <Kpi label="Ready to dispatch" value={count('DRAFT')} icon={<Truck size={19} />} meta={`${all.filter((s) => s.status === 'DRAFT').reduce((n, s) => n + s.rolls.filter((r) => !r.verified).length, 0)} labels still to scan`} accent />
        <Kpi label="On the road" value={count('DISPATCHED')} icon={<MapPin size={19} />} meta={`${number(all.filter((s) => s.status === 'DISPATCHED').reduce((n, s) => n + Number(s.quantity), 0))} m in transit`} />
        <Kpi label="Late" value={late.length} icon={<Clock size={19} />} meta={late.map((s) => s.number).join(', ') || 'Nothing overdue'} />
        <Kpi label="Delivered" value={count('DELIVERED')} icon={<PackageCheck size={19} />} meta={`${number(all.filter((s) => s.status === 'DELIVERED').reduce((n, s) => n + Number(s.quantity), 0))} m delivered`} />
      </div>

      <Panel>
        <div className="table-toolbar">
          <div className="tabs">
            {tabs.map((t) => (
              <button key={t.key} className={tab === t.key ? 'active' : ''} onClick={() => setTab(t.key)}>
                {t.title} <span>{count(t.key)}</span>
              </button>
            ))}
          </div>
          <SearchBox value={search} onChange={setSearch} placeholder="Shipment, order, buyer or truck…" />
        </div>
        {!buyer && (
          <FilterBar
            filters={[{ name: 'buyerId', label: 'Customer', options: (lookups.data?.buyers ?? []).map((b) => ({ value: b.id, label: b.name })) }]}
            values={filters.values} onChange={filters.setValue} onClear={filters.clear} active={filters.active}
          />
        )}
        {rows.length ? (
          <DataTable
            data={rows}
            columns={[
              { accessorKey: 'number', header: 'Dispatch', cell: ({ row }) => <div className="cell-stack"><strong>{row.original.number}</strong><span>{row.original.transport}{row.original.driverName ? ` · ${row.original.driverName}` : ''}</span></div> },
              { id: 'order', header: 'Customer / order', cell: ({ row }) => <div className="cell-stack"><strong>{row.original.order.buyer.name}</strong><span>{row.original.order.number}</span></div> },
              { id: 'goods', header: 'Goods', cell: ({ row }) => <div className="cell-stack"><strong>{number(row.original.quantity)} m · {row.original.rolls.length} rolls</strong><span>{[...new Set(row.original.rolls.map((r) => `${r.roll.fabric} · ${r.roll.color}`))].join(', ')}</span></div> },
              {
                id: 'dates', header: 'Dates',
                cell: ({ row }) => {
                  const s = row.original;
                  return <div className="cell-stack">
                    <span>{s.status === 'DRAFT' ? `Created ${date(s.createdAt)}` : s.confirmedAt ? `Left ${date(s.confirmedAt)}` : ''}</span>
                    <span>{s.deliveredAt ? `Delivered ${date(s.deliveredAt)}` : s.expectedAt ? `Expected ${date(s.expectedAt)}` : ''}</span>
                  </div>;
                },
              },
              { accessorKey: 'status', header: 'Status', cell: ({ row }) => <span style={{ display: 'flex', gap: 4 }}><Badge value={row.original.status === 'DRAFT' ? 'PENDING' : row.original.status}>{row.original.status === 'DRAFT' ? 'Ready' : row.original.status === 'DISPATCHED' ? 'In transit' : row.original.status === 'DELIVERED' ? 'Delivered' : 'Cancelled'}</Badge>{isLate(row.original) && <Badge value="REJECTED">Late</Badge>}</span> },
              { id: 'actions', header: '', cell: ({ row }) => actionsFor(row.original) },
            ]}
          />
        ) : (
          <Empty title={tab === 'DRAFT' ? 'No shipments waiting' : 'Nothing here'} description={tab === 'DRAFT' && canManage ? 'Create a dispatch from quality-passed rolls.' : 'Shipments appear here as their status changes.'} action={tab === 'DRAFT' && canManage ? <Button onClick={() => setCreate(true)}><Plus size={15} /> Create dispatch</Button> : undefined} />
        )}
      </Panel>

      {manifest && (
        <Modal open onClose={() => setManifest(null)} title={`${manifest.number} · ${manifest.order.buyer.name}`} description={`${manifest.order.number} · ${manifest.transport}${manifest.driverName ? ` · ${manifest.driverName} ${manifest.driverPhone}` : ''}`}>
          <div className="batch-flags" style={{ marginBottom: 12 }}>
            <Badge value={manifest.status} />
            {manifest.invoice && <span className="flag">Invoice {manifest.invoice.number} · {money(manifest.invoice.total)} · {manifest.invoice.status}</span>}
            {manifest.expectedAt && <span className="flag">Expected {date(manifest.expectedAt)}</span>}
            {manifest.deliveredAt && <span className="flag stock">Delivered {date(manifest.deliveredAt)}{manifest.receivedBy ? ` · ${manifest.receivedBy}` : ''}</span>}
          </div>
          <div className="record-list">
            {manifest.rolls.map((r) => (
              <div className="record" key={r.id}>
                <div><strong>{r.roll.code}</strong> · {r.roll.fabric} · {r.roll.color}</div>
                <span className="record-meta">{number(r.roll.length)} m · {r.verified ? 'Scanned' : 'Not scanned'}</span>
              </div>
            ))}
          </div>
          {manifest.events.length > 0 && (
            <div className="history-list" style={{ marginTop: 14 }}>
              {manifest.events.map((e, i) => (
                <div key={i}><p>{e.detail}</p><small>{e.actorName} · {new Date(e.createdAt).toLocaleString('en-IN')}</small></div>
              ))}
            </div>
          )}
          <div className="dialog-footer">
            <Button variant="outline" onClick={() => window.print()}>Print</Button>
            <Button onClick={() => setManifest(null)}>Close</Button>
          </div>
        </Modal>
      )}

      {scan && (
        <ScanDialog
          onClose={() => setScan(null)}
          onScan={(code) => {
            action.mutate({ path: `/shipments/${scan}/verify`, body: { code } });
            setScan(null);
          }}
        />
      )}
      {create && <NewShipment onClose={() => setCreate(false)} />}
      {spec && <ActionForm spec={spec} onClose={() => setSpec(null)} />}
    </>
  );
}
