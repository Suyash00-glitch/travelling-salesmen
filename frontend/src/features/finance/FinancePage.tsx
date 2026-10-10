import { useState } from 'react';
import { Wallet, ArrowDownLeft, Receipt, AlertCircle, Plus, CalendarDays, FileWarning, BadgeIndianRupee } from 'lucide-react';
import { useData, useLookups, useAction } from '../../hooks/useFactory';
import { Button } from '../../components/ui/button';
import { ActionForm, type FormSpec } from '../../components/shared/ActionForm';
import { FilterBar, useFilters } from '../../components/shared/FilterBar';
import { PageHeader, Panel, Loading, ErrorState, Badge, Kpi, ExportButton, Empty } from '../../components/shared/common';
import { DataTable } from '../../components/tables/DataTable';
import { money, date, exportCsv, label } from '../../lib/utils';

export interface Finance {
  billed: string;
  received: string;
  cost: string;
  expenses: string;
  outstanding: string;
  overdue: string;
  overdueCount: number;
  pendingInvoices: number;
  pendingClaims: number;
  pendingClaimAmount: string;
  estimatedProfit: string;
  wages: string;
  invoices: { id: string; number: string; buyer: string; buyerId: string; order: string; challan: string; total: string; adjustment: string; paid: string; outstanding: string; status: string; createdAt: string; dueAt: string | null; overdue: boolean }[];
  payments: { id: string; reference: string; amount: string; createdAt: string; invoice: string; buyer: string; order: string }[];
  bills: { id: string; supplier: string; reference: string; total: string; paid: string; dueAt: string }[];
  expenseList: { id: string; category: string; description: string; amount: string; recordedBy: string; createdAt: string }[];
  claims: { id: string; number: string; party: string; who: string; order: string; invoice: string; amount: string; reason: string; status: string; note: string; createdAt: string; createdBy: string }[];
  wageList: { id: string; worker: string; amount: string; calculation: string; paidAt: string | null; date: string }[];
  costBreakdown: { category: string; amount: string }[];
  orders: { id: string; number: string; buyer: string; estimatedRevenue: string; billed: string; actualCost: string; margin: string }[];
}

const tabs = ['Invoices', 'Payments', 'Claims', 'Expenses', 'Supplier bills', 'Wages', 'Order margins'];

