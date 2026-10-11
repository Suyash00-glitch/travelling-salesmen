import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Truck, ArrowUpRight, ShieldCheck, CalendarDays, Plus, Factory, Package, Ruler } from 'lucide-react';
import type { OrderSummary, PageResponse } from '@loomos/shared';
import { useAuth } from '../auth/Auth';
import { useData, useLookups } from '../../hooks/useFactory';
import { PageHeader, Panel, Loading, ErrorState, Badge, Progress, Empty, Kpi } from '../../components/shared/common';
import { Button } from '../../components/ui/button';
import { DispatchPage } from '../dispatch/DispatchPage';
import { NewOrderModal } from '../orders/NewOrderModal';
import { number, date, label, money } from '../../lib/utils';
import { BuyerChatbot } from './components/BuyerChatbot';
import './buyer-portal.css';

const CLOSED = ['COMPLETED', 'CANCELLED'];
const JOURNEY = ['Confirmed', 'Production', 'Quality', 'Dispatch'];
const PAGE = 8;

// Which of the four journey steps an order is on (0 = waiting for the factory to confirm).
function journeyStep(status: string) {
  if (status === 'PENDING_REVIEW') return 0;
  if (status === 'READY' || status === 'PARTIAL') return 3;
  if (status === 'QUALITY') return 2;
  return 1;
}

// Whole days from today to the delivery date; negative means overdue.
function daysUntil(deadline: string) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const due = new Date(deadline);
  due.setHours(0, 0, 0, 0);
  return Math.round((due.getTime() - start.getTime()) / 86_400_000);
}

function DueNote({ deadline }: { deadline: string }) {
  const days = daysUntil(deadline);
  if (days < 0) return <small className="bp-late-text">{-days} day{days === -1 ? '' : 's'} late</small>;
  if (days <= 3) return <small className="bp-soon-text">{days === 0 ? 'Due today' : `In ${days} day${days === 1 ? '' : 's'}`}</small>;
  return null;
}

