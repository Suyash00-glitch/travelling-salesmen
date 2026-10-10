import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, ArrowUpRight, ShoppingBag, CheckCircle2, Workflow, Truck, } from 'lucide-react';
import { can, type OrderSummary, type PageResponse } from '@loomos/shared';
import type { ColumnDef } from '@tanstack/react-table';
import { useData } from '../../hooks/useFactory';
import { useAuth } from '../auth/Auth';
import { Button } from '../../components/ui/button';
import { Badge, Panel, PageHeader, Progress, Loading, ErrorState, SearchBox, ExportButton, } from '../../components/shared/common';
import { DataTable } from '../../components/tables/DataTable';
import { date, number, exportCsv, label } from '../../lib/utils';
import { NewOrderModal } from './NewOrderModal';
export { NewOrderModal, NewOrderModal as NewOrder } from './NewOrderModal';
export { OrderDetailsPage } from './OrderDetailsPage';
export function OrdersPage() {
    const { user } = useAuth();
    const [search, setSearch] = useState('');
    const [tab, setTab] = useState('All orders');
    const [create, setCreate] = useState(false);
    const navigate = useNavigate();
    const query = useData<PageResponse<OrderSummary>>('/orders?pageSize=100');
    if (query.isPending)
        return <Loading />;
    if (query.error)
        return <ErrorState error={query.error} retry={() => void query.refetch()}/>;
    const all = query.data!.data;
    const reviewCount = all.filter((o) => o.status === 'PENDING_REVIEW').length;
    const rows = all.filter((o) => `${o.number} ${o.buyer.name} ${o.items.map((i) => i.fabric).join(' ')}`
        .toLowerCase()
        .includes(search.toLowerCase()) &&
        (tab === 'All orders' ||
            (tab === 'Needs review' && o.status === 'PENDING_REVIEW') ||
            (tab === 'In production' && o.status === 'IN_PRODUCTION') ||
            (tab === 'Ready to ship' && ['READY', 'PARTIAL'].includes(o.status)) ||
            (tab === 'Completed' && o.status === 'COMPLETED')));
    const columns: ColumnDef<OrderSummary>[] = [
        {
            accessorKey: 'number',
            header: 'Order / fabric',
            cell: ({ row }) => (<div className="cell-stack">
          <strong className="order-number">{row.original.number}</strong>
          <span>{row.original.items[0]?.fabric}</span>
        </div>),
        },
        {
            accessorKey: 'buyer.name',
            header: 'Buyer',
            cell: ({ row }) => (<div className="buyer-cell">
          <span className="avatar avatar-small">{row.original.buyer.initials}</span>
          <div className="cell-stack">
            <strong>{row.original.buyer.name}</strong>
            <span>{row.original.buyer.city}</span>
          </div>
        </div>),
        },
        {
            accessorKey: 'quantity',
            header: 'Quantity',
            cell: ({ row }) => (<span className="tabular">
          {number(row.original.quantity)} <small>m</small>
        </span>),
        },
        {
            accessorKey: 'progress',
            header: 'Progress',
            cell: ({ row }) => (<div className="cell-stack">
          <Progress value={row.original.progress} label={`${row.original.progress}%`}/>
          <span>{label(row.original.stage)}</span>
        </div>),
        },
        {
            accessorKey: 'deadline',
            header: 'Delivery date',
            cell: ({ row }) => (<div className="cell-stack">
          <strong>{date(row.original.deadline)}</strong>
          {row.original.risk.reasons.length > 0 && (<span className="amber-text">Needs attention</span>)}
        </div>),
        },
        {
            accessorKey: 'priority',
            header: 'Priority',
            cell: ({ row }) => <Badge value={row.original.priority}/>,
        },
        {
            accessorKey: 'status',
            header: 'Status',
            cell: ({ row }) => <Badge value={row.original.status}/>,
        },
        {
            id: 'open',
            header: '',
            cell: () => <ArrowUpRight size={16} className="muted"/>,
        },
    ];
    return (<>
      <PageHeader eyebrow="BUYERS & SALES" title="Orders" description="Track buyer orders, production progress and delivery dates.">
        <ExportButton onClick={() => exportCsv('orders', rows.map((o) => ({
            order: o.number,
            buyer: o.buyer.name,
            metres: o.quantity,
            deadline: o.deadline,
            status: o.status,
        })))}/>
        {can(user.role, 'production') && user.role !== 'OPERATOR' && (<Button onClick={() => setCreate(true)}>
            <Plus size={16}/>
            New order
          </Button>)}
      </PageHeader>

      <div className="summary-strip">
        <div>
          <ShoppingBag size={20}/>
          <span>
            <strong>{all.length}</strong>Total orders
          </span>
        </div>
        <div>
          <Workflow size={20}/>
          <span>
            <strong>{all.filter((o) => o.status === 'IN_PRODUCTION').length}</strong>In
            production
          </span>
        </div>
        <div>
          <Truck size={20}/>
          <span>
            <strong>
              {all.filter((o) => ['READY', 'PARTIAL'].includes(o.status)).length}
            </strong>
            Ready / partial
          </span>
        </div>
        <div>
          <CheckCircle2 size={20}/>
          <span>
            <strong>{all.filter((o) => o.status === 'COMPLETED').length}</strong>
            Completed
          </span>
        </div>
      </div>

      <Panel>
        <div className="table-toolbar">
          <div className="tabs">
            {['All orders', 'Needs review', 'In production', 'Ready to ship', 'Completed'].map((t) => (<button key={t} className={t === tab ? 'active' : ''} onClick={() => setTab(t)}>
                {t}
                {t === 'All orders' && <span>{all.length}</span>}
                {t === 'Needs review' && reviewCount > 0 && <span>{reviewCount}</span>}
              </button>))}
          </div>
          <SearchBox value={search} onChange={setSearch} placeholder="Search orders or buyers…"/>
        </div>

        <DataTable data={rows} columns={columns} onRow={(o) => navigate(`/orders/${o.id}`)}/>
      </Panel>

      {create && <NewOrderModal onClose={() => setCreate(false)}/>}
    </>);
}
