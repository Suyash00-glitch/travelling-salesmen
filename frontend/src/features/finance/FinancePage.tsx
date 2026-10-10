import { useState } from 'react';
import {
  Wallet,
  ArrowDownLeft,
  Receipt,
  ChartNoAxesCombined,
  Plus,
  CalendarDays,
} from 'lucide-react';
import { useData } from '../../hooks/useFactory';
import { Button } from '../../components/ui/button';
import { ActionForm, type FormSpec } from '../../components/shared/ActionForm';
import {
  PageHeader,
  Panel,
  Loading,
  ErrorState,
  Badge,
  Kpi,
  ExportButton,
} from '../../components/shared/common';
import { DataTable } from '../../components/tables/DataTable';
import { StatusDonut } from '../../components/shared/FactoryInsights';
import { money, date, exportCsv, label } from '../../lib/utils';

export interface Finance {
  billed: string;
  received: string;
  cost: string;
  expenses: string;
  outstanding: string;
  estimatedProfit: string;
  cashMovement: string;
  wages: string;
  invoices: {
    id: string;
    number: string;
    buyer: string;
    order: string;
    total: string;
    paid: string;
    status: string;
    createdAt: string;
  }[];
  bills: {
    id: string;
    supplier: string;
    reference: string;
    total: string;
    paid: string;
    dueAt: string;
  }[];
  costBreakdown: {
    category: string;
    amount: string;
  }[];
  orders: {
    id: string;
    number: string;
    buyer: string;
    estimatedRevenue: string;
    billed: string;
    actualCost: string;
    margin: string;
  }[];
}

