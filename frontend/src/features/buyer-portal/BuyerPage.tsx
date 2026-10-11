import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Truck, ArrowUpRight, ShieldCheck, CalendarDays, Plus, Factory, Package } from 'lucide-react';
import type { OrderSummary, PageResponse } from '@loomos/shared';
import { useAuth } from '../auth/Auth';
import { useData, useLookups } from '../../hooks/useFactory';
import { PageHeader, Panel, Loading, ErrorState, Badge, Progress, Empty, Kpi } from '../../components/shared/common';
import { Button } from '../../components/ui/button';
import { DispatchPage } from '../dispatch/DispatchPage';
import { NewOrderModal } from '../orders/NewOrderModal';
import { number, date, label, money } from '../../lib/utils';
import { BuyerChatbot } from './components/BuyerChatbot';

// What a buyer sees: the materials they can order, their orders, and their deliveries.
export function BuyerPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState<'orders' | 'shipments'>('orders');
  const [createOrder, setCreateOrder] = useState(false);
  const query = useData<PageResponse<OrderSummary>>('/orders?pageSize=100');
  const lookups = useLookups();
  const navigate = useNavigate();

  if (query.isPending) return <Loading />;
  if (query.error) return <ErrorState error={query.error} retry={() => void query.refetch()} />;

  const orders = query.data?.data ?? [];
  const open = orders.filter((o) => !['COMPLETED', 'CANCELLED'].includes(o.status));

  return (
    <>
      <PageHeader eyebrow="BUYER PORTAL" title={`Hello, ${user.name}`} description="Place orders and follow them from production to delivery.">
        <Button onClick={() => setCreateOrder(true)}>
          <Plus size={16} />
          Place an order
        </Button>
      </PageHeader>

      <div className="kpi-grid">
        <Kpi label="Open orders" value={open.length} icon={<Package size={19} />} meta={`${orders.filter((o) => o.status === 'PENDING_REVIEW').length} waiting for the factory to confirm`} accent />
        <Kpi label="In production" value={open.filter((o) => ['PLANNED', 'IN_PRODUCTION', 'QUALITY'].includes(o.status)).length} icon={<Factory size={19} />} meta="Being made right now" />
        <Kpi label="Ready or on the way" value={open.filter((o) => ['READY', 'PARTIAL'].includes(o.status)).length} icon={<Truck size={19} />} meta="Packed, loading or in transit" />
        <Kpi label="Delivered" value={orders.filter((o) => o.status === 'COMPLETED').length} icon={<ShieldCheck size={19} />} meta="Completed orders" />
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

      <div className="tabs buyer-tabs" style={{ margin: '16px 0' }}>
        <button className={tab === 'orders' ? 'active' : ''} onClick={() => setTab('orders')}>My orders ({orders.length})</button>
        <button className={tab === 'shipments' ? 'active' : ''} onClick={() => setTab('shipments')}>My deliveries</button>
      </div>

      {tab === 'shipments' ? (
        <DispatchPage buyer />
      ) : orders.length ? (
        <div className="buyer-order-grid">
          {orders.map((o) => (
            <Panel key={o.id} className="buyer-order">
              <div className="buyer-order-heading">
                <strong>{o.number}</strong>
                <Badge value={o.status} />
              </div>
              <h2>{o.items[0]?.fabric}</h2>
              <p>
                {o.items[0]?.color} · {number(o.quantity)} metres · {money(o.value)}
              </p>
              <Progress value={o.progress} label={`${o.progress}% produced`} />
              <dl>
                <div>
                  <dt><Factory size={14} /> Current step</dt>
                  <dd>{label(o.stage)}</dd>
                </div>
                <div>
                  <dt><CalendarDays size={14} /> Delivery date</dt>
                  <dd>{date(o.deadline)}</dd>
                </div>
                <div>
                  <dt><ShieldCheck size={14} /> Quality approved</dt>
                  <dd>{number(o.approved)} m</dd>
                </div>
                <div>
                  <dt><Truck size={14} /> Dispatched</dt>
                  <dd>{number(o.dispatched)} m</dd>
                </div>
              </dl>
              <Button variant="outline" onClick={() => navigate(`/orders/${o.id}`)}>
                Follow this order
                <ArrowUpRight size={15} />
              </Button>
            </Panel>
          ))}
        </div>
      ) : (
        <Empty title="No orders yet" description="Place your first order with the button above." />
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

      <BuyerChatbot />
    </>
  );
}