export function FinancePage() {
  const [month, setMonth] = useState('');
  const query = useData<Finance>(`/reports/finance${month ? `?month=${month}` : ''}`);
  const lookups = useLookups();
  const action = useAction();
  const filters = useFilters(['buyerId', 'status']);
  const [tab, setTab] = useState('Invoices');
  const [spec, setSpec] = useState<FormSpec | null>(null);

  if (query.isPending) return <Loading />;
  if (query.error) return <ErrorState error={query.error} retry={() => void query.refetch()} />;

  const d = query.data!;
  const buyerName = lookups.data?.buyers.find((b) => b.id === filters.values.buyerId)?.name;
  const invoices = d.invoices
    .filter((i) => !filters.values.buyerId || i.buyerId === filters.values.buyerId)
    .filter((i) => !filters.values.status || (filters.values.status === 'OVERDUE' ? i.overdue : filters.values.status === 'OPEN' ? Number(i.outstanding) > 0 : i.status === filters.values.status));
  const payments = d.payments.filter((p) => !buyerName || p.buyer === buyerName);
  const claims = d.claims.filter((c) => !buyerName || c.who === buyerName).filter((c) => !filters.values.status || c.status === filters.values.status);

  const paymentForm = (inv: Finance['invoices'][number]): FormSpec => ({
    title: `Record payment · ${inv.number}`,
    description: `${inv.buyer} · outstanding ${money(inv.outstanding)}`,
    path: `/invoices/${inv.id}/payments`,
    fields: [
      { name: 'amount', label: 'Amount received (₹)', type: 'number', min: 0.01, value: Number(inv.outstanding) },
      { name: 'reference', label: 'Bank / cheque reference', hint: 'Must be unique: the same reference cannot be recorded twice.' },
    ],
    submit: 'Record payment',
  });

  const claimForm: FormSpec = {
    title: 'New claim',
    description: 'A money claim with a buyer or supplier: damage, shortage, price difference.',
    path: '/claims',
    fields: [
      { name: 'party', label: 'Claim with', type: 'select', value: 'BUYER', options: [{ value: 'BUYER', label: 'Buyer (we owe a credit)' }, { value: 'SUPPLIER', label: 'Supplier (they owe us)' }] },
      { name: 'buyerId', label: 'Buyer', type: 'select', required: false, options: (lookups.data?.buyers ?? []).map((b) => ({ value: b.id, label: b.name })) },
      { name: 'supplierId', label: 'Supplier', type: 'select', required: false, options: (lookups.data?.suppliers ?? []).map((s) => ({ value: s.id, label: s.name })) },
      { name: 'invoiceId', label: 'Invoice (buyer claims)', type: 'select', required: false, options: d.invoices.map((i) => ({ value: i.id, label: `${i.number} · ${i.buyer} · ${money(i.total)}` })), hint: 'An approved claim credits this invoice.' },
      { name: 'amount', label: 'Amount (₹)', type: 'number', min: 0.01 },
      { name: 'reason', label: 'Reason', type: 'textarea', span: true },
    ],
    transform: (f) => Object.fromEntries(Object.entries(f).filter(([, v]) => v !== '')),
    submit: 'Create claim',
  };

  const decideForm = (c: Finance['claims'][number], decision: string): FormSpec => ({
    title: `${label(decision)} · ${c.number}`,
    description: `${c.who} · ${money(c.amount)} · ${c.reason}`,
    path: `/claims/${c.id}/decide`,
    fields: [{ name: 'note', label: 'Note', required: false, span: true }],
    transform: (f) => ({ ...f, decision }),
    submit: label(decision),
  });

  const expenseForm: FormSpec = {
    title: 'Record expense',
    path: '/expenses',
    fields: [
      { name: 'category', label: 'Category', type: 'select', options: ['Utilities', 'Rent', 'Transport', 'Maintenance', 'Salaries', 'Other'].map((s) => ({ value: s, label: s })) },
      { name: 'amount', label: 'Amount (₹)', type: 'number', min: 0.01 },
      { name: 'description', label: 'Description', type: 'textarea', span: true },
    ],
    submit: 'Save expense',
  };

  const statusOptions = tab === 'Claims'
    ? ['PENDING', 'APPROVED', 'REJECTED', 'RESOLVED'].map((s) => ({ value: s, label: label(s) }))
    : [{ value: 'OPEN', label: 'Unpaid' }, { value: 'OVERDUE', label: 'Overdue' }, { value: 'PAID', label: 'Paid' }];

  return (
    <>
      <PageHeader eyebrow="ACCOUNTS" title="Accounts" description="Invoices, payments, claims and expenses. Every number comes from recorded transactions.">
        <label className="date-button">
          <CalendarDays size={16} />
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Month" />
        </label>
        <ExportButton onClick={() => exportCsv(`accounts-${tab.toLowerCase().replace(' ', '-')}`, tab === 'Invoices' ? invoices : tab === 'Payments' ? payments : tab === 'Claims' ? claims : tab === 'Expenses' ? d.expenseList : tab === 'Supplier bills' ? d.bills : tab === 'Wages' ? d.wageList : d.orders)} />
        {tab === 'Claims' && <Button onClick={() => setSpec(claimForm)}><Plus size={16} /> New claim</Button>}
        {tab === 'Expenses' && <Button onClick={() => setSpec(expenseForm)}><Plus size={16} /> Add expense</Button>}
      </PageHeader>

      <div className="kpi-grid">
        <Kpi label="Invoiced" value={money(d.billed)} icon={<Receipt size={19} />} meta={`${d.invoices.length} invoices${month ? ' this month' : ''}`} />
        <Kpi label="Received" value={money(d.received)} icon={<ArrowDownLeft size={19} />} meta={`${d.payments.length} payments`} accent />
        <Kpi label="Outstanding" value={money(d.outstanding)} icon={<Wallet size={19} />} meta={`${d.pendingInvoices} unpaid invoices`} />
        <Kpi label="Overdue" value={money(d.overdue)} icon={<AlertCircle size={19} />} meta={`${d.overdueCount} invoices past 30 days`} />
        <Kpi label="Expenses" value={money(d.expenses)} icon={<BadgeIndianRupee size={19} />} meta={`Wages ${money(d.wages)}`} />
        <Kpi label="Pending claims" value={d.pendingClaims} icon={<FileWarning size={19} />} meta={money(d.pendingClaimAmount)} />
      </div>

      <Panel>
        <div className="tabs" style={{ marginBottom: 12 }}>
          {tabs.map((t) => (
            <button key={t} className={tab === t ? 'active' : ''} onClick={() => { setTab(t); filters.setValue('status', ''); }}>{t}</button>
          ))}
        </div>
        {['Invoices', 'Payments', 'Claims'].includes(tab) && (
          <FilterBar
            filters={[
              { name: 'buyerId', label: 'Customer', options: (lookups.data?.buyers ?? []).map((b) => ({ value: b.id, label: b.name })) },
              ...(tab === 'Payments' ? [] : [{ name: 'status', label: 'Status', options: statusOptions }]),
            ]}
            values={filters.values} onChange={filters.setValue} onClear={filters.clear} active={filters.active}
          />
        )}

        {tab === 'Invoices' && (invoices.length ? (
          <DataTable data={invoices} columns={[
            { accessorKey: 'number', header: 'Invoice', cell: ({ row }) => <div className="cell-stack"><strong>{row.original.number}</strong><span>{row.original.order} · DC {row.original.challan}</span></div> },
            { accessorKey: 'buyer', header: 'Buyer' },
            { accessorKey: 'createdAt', header: 'Issued / due', cell: ({ row }) => <div className="cell-stack"><span>{date(row.original.createdAt)}</span><span>{row.original.dueAt ? `due ${date(row.original.dueAt)}` : ''}</span></div> },
            { accessorKey: 'total', header: 'Billed', cell: ({ row }) => money(row.original.total) },
            { accessorKey: 'paid', header: 'Received', cell: ({ row }) => <div className="cell-stack"><span>{money(row.original.paid)}</span>{Number(row.original.adjustment) > 0 && <span>credit {money(row.original.adjustment)}</span>}</div> },
            { accessorKey: 'outstanding', header: 'Outstanding', cell: ({ row }) => <strong>{money(row.original.outstanding)}</strong> },
            { accessorKey: 'status', header: 'Status', cell: ({ row }) => <span style={{ display: 'flex', gap: 4 }}><Badge value={row.original.status} />{row.original.overdue && <Badge value="REJECTED">Overdue</Badge>}</span> },
            { id: 'actions', header: '', cell: ({ row }) => Number(row.original.outstanding) > 0 ? <Button size="sm" onClick={() => setSpec(paymentForm(row.original))}><ArrowDownLeft size={14} /> Record payment</Button> : null },
          ]} />
        ) : <Empty title="No invoices" description="Invoices are raised when a dispatch is confirmed." />)}

        {tab === 'Payments' && (payments.length ? (
          <DataTable data={payments} columns={[
            { accessorKey: 'createdAt', header: 'Date', cell: ({ row }) => date(row.original.createdAt) },
            { accessorKey: 'buyer', header: 'Buyer' },
            { accessorKey: 'invoice', header: 'Invoice / order', cell: ({ row }) => <div className="cell-stack"><strong>{row.original.invoice}</strong><span>{row.original.order}</span></div> },
            { accessorKey: 'reference', header: 'Reference' },
            { accessorKey: 'amount', header: 'Amount', cell: ({ row }) => <strong>{money(row.original.amount)}</strong> },
          ]} />
        ) : <Empty title="No payments yet" description="Record payments from the Invoices tab." />)}

        {tab === 'Claims' && (claims.length ? (
          <DataTable data={claims} columns={[
            { accessorKey: 'number', header: 'Claim', cell: ({ row }) => <div className="cell-stack"><strong>{row.original.number}</strong><span>{date(row.original.createdAt)} · {row.original.createdBy}</span></div> },
            { accessorKey: 'who', header: 'With', cell: ({ row }) => <div className="cell-stack"><strong>{row.original.who}</strong><span>{label(row.original.party)}{row.original.invoice ? ` · ${row.original.invoice}` : ''}{row.original.order ? ` · ${row.original.order}` : ''}</span></div> },
            { accessorKey: 'reason', header: 'Reason', cell: ({ row }) => <div className="cell-stack"><span>{row.original.reason}</span>{row.original.note && <span>{row.original.note}</span>}</div> },
            { accessorKey: 'amount', header: 'Amount', cell: ({ row }) => <strong>{money(row.original.amount)}</strong> },
            { accessorKey: 'status', header: 'Status', cell: ({ row }) => <Badge value={row.original.status === 'APPROVED' ? 'PASSED' : row.original.status} >{label(row.original.status)}</Badge> },
            { id: 'actions', header: '', cell: ({ row }) => (
              <div style={{ display: 'flex', gap: 6 }}>
                {row.original.status === 'PENDING' && <><Button size="sm" onClick={() => setSpec(decideForm(row.original, 'APPROVED'))}>Approve</Button><Button size="sm" variant="outline" onClick={() => setSpec(decideForm(row.original, 'REJECTED'))}>Reject</Button></>}
                {row.original.status === 'APPROVED' && <Button size="sm" variant="outline" onClick={() => setSpec(decideForm(row.original, 'RESOLVED'))}>Mark resolved</Button>}
              </div>
            ) },
          ]} />
        ) : <Empty title="No claims" description="Record a claim when goods are damaged, short, or priced wrongly." />)}

        {tab === 'Expenses' && (d.expenseList.length ? (
          <DataTable data={d.expenseList} columns={[
            { accessorKey: 'createdAt', header: 'Date', cell: ({ row }) => date(row.original.createdAt) },
            { accessorKey: 'category', header: 'Category', cell: ({ row }) => <Badge value="PLANNED">{row.original.category}</Badge> },
            { accessorKey: 'description', header: 'Description' },
            { accessorKey: 'recordedBy', header: 'Recorded by' },
            { accessorKey: 'amount', header: 'Amount', cell: ({ row }) => <strong>{money(row.original.amount)}</strong> },
          ]} />
        ) : <Empty title="No expenses recorded" />)}

        {tab === 'Supplier bills' && (
          <DataTable data={d.bills} columns={[
            { accessorKey: 'reference', header: 'Receipt' },
            { accessorKey: 'supplier', header: 'Supplier' },
            { accessorKey: 'total', header: 'Bill', cell: ({ row }) => money(row.original.total) },
            { accessorKey: 'paid', header: 'Paid', cell: ({ row }) => money(row.original.paid) },
            { accessorKey: 'dueAt', header: 'Due', cell: ({ row }) => date(row.original.dueAt) },
            { id: 'actions', header: '', cell: ({ row }) => Number(row.original.total) > Number(row.original.paid) ? <Button size="sm" variant="outline" onClick={() => setSpec({
              title: `Pay supplier · ${row.original.supplier}`, path: `/bills/${row.original.id}/payments`,
              fields: [{ name: 'amount', label: 'Amount (₹)', type: 'number', min: 0.01, value: Number(row.original.total) - Number(row.original.paid) }, { name: 'reference', label: 'Reference' }],
              submit: 'Record payment',
            })}>Pay</Button> : <Badge value="PAID" /> },
          ]} />
        )}

        {tab === 'Wages' && (
          <DataTable data={d.wageList} columns={[
            { accessorKey: 'date', header: 'Day', cell: ({ row }) => date(row.original.date) },
            { accessorKey: 'worker', header: 'Worker' },
            { accessorKey: 'calculation', header: 'Basis' },
            { accessorKey: 'amount', header: 'Amount', cell: ({ row }) => money(row.original.amount) },
            { id: 'paid', header: 'Status', cell: ({ row }) => row.original.paidAt ? <Badge value="PAID">Paid {date(row.original.paidAt)}</Badge> : <Button size="sm" variant="outline" disabled={action.isPending} onClick={() => action.mutate({ path: `/wages/${row.original.id}/pay` })}>Pay</Button> },
          ]} />
        )}

        {tab === 'Order margins' && (
          <DataTable data={d.orders} columns={[
            { accessorKey: 'number', header: 'Order' },
            { accessorKey: 'buyer', header: 'Buyer' },
            { accessorKey: 'estimatedRevenue', header: 'Order value', cell: ({ row }) => money(row.original.estimatedRevenue) },
            { accessorKey: 'billed', header: 'Billed', cell: ({ row }) => money(row.original.billed) },
            { accessorKey: 'actualCost', header: 'Cost so far', cell: ({ row }) => money(row.original.actualCost) },
            { accessorKey: 'margin', header: 'Margin', cell: ({ row }) => <strong className={Number(row.original.margin) < 0 ? 'red-text' : 'green-text'}>{money(row.original.margin)}</strong> },
          ]} />
        )}
      </Panel>

      {spec && <ActionForm spec={spec} onClose={() => setSpec(null)} />}
    </>
  );
}