// What a buyer sees: the materials they can order, their orders, and their deliveries.
export function BuyerPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState<'active' | 'completed' | 'shipments'>('active');
  const [shown, setShown] = useState(PAGE);
  const [createOrder, setCreateOrder] = useState(false);
  const query = useData<PageResponse<OrderSummary>>('/orders?pageSize=100');
  const lookups = useLookups();
  const navigate = useNavigate();

  if (query.isPending) return <Loading />;
  if (query.error) return <ErrorState error={query.error} retry={() => void query.refetch()} />;

  const orders = query.data?.data ?? [];
  const open = orders
    .filter((o) => !CLOSED.includes(o.status))
    .sort((a, b) => new Date(a.deadline).getTime() - new Date(b.deadline).getTime());
  const done = orders
    .filter((o) => CLOSED.includes(o.status))
    .sort((a, b) => new Date(b.deadline).getTime() - new Date(a.deadline).getTime());
  const late = open.filter((o) => daysUntil(o.deadline) < 0).length;

  return (
    <>
      <PageHeader eyebrow="BUYER PORTAL" title={`Hello, ${user.name}`} description="Place orders and follow them from production to delivery.">
        <Button onClick={() => setCreateOrder(true)}>
          <Plus size={16} />
          Place an order
        </Button>
      </PageHeader>

      <div className="bp-kpis">
      <div className="kpi-grid">
        <Kpi label="Open orders" value={open.length} icon={<Package size={19} />} meta={late ? `${late} running late` : `${orders.filter((o) => o.status === 'PENDING_REVIEW').length} waiting for the factory to confirm`} accent />
        <Kpi label="In production" value={open.filter((o) => ['PLANNED', 'IN_PRODUCTION', 'QUALITY'].includes(o.status)).length} icon={<Factory size={19} />} meta="Being made right now" />
        <Kpi label="Ready or on the way" value={open.filter((o) => ['READY', 'PARTIAL'].includes(o.status)).length} icon={<Truck size={19} />} meta="Packed, loading or in transit" />
        <Kpi label="Delivered" value={orders.filter((o) => o.status === 'COMPLETED').length} icon={<ShieldCheck size={19} />} meta="Completed orders" />
      </div>
      </div>

      <Panel title="Materials and prices" subtitle="Fixed prices per metre. Choose one when you place an order.">
        <div className="batch-flags">
          {(lookups.data?.recipes ?? []).map((r) => (
            <span key={r.id} className="flag" style={{ fontSize: 13, padding: '6px 12px' }}>
              <strong>{r.name}</strong> · {r.specification} · {money(r.pricePerMetre)}/m
            </span>
          ))}
        </div>
      </Panel>

      <div className="bp-tabs" role="tablist" aria-label="Your orders">
        <button role="tab" aria-selected={tab === 'active'} className={tab === 'active' ? 'active' : ''} onClick={() => setTab('active')}>
          Active orders <b>{open.length}</b>
        </button>
        <button role="tab" aria-selected={tab === 'completed'} className={tab === 'completed' ? 'active' : ''} onClick={() => setTab('completed')}>
          Past orders <b>{done.length}</b>
        </button>
        <button role="tab" aria-selected={tab === 'shipments'} className={tab === 'shipments' ? 'active' : ''} onClick={() => setTab('shipments')}>
          Deliveries
        </button>
      </div>

      {tab === 'shipments' ? (
        <DispatchPage buyer />
      ) : tab === 'active' ? (
        open.length ? (
          <>
            <p className="bp-section-note">Sorted by delivery date, soonest first.</p>
            <div className="bp-grid">
              {open.map((o) => {
                const step = journeyStep(o.status);
                const isLate = daysUntil(o.deadline) < 0;
                return (
                  <article key={o.id} className={`bp-card${isLate ? ' late' : ''}`}>
                    <div className="bp-card-top">
                      <span className="bp-number">{o.number}</span>
                      <Badge value={o.status} />
                    </div>
                    <div>
                      <h2 className="bp-title">{o.items[0]?.fabric}</h2>
                      <p className="bp-sub">
                        {o.items[0]?.color} · {number(o.quantity)} m · {money(o.value)}
                      </p>
                    </div>
                    <ol className="bp-steps" aria-label={`Progress: ${JOURNEY[step]}`}>
                      {JOURNEY.map((name, i) => (
                        <li key={name} className={i < step ? 'done' : i === step ? 'now' : ''}>{name}</li>
                      ))}
                    </ol>
                    <Progress value={o.progress} label={`${o.progress}% made · ${label(o.stage)}`} />
                    <dl className="bp-facts">
                      <div>
                        <dt><CalendarDays size={13} /> Delivery date</dt>
                        <dd>{date(o.deadline)}<DueNote deadline={o.deadline} /></dd>
                      </div>
                      <div>
                        <dt><Ruler size={13} /> Total ordered</dt>
                        <dd>{number(o.quantity)} m</dd>
                      </div>
                      <div>
                        <dt><ShieldCheck size={13} /> Quality approved</dt>
                        <dd>{number(o.approved)} m</dd>
                      </div>
                      <div>
                        <dt><Truck size={13} /> Dispatched</dt>
                        <dd>{number(o.dispatched)} m</dd>
                      </div>
                    </dl>
                    <Button variant="outline" onClick={() => navigate(`/orders/${o.id}`)}>
                      Follow this order
                      <ArrowUpRight size={15} />
                    </Button>
                  </article>
                );
              })}
            </div>
          </>
        ) : (
          <Empty
            title="No active orders"
            description={done.length ? 'Everything you ordered has been delivered. Place a new order any time.' : 'Place your first order with the button above.'}
          />
        )
      ) : done.length ? (
        <>
          <div className="bp-list">
            <div className="bp-row bp-head bp-hide-sm" aria-hidden>
              <span>Order</span>
              <span>Fabric</span>
              <span>Quantity</span>
              <span>Value</span>
              <span>Delivery date</span>
              <span />
            </div>
            {done.slice(0, shown).map((o) => (
              <div key={o.id} className="bp-row">
                <strong>{o.number}</strong>
                <div className="bp-fabric">
                  {o.items[0]?.fabric}
                  <span>{o.items[0]?.color}{o.status === 'CANCELLED' ? ' · Cancelled' : ''}</span>
                </div>
                <span className="bp-hide-sm">{number(o.quantity)} m</span>
                <span className="bp-hide-sm">{money(o.value)}</span>
                <span className="bp-hide-sm bp-muted">{date(o.deadline)}</span>
                <span className="bp-action">
                  <Button variant="outline" onClick={() => navigate(`/orders/${o.id}`)}>View</Button>
                </span>
              </div>
            ))}
          </div>
          {done.length > shown && (
            <div className="bp-more">
              <Button variant="outline" onClick={() => setShown((n) => n + PAGE)}>
                Show more ({done.length - shown} left)
              </Button>
            </div>
          )}
        </>
      ) : (
        <Empty title="No past orders" description="Delivered orders will be listed here." />
      )}

      {createOrder && (
        <NewOrderModal
          onClose={() => {
            setCreateOrder(false);
            void query.refetch();
          }}
          buyerId={user.buyerId ?? undefined}
        />
      )}

      <div className="bp-page-end" />
      <BuyerChatbot />
    </>
  );
}