export function FinancePage() {
  const [month, setMonth] = useState('');
  const query = useData<Finance>(`/reports/finance${month ? `?month=${month}` : ''}`);
  const [tab, setTab] = useState('Buyer invoices');
  const [spec, setSpec] = useState<FormSpec | null>(null);

  if (query.isPending) return <Loading />;
  if (query.error) return <ErrorState error={query.error} retry={() => void query.refetch()} />;

  const d = query.data!;

  const openExpenseForm = () => {
    setSpec({
      title: 'Record operating expense',
      path: '/expenses',
      fields: [
        {
          name: 'category',
          label: 'Category',
          type: 'select',
          options: ['Utilities', 'Rent', 'Transport', 'Maintenance', 'Other'].map((s) => ({
            value: s,
            label: s,
          })),
        },
        { name: 'amount', label: 'Amount (₹)', type: 'number', min: 0.01 },
        { name: 'description', label: 'Description', type: 'textarea', span: true },
      ],
    });
  };

  const handleExport = () => {
    exportCsv(
      'finance-report',
      tab === 'Order profitability'
        ? d.orders
        : tab === 'Buyer invoices'
          ? d.invoices
          : d.bills
    );
  };

  return (
    <>
      <PageHeader
        eyebrow="COSTS, CASH & CLARITY"
        title="Finance overview"
        description="Review invoices, payments, production costs and outstanding balances."
      >
        <label className="date-button">
          <CalendarDays size={16} />
          <input
            type="month"
            aria-label="Financial reporting month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
          />
          {!month && <span>All time</span>}
        </label>
        <Button onClick={openExpenseForm}>
          <Plus size={16} />
          Record expense
        </Button>
      </PageHeader>

      <div className="kpi-grid">
        <Kpi
          label="Revenue billed"
          value={money(d.billed)}
          icon={<Receipt size={19} />}
          meta="Confirmed shipments · Excludes void invoices"
          accent
        />
        <Kpi
          label="Payments received"
          value={money(d.received)}
          icon={<ArrowDownLeft size={19} />}
          meta="Actual buyer payment records"
        />
        <Kpi
          label="Outstanding receivables"
          value={money(d.outstanding)}
          icon={<Wallet size={19} />}
          meta="Billed amount less payments received"
        />
        <Kpi
          label="Actual production cost"
          value={money(d.cost)}
          icon={<ChartNoAxesCombined size={19} />}
          meta="Materials, labour, machine, overhead & rework"
        />
      </div>

      <div className="finance-grid">
        <StatusDonut
          title="Production cost breakdown"
          description="Actual costs allocated to production"
          unit="₹"
          items={d.costBreakdown.map((c) => ({
            name: label(c.category),
            value: Number(c.amount),
          }))}
        />
        <Panel title="The bigger picture" subtitle="Operational estimates, clearly separated">
          <dl className="finance-summary">
            <div>
              <dt>Revenue billed</dt>
              <dd>{money(d.billed)}</dd>
            </div>
            <div>
              <dt>Production allocations</dt>
              <dd>− {money(d.cost)}</dd>
            </div>
            <div>
              <dt>Operating expenses</dt>
              <dd>− {money(d.expenses)}</dd>
            </div>
            <div className="summary-total">
              <dt>Operating profit estimate</dt>
              <dd className={Number(d.estimatedProfit) < 0 ? 'red-text' : 'green-text'}>
                {money(d.estimatedProfit)}
              </dd>
            </div>
            <div>
              <dt>Net cash movement</dt>
              <dd>{money(d.cashMovement)}</dd>
            </div>
          </dl>
          <p className="finance-footnote">
            Includes work-in-progress costs. This operating estimate is not a general ledger or statutory profit statement. Payroll payments and allocated job labour are tracked separately.
          </p>
        </Panel>
      </div>

      <Panel className="mt-5">
        <div className="table-toolbar">
          <div className="tabs">
            {['Buyer invoices', 'Supplier bills', 'Order profitability'].map((t) => (
              <button
                className={tab === t ? 'active' : ''}
                onClick={() => setTab(t)}
                key={t}
              >
                {t}
              </button>
            ))}
          </div>
          <ExportButton onClick={handleExport} />
        </div>

        {tab === 'Buyer invoices' ? (
          <DataTable
            data={d.invoices}
            columns={[
              {
                accessorKey: 'number',
                header: 'Invoice',
                cell: ({ row }) => (
                  <div className="cell-stack">
                    <strong>{row.original.number}</strong>
                    <span>{row.original.order}</span>
                  </div>
                ),
              },
              { accessorKey: 'buyer', header: 'Buyer' },
              {
                accessorKey: 'total',
                header: 'Billed',
                cell: ({ row }) => money(row.original.total),
              },
              {
                accessorKey: 'paid',
                header: 'Received',
                cell: ({ row }) => money(row.original.paid),
              },
              {
                id: 'due',
                header: 'Outstanding',
                cell: ({ row }) => (
                  <strong>{money(Number(row.original.total) - Number(row.original.paid))}</strong>
                ),
              },
              {
                accessorKey: 'status',
                header: 'Status',
                cell: ({ row }) => <Badge value={row.original.status} />,
              },
              {
                id: 'pay',
                header: '',
                cell: ({ row }) =>
                  row.original.status !== 'PAID' && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setSpec({
                          title: 'Record buyer payment',
                          description: row.original.number,
                          path: `/invoices/${row.original.id}/payments`,
                          fields: [
                            {
                              name: 'amount',
                              label: 'Amount received (₹)',
                              type: 'number',
                              min: 0.01,
                              max: Number(row.original.total) - Number(row.original.paid),
                            },
                            { name: 'reference', label: 'Payment reference' },
                          ],
                        })
                      }
                    >
                      Record payment
                    </Button>
                  ),
              },
            ]}
          />
        ) : tab === 'Supplier bills' ? (
          <DataTable
            data={d.bills}
            columns={[
              { accessorKey: 'reference', header: 'Receipt reference' },
              { accessorKey: 'supplier', header: 'Supplier' },
              {
                accessorKey: 'total',
                header: 'Bill total',
                cell: ({ row }) => money(row.original.total),
              },
              {
                accessorKey: 'paid',
                header: 'Paid',
                cell: ({ row }) => money(row.original.paid),
              },
              {
                accessorKey: 'dueAt',
                header: 'Due date',
                cell: ({ row }) => date(row.original.dueAt),
              },
              {
                id: 'pay',
                header: '',
                cell: ({ row }) =>
                  Number(row.original.total) > Number(row.original.paid) ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        setSpec({
                          title: 'Record supplier payment',
                          description: row.original.supplier,
                          path: `/bills/${row.original.id}/payments`,
                          fields: [
                            {
                              name: 'amount',
                              label: 'Amount paid (₹)',
                              type: 'number',
                              min: 0.01,
                              max: Number(row.original.total) - Number(row.original.paid),
                            },
                            { name: 'reference', label: 'Payment reference' },
                          ],
                        })
                      }
                    >
                      Record payment
                    </Button>
                  ) : (
                    <Badge value="PAID" />
                  ),
              },
            ]}
          />
        ) : (
          <DataTable
            data={d.orders}
            columns={[
              { accessorKey: 'number', header: 'Order' },
              { accessorKey: 'buyer', header: 'Buyer' },
              {
                accessorKey: 'estimatedRevenue',
                header: 'Expected sales',
                cell: ({ row }) => money(row.original.estimatedRevenue),
              },
              {
                accessorKey: 'billed',
                header: 'Revenue billed',
                cell: ({ row }) => money(row.original.billed),
              },
              {
                accessorKey: 'actualCost',
                header: 'Actual costs',
                cell: ({ row }) => money(row.original.actualCost),
              },
              {
                accessorKey: 'margin',
                header: 'Billed less costs',
                cell: ({ row }) => (
                  <strong
                    className={
                      Number(row.original.margin) < 0 ? 'amber-text' : 'green-text'
                    }
                  >
                    {money(row.original.margin)}
                  </strong>
                ),
              },
            ]}
          />
        )}
      </Panel>

      {spec && <ActionForm spec={spec} onClose={() => setSpec(null)} />}
    </>
  );
}
