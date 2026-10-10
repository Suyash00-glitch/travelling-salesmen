import { useState } from 'react';
import {
  Truck,
  Plus,
  ScanLine,
  Check,
  PackageCheck,
  FileText,
  ArrowRight,
  Package,
  ClipboardList,
} from 'lucide-react';
import type { PageResponse } from '@loomos/shared';
import { useData, useAction } from '../../hooks/useFactory';
import { Button } from '../../components/ui/button';
import { Modal } from '../../components/ui/dialog';
import { ActionForm, type FormSpec } from '../../components/shared/ActionForm';
import {
  PageHeader,
  Panel,
  Loading,
  ErrorState,
  Badge,
  SearchBox,
  Empty,
} from '../../components/shared/common';
import { DataTable } from '../../components/tables/DataTable';
import { ScanDialog } from '../quality/QualityPage';
import { number, date, money } from '../../lib/utils';
import { TruckWorkspace } from './TruckWorkspace';
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
  dispatcher: string | null;
  events: { action: string; detail: string; actorName: string; createdAt: string }[];
  order: {
    number: string;
    buyer: {
      name: string;
      city?: string;
    };
  };
  rolls: {
    id: string;
    verified: boolean;
    roll: {
      id: string;
      code: string;
      length: string;
      quality: string;
      fabric: string;
      color: string;
    };
  }[];
  invoice: {
    number: string;
    total: string;
    status: string;
  } | null;
}

