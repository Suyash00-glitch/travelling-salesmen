import { useState } from 'react';
import { Plus, PackageCheck, Building2, ShoppingCart, Truck, CalendarClock } from 'lucide-react';
import type { PageResponse } from '@loomos/shared';
import { useData, useLookups } from '../../hooks/useFactory';
import { Button } from '../../components/ui/button';
import { ActionForm, type FormSpec } from '../../components/shared/ActionForm';
import {
  PageHeader,
  Panel,
  Loading,
  ErrorState,
  Badge,
  SearchBox,
  Kpi,
} from '../../components/shared/common';
import { DataTable } from '../../components/tables/DataTable';
import { number, money, date, today } from '../../lib/utils';

interface Purchase {
  id: string;
  number: string;
  supplierId: string;
  supplier: {
    name: string;
  };
  material: string;
  color: string;
  specification: string;
  quantity: string;
  costPerKg: string;
  status: string;
  expectedAt: string;
  receipts: {
    quantity: string;
  }[];
}

export function ProcurementPage() {
  const query = useData<PageResponse<Purchase>>('/purchases?pageSize=100');
  const lookups = useLookups();
  const [spec, setSpec] = useState<FormSpec | null>(null);
  const [search, setSearch] = useState('');

  if (query.isPending) return <Loading />;
  if (query.error) return <ErrorState error={query.error} retry={() => void query.refetch()} />;

  const purchases = query.data?.data ?? [];

  const openAddSupplier = () => {
    setSpec({
      title: 'Add supplier',
      path: '/suppliers',
      fields: [
        { name: 'name', label: 'Supplier name' },
        { name: 'email', label: 'Email', type: 'email' },
        { name: 'city', label: 'City' },
      ],
    });
  };

  const openNewPurchase = () => {
    setSpec({
      title: 'Create purchase order',
      path: '/purchases',
      fields: [
        {
          name: 'supplierId',
          label: 'Supplier',
          type: 'select',
          options: lookups.data?.suppliers.map((s) => ({ value: s.id, label: s.name })),
        },
        { name: 'material', label: 'Material', value: 'Cotton yarn' },
        { name: 'color', label: 'Colour', value: 'Natural' },
        { name: 'specification', label: 'Specification', value: '40s combed' },
        { name: 'quantity', label: 'Quantity (kg)', type: 'number', min: 0.001 },
        { name: 'costPerKg', label: 'Unit cost (₹/kg)', type: 'number', min: 0.01 },
        { name: 'expectedAt', label: 'Expected delivery', type: 'date', value: today() },
      ],
    });
  };

  const openReceiveForm = (p: Purchase) => {
    const remaining =
      Number(p.quantity) - p.receipts.reduce((s, r) => s + Number(r.quantity), 0);
    setSpec({
      title: 'Receive purchase order',
      description: `${p.number} · ${p.supplier.name}`,
      path: '/inventory/receipts',
      fields: [
        {
          name: 'reference',
          label: 'Receipt reference',
          value: `GRN-${Date.now().toString().slice(-6)}`,
        },
        {
          name: 'quantity',
          label: 'Received quantity (kg)',
          type: 'number',
          value: remaining,
        },
        {
          name: 'location',
          label: 'Warehouse location',
          value: 'Warehouse A · Rack 1',
        },
      ],
      transform: (d) => ({
        ...d,
        purchaseId: p.id,
        supplierId: p.supplierId,
        material: p.material,
        specification: p.specification,
        color: p.color,
        costPerKg: p.costPerKg,
        threshold: 100,
      }),
    });
  };

  const filteredPurchases = purchases.filter((p) =>
    `${p.number} ${p.supplier.name}`.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <>
      <PageHeader
        eyebrow="SUPPLIERS & SOURCING"
        title="Purchasing & suppliers"
        description="Track purchase orders, expected deliveries and material receipts."
      >
        <Button variant="outline" onClick={openAddSupplier}>
          <Building2 size={16} />
          Add supplier
        </Button>
        <Button onClick={openNewPurchase}>
          <Plus size={16} />
          New purchase
        </Button>
      </PageHeader>

      <div className="kpi-grid">
        <Kpi label="Open purchase orders" value={purchases.filter((p) => !['RECEIVED', 'CANCELLED'].includes(p.status)).length} icon={<ShoppingCart size={19} />} meta={`${number(purchases.filter((p) => !['RECEIVED', 'CANCELLED'].includes(p.status)).reduce((s, p) => s + Number(p.quantity) - p.receipts.reduce((r, x) => r + Number(x.quantity), 0), 0))} kg still to arrive`} accent />
        <Kpi label="Due this week" value={purchases.filter((p) => !['RECEIVED', 'CANCELLED'].includes(p.status) && p.expectedAt.slice(0, 10) <= new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)).length} icon={<CalendarClock size={19} />} meta={`${purchases.filter((p) => !['RECEIVED', 'CANCELLED'].includes(p.status) && p.expectedAt.slice(0, 10) < today()).length} overdue`} />
        <Kpi label="Received" value={purchases.filter((p) => p.status === 'RECEIVED').length} icon={<Truck size={19} />} meta={`${purchases.filter((p) => p.status === 'PARTIAL').length} partly received`} />
        <Kpi label="Suppliers" value={lookups.data?.suppliers.length ?? 0} icon={<Building2 size={19} />} meta="Yarn and material partners" />
      </div>


      <div className="supplier-grid">
        {lookups.data?.suppliers.map((s) => (
          <div className="supplier-card" key={s.id}>
            <span className="supplier-icon">
              <Building2 size={24} />
            </span>
            <div>
              <h3>{s.name}</h3>
              <p>
                {String(s.city)} · {String(s.email)}
              </p>
            </div>
            <Badge value="PASSED">Connected</Badge>
          </div>
        ))}
      </div>

      <Panel
        title="Purchase orders"
        subtitle="Source thoughtfully. Receive with confidence."
        action={<SearchBox value={search} onChange={setSearch} />}
      >
        <DataTable
          data={filteredPurchases}
          columns={[
            {
              accessorKey: 'number',
              header: 'Purchase order',
              cell: ({ row }) => (
                <div className="cell-stack">
                  <strong>{row.original.number}</strong>
                  <span>
                    {row.original.material} · {row.original.specification}
                  </span>
                </div>
              ),
            },
            { accessorKey: 'supplier.name', header: 'Supplier' },
            {
              accessorKey: 'quantity',
              header: 'Ordered',
              cell: ({ row }) => `${number(row.original.quantity)} kg`,
            },
            {
              id: 'received',
              header: 'Received',
              cell: ({ row }) =>
                `${number(row.original.receipts.reduce((s, r) => s + Number(r.quantity), 0))} kg`,
            },
            {
              accessorKey: 'costPerKg',
              header: 'Unit cost',
              cell: ({ row }) => money(row.original.costPerKg),
            },
            {
              accessorKey: 'expectedAt',
              header: 'Expected',
              cell: ({ row }) => date(row.original.expectedAt),
            },
            {
              accessorKey: 'status',
              header: 'Status',
              cell: ({ row }) => <Badge value={row.original.status} />,
            },
            {
              id: 'actions',
              header: '',
              cell: ({ row }) =>
                row.original.status !== 'RECEIVED' && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => openReceiveForm(row.original)}
                  >
                    <PackageCheck size={14} />
                    Receive
                  </Button>
                ),
            },
          ]}
        />
      </Panel>

      {spec && <ActionForm spec={spec} onClose={() => setSpec(null)} />}
    </>
  );
}
