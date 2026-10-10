import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Truck, ArrowUpRight, ShieldCheck, CalendarDays, Plus, Factory } from 'lucide-react';
import type { OrderSummary, PageResponse } from '@loomos/shared';
import { StatusDonut, groupCounts } from '../../components/shared/FactoryInsights';
import { useAuth } from '../auth/Auth';
import { useData } from '../../hooks/useFactory';
import {
  PageHeader,
  Panel,
  Loading,
  ErrorState,
  Badge,
  Progress,
  Empty,
} from '../../components/shared/common';
import { Button } from '../../components/ui/button';
import { DispatchPage } from '../dispatch/DispatchPage';
import { NewOrderModal } from '../orders/NewOrderModal';
import { number, date, label } from '../../lib/utils';

export function BuyerPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState('Your orders');
  const [createOrder, setCreateOrder] = useState(false);
  const query = useData<PageResponse<OrderSummary>>('/orders?pageSize=100');
  const navigate = useNavigate();

  if (query.isPending) {
    return <Loading />;
  }

  if (query.error) {
    return <ErrorState error={query.error} retry={() => void query.refetch()} />;
  }

  const orders = query.data?.data ?? [];

  return (
    <>
      <div className="tabs buyer-tabs">
        {['Your orders', 'Your shipments'].map((t) => (
          <button
            key={t}
            className={tab === t ? 'active' : ''}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'Your shipments' ? (
        <DispatchPage buyer />
      ) : (
        <>
          <PageHeader
            eyebrow="YOUR BUYER WORKSPACE"
            title={`Hello, ${user.name}.`}
            description="A window into your orders. From production to your doorstep."
          >
            <Button onClick={() => setCreateOrder(true)}>
              <Plus size={16} />
              Place New Order
            </Button>
          </PageHeader>

          <div className="buyer-insights">
            <StatusDonut
              title="Your order status"
              description="Current status of your orders"
              unit="orders"
              items={groupCounts(orders.map((o) => o.status))}
            />
          </div>

          <div className="buyer-order-grid">
            {orders.map((o) => (
              <Panel key={o.id} className="buyer-order">
                <div className="buyer-order-heading">
                  <strong>{o.number}</strong>
                  <Badge value={o.status} />
                </div>
                <h2>{o.items[0]?.fabric}</h2>
                <p>
                  {o.items[0]?.color} · {number(o.quantity)} metres
                </p>
                <Progress
                  value={o.progress}
                  label={`${o.progress}% produced`}
                />
                <dl>
                  <div>
                    <dt>
                      <Factory size={14} />
                      Current step
                    </dt>
                    <dd>{label(o.stage)}</dd>
                  </div>
                  <div>
                    <dt>
                      <CalendarDays size={14} />
                      Delivery deadline
                    </dt>
                    <dd>{date(o.deadline)}</dd>
                  </div>
                  <div>
                    <dt>
                      <ShieldCheck size={14} />
                      Quality approved
                    </dt>
                    <dd>{number(o.approved)} m</dd>
                  </div>
                  <div>
                    <dt>
                      <Truck size={14} />
                      Dispatched
                    </dt>
                    <dd>{number(o.dispatched)} m</dd>
                  </div>
                </dl>
                <Button
                  variant="outline"
                  onClick={() => navigate(`/orders/${o.id}`)}
                >
                  Follow this order
                  <ArrowUpRight size={15} />
                </Button>
              </Panel>
            ))}
          </div>

          {!orders.length && (
            <Empty
              title="Your next order starts here"
              description="Orders linked to your buyer account will appear here."
            />
          )}
        </>
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
    </>
  );
}