export function DispatchPage({ buyer = false }: { buyer?: boolean }) {
  const query = useData<PageResponse<ShipmentView>>('/shipments?pageSize=100');
  const [create, setCreate] = useState(false);
  const [scan, setScan] = useState<string | null>(null);
  const [spec, setSpec] = useState<FormSpec | null>(null);
  const [invoice, setInvoice] = useState<ShipmentView | null>(null);
  const [manifest, setManifest] = useState<ShipmentView | null>(null);
  const [search, setSearch] = useState('');
  const action = useAction();

  if (query.isPending) return <Loading />;
  if (query.error) return <ErrorState error={query.error} retry={() => void query.refetch()} />;

  const shipments = query.data?.data ?? [];
  const filtered = shipments.filter((s) =>
    `${s.number} ${s.order.buyer.name} ${s.transport}`
      .toLowerCase()
      .includes(search.toLowerCase())
  );

  function shipmentActions(shipment: ShipmentView) {
    const canConfirm = shipment.rolls.length > 0 && shipment.rolls.every((r) => r.verified);
    return (
      <>
        {shipment.status === 'DRAFT' && !buyer && (
          <>
            <Button variant="outline" size="sm" onClick={() => setScan(shipment.id)}>
              <ScanLine size={15} />
              Verify roll
            </Button>
            <Button
              size="sm"
              disabled={action.isPending || !canConfirm}
              title={!canConfirm ? 'Verify all roll labels before dispatch' : undefined}
              onClick={() => action.mutate({ path: `/shipments/${shipment.id}/confirm` })}
            >
              <Check size={15} />
              Confirm dispatch
            </Button>
          </>
        )}
        <Button variant="outline" size="sm" onClick={() => setManifest(shipment)}>
          <ClipboardList size={15} />
          Manifest
        </Button>
      </>
    );
  }

  const awaitingDispatchCount = shipments.filter((s) => s.status === 'DRAFT').length;
  const dispatchedCount = shipments.filter((s) => s.status === 'DISPATCHED').length;
  const labelsToVerifyCount = shipments
    .filter((s) => s.status === 'DRAFT')
    .reduce((sum, s) => sum + s.rolls.filter((r) => !r.verified).length, 0);
  const totalDispatchedQuantity = shipments
    .filter((s) => s.status === 'DISPATCHED')
    .reduce((sum, s) => sum + Number(s.quantity), 0);

  return (
    <>
      <PageHeader
        eyebrow="WAREHOUSE OPERATIONS"
        title={buyer ? 'Your deliveries' : 'Dispatch & logistics'}
        description="Choose a truck, verify its cargo and confirm the shipment."
      >
        {!buyer && (
          <Button onClick={() => setCreate(true)}>
            <Plus size={16} />
            Create dispatch
          </Button>
        )}
      </PageHeader>

      <div className="summary-strip">
        <div>
          <Truck size={22} />
          <span>
            <strong>{awaitingDispatchCount}</strong>Awaiting dispatch
          </span>
        </div>
        <div>
          <PackageCheck size={22} />
          <span>
            <strong>{dispatchedCount}</strong>Dispatched shipments
          </span>
        </div>
        <div>
          <ScanLine size={22} />
          <span>
            <strong>{labelsToVerifyCount}</strong>Labels to verify
          </span>
        </div>
        <div>
          <Package size={22} />
          <span>
            <strong>{number(totalDispatchedQuantity)} m</strong>Handed to transport
          </span>
        </div>
      </div>


      <TruckWorkspace shipments={shipments} actions={shipmentActions} onScan={buyer ? undefined : setScan} />

      <Panel
        title="Shipment records"
        subtitle="Search a shipment and open its full manifest"
        action={
          <SearchBox
            value={search}
            onChange={setSearch}
            placeholder="Search shipment, buyer or truck…"
          />
        }
      >
        {filtered.length ? (
          <DataTable
            data={filtered}
            onRow={setManifest}
            columns={[
              {
                accessorKey: 'number',
                header: 'Shipment',
                cell: ({ row }) => (
                  <div className="buyer-cell">
                    <span className="entity-icon">
                      <Truck size={19} />
                    </span>
                    <div className="cell-stack">
                      <strong>{row.original.number}</strong>
                      <span>{row.original.order.number}</span>
                    </div>
                  </div>
                ),
              },
              { accessorKey: 'order.buyer.name', header: 'Buyer' },
              {
                accessorKey: 'transport',
                header: 'Truck / driver',
                cell: ({ row }) => (
                  <div className="cell-stack">
                    <strong>{row.original.transport}</strong>
                    <span>{row.original.driverName || 'Driver not recorded'}</span>
                  </div>
                ),
              },
              {
                accessorKey: 'quantity',
                header: 'Cargo',
                cell: ({ row }) => (
                  <div className="cell-stack">
                    <strong>{number(row.original.quantity)} m</strong>
                    <span>{row.original.rolls.length} rolls</span>
                  </div>
                ),
              },
              {
                accessorKey: 'status',
                header: 'Status',
                cell: ({ row }) => <Badge value={row.original.status} />,
              },
              {
                id: 'manifest',
                header: 'Details',
                cell: ({ row }) => (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setManifest(row.original)}
                  >
                    <FileText size={14} />
                    Manifest
                    <ArrowRight size={14} />
                  </Button>
                ),
              },
            ]}
          />
        ) : (
          <Empty
            title={search ? 'No matching shipments' : 'No shipments yet'}
            description={
              search
                ? 'Try a shipment number, buyer name or transport reference.'
                : 'Create a dispatch from quality-approved finished rolls.'
            }
          />
        )}
      </Panel>

      {manifest && (
        <Modal
          open
          onClose={() => setManifest(null)}
          title={`${manifest.number} · Cargo manifest`}
          description={`${manifest.transport} · ${manifest.order.buyer.name}`}
          wide
        >
          <div className="manifest-summary">
            <Badge value={manifest.status} />
            <strong>
              {number(manifest.quantity)} metres · {manifest.rolls.length} rolls
            </strong>
            <span>Created {date(manifest.createdAt)}</span>
          </div>
          <DataTable
            data={manifest.rolls}
            columns={[
              {
                id: 'roll',
                header: 'Fabric roll',
                cell: ({ row }) => (
                  <div className="buyer-cell">
                    <Package size={17} />
                    <strong>{row.original.roll.code}</strong>
                  </div>
                ),
              },
              {
                id: 'length',
                header: 'Length',
                cell: ({ row }) => `${number(row.original.roll.length)} m`,
              },
              {
                id: 'quality',
                header: 'Quality',
                cell: ({ row }) => <Badge value={row.original.roll.quality} />,
              },
              {
                id: 'verified',
                header: 'Label',
                cell: ({ row }) => (
                  <Badge value={row.original.verified ? 'PASSED' : 'PENDING'}>
                    {row.original.verified ? 'Verified' : 'To verify'}
                  </Badge>
                ),
              },
            ]}
          />
          <div className="dialog-footer">
            {manifest.invoice && (
              <Button
                variant="outline"
                onClick={() => {
                  setInvoice(manifest);
                  setManifest(null);
                }}
              >
                <FileText size={15} />
                View invoice
              </Button>
            )}
            {manifest.status !== 'CANCELLED' && !buyer && (
              <Button
                variant="danger"
                onClick={() => {
                  setSpec({
                    title: 'Cancel shipment',
                    description:
                      'This releases the rolls back to stock and voids any unpaid invoice. The reversal remains in the audit trail.',
                    path: `/shipments/${manifest.id}/cancel`,
                    fields: [
                      {
                        name: 'reason',
                        label: 'Cancellation reason',
                        type: 'textarea',
                        span: true,
                      },
                    ],
                    submit: 'Confirm cancellation',
                  });
                  setManifest(null);
                }}
              >
                Cancel shipment
              </Button>
            )}
            <Button variant="outline" onClick={() => setManifest(null)}>
              Done
            </Button>
          </div>
        </Modal>
      )}

      {create && <NewShipment onClose={() => setCreate(false)} />}

      {scan && (
        <ScanDialog
          onClose={() => setScan(null)}
          onScan={(code) => {
            action.mutate({ path: `/shipments/${scan}/verify`, body: { code } });
            setScan(null);
          }}
        />
      )}

      {spec && <ActionForm spec={spec} onClose={() => setSpec(null)} />}

      {invoice?.invoice && (
        <Modal
          open
          onClose={() => setInvoice(null)}
          title={invoice.invoice.number}
          description="Everest Textile Mills · Sales invoice"
        >
          <div className="invoice-paper">
            <div className="invoice-brand">
              LoomOS<span>SALES INVOICE</span>
            </div>
            <p>
              Bill to <strong>{invoice.order.buyer.name}</strong>
            </p>
            <dl className="detail-list">
              <div>
                <dt>Order</dt>
                <dd>{invoice.order.number}</dd>
              </div>
              <div>
                <dt>Shipment</dt>
                <dd>{invoice.number}</dd>
              </div>
              <div>
                <dt>Fabric delivered</dt>
                <dd>{number(invoice.quantity)} metres</dd>
              </div>
              {invoice.rolls.map((r) => (
                <div key={r.id}>
                  <dt>{r.roll.code}</dt>
                  <dd>{number(r.roll.length)} m</dd>
                </div>
              ))}
            </dl>
            <div className="invoice-total">
              <span>Total (INR)</span>
              <strong>{money(invoice.invoice.total)}</strong>
            </div>
            <small>Operational invoice. Taxes are not calculated in this release.</small>
          </div>
          <div className="dialog-footer">
            <Button onClick={() => window.print()}>Print invoice</Button>
          </div>
        </Modal>
      )}
    </>
  );
}
