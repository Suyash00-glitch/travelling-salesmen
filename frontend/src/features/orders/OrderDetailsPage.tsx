import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ShoppingBag,
  Clock,
  CheckCircle2,
  ArrowLeft,
  Package,
  Workflow,
  Truck,
  Check,
  ArrowRight,
} from 'lucide-react';
import { can, hasPermission, type OrderSummary } from '@loomos/shared';
import { useData, useAction } from '../../hooks/useFactory';
import { useAuth } from '../auth/Auth';
import { Button } from '../../components/ui/button';
import { ActionForm, type FormSpec } from '../../components/shared/ActionForm';
import {
  Badge,
  Panel,
  PageHeader,
  Loading,
  ErrorState,
} from '../../components/shared/common';
import { date, number, money, label } from '../../lib/utils';

interface MaterialLine {
  itemId: string;
  fabric: string;
  productionId?: string;
  material: string;
  specification: string;
  required: string;
  reserved: string;
  consumed: string;
  available: string;
  shortage: string;
  lots: { id: string; code: string; available: string }[];
}

export function OrderDetailsPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();

  const query = useData<
    OrderSummary & {
      timeline: { action: string; detail: string; createdAt: string }[];
    }
  >(`/orders/${id}`);

  const action = useAction();
  const [spec, setSpec] = useState<FormSpec | null>(null);

  if (query.isPending) return <Loading />;
  if (query.error) return <ErrorState error={query.error} retry={() => void query.refetch()} />;

  const o = query.data!;

  return (
    <>
      <button
        className="back-link"
        onClick={() => navigate(user.role === 'BUYER' ? '/buyer' : '/orders')}
      >
        <ArrowLeft size={15} />
        Back to orders
      </button>

      <PageHeader
        eyebrow={o.buyer.name}
        title={o.number}
        description={`${o.items.map((i) => i.fabric).join(' · ')} · Due ${date(o.deadline)}`}
      >
        <Badge value={o.status} />
        {/* Buyer requests wait here until a manager accepts or declines them */}
        {o.status === 'PENDING_REVIEW' && hasPermission(user, 'orders', 'approve') && (
          <>
            <Button
              variant="outline"
              onClick={() =>
                setSpec({
                  title: 'Decline this order',
                  description: 'The buyer will see this reason on their order.',
                  path: `/orders/${o.id}/reject`,
                  fields: [{ name: 'reason', label: 'Reason', type: 'textarea' }],
                  submit: 'Decline order',
                })
              }
            >
              Decline
            </Button>
            <Button
              disabled={action.isPending}
              onClick={() => action.mutate({ path: `/orders/${o.id}/accept` })}
            >
              <CheckCircle2 size={16} />
              Accept & send to spinning
            </Button>
          </>
        )}
        {hasPermission(user, 'orders', 'approve') && o.status !== 'PENDING_REVIEW' && (
          <>
            <Button
              variant="outline"
              onClick={() =>
                setSpec({
                  title: 'Update order commitment',
                  path: `/orders/${o.id}/edit`,
                  fields: [
                    {
                      name: 'deadline',
                      label: 'Deadline',
                      type: 'date',
                      value: o.deadline.slice(0, 10),
                    },
                    {
                      name: 'priority',
                      label: 'Priority',
                      type: 'select',
                      value: o.priority,
                      options: ['NORMAL', 'HIGH', 'URGENT'].map((v) => ({
                        value: v,
                        label: label(v),
                      })),
                    },
                    {
                      name: 'instructions',
                      label: 'Instructions',
                      type: 'textarea',
                      required: false,
                      value: o.instructions,
                    },
                  ],
                })
              }
            >
              Edit order
            </Button>
            {o.status === 'CONFIRMED' && (
              <Button
                disabled={action.isPending}
                onClick={() => action.mutate({ path: `/orders/${id}/plan` })}
              >
                <Workflow size={16} />
                Plan production
              </Button>
            )}
          </>
        )}
      </PageHeader>

      <div className="summary-strip">
        <div>
          <ShoppingBag size={20} />
          <span>
            <strong>{number(o.quantity)} m</strong>Ordered
          </span>
        </div>
        <div>
          <Workflow size={20} />
          <span>
            <strong>{number(o.produced)} m</strong>Produced
          </span>
        </div>
        <div>
          <CheckCircle2 size={20} />
          <span>
            <strong>{number(o.approved)} m</strong>Quality approved
          </span>
        </div>
        <div>
          <Truck size={20} />
          <span>
            <strong>{number(o.dispatched)} m</strong>Dispatched
          </span>
        </div>
      </div>

      {o.risk.reasons.length > 0 && (
        <div className="info-banner warning">
          <Clock size={18} />
          <div>
            <strong>Keep this order in focus</strong>
            <p>{o.risk.reasons.join(' · ')}</p>
          </div>
        </div>
      )}

      <Panel
        title="The production journey"
        subtitle="Every stage connected. Every metre accounted for."
      >
        <div className="order-route">
          {o.items.map((item) => (
            <div key={item.id}>
              <div className="route-item-heading">
                <h3>{item.fabric}</h3>
                <span>
                  {item.color} · {number(item.quantity)} m
                </span>
              </div>
              <div className="stage-flow">
                {item.production?.jobs.map((job, i) => (
                  <div className="stage-node" key={job.id}>
                    <span
                      className={`stage-circle ${
                        job.status === 'COMPLETED'
                          ? 'done'
                          : job.status === 'IN_PROGRESS'
                            ? 'current'
                            : ''
                      }`}
                    >
                      {job.status === 'COMPLETED' ? <Check size={19} /> : i + 1}
                    </span>
                    <strong>{label(job.stage)}</strong>
                    <Badge value={job.status} />
                    <small>
                      {number(job.output)} / {number(job.target)} m
                    </small>
                  </div>
                )) ?? <p className="muted">Plan this order to create its production jobs.</p>}
                <div className="stage-node">
                  <span className="stage-circle">
                    <CheckCircle2 size={19} />
                  </span>
                  <strong>Quality check</strong>
                  <small>Roll-level inspection</small>
                </div>
                <div className="stage-node">
                  <span className="stage-circle">
                    <Truck size={19} />
                  </span>
                  <strong>Dispatch</strong>
                  <small>Verified roll shipment</small>
                </div>
              </div>
            </div>
          ))}
        </div>
      </Panel>

      {can(user.role, 'inventory') && <MaterialPlan id={o.id} onForm={setSpec} />}

      <div className="two-column mt-5">
        <Panel title="Order details">
          <dl className="detail-list">
            <div>
              <dt>Buyer</dt>
              <dd>{o.buyer.name}</dd>
            </div>
            <div>
              <dt>Priority</dt>
              <dd>
                <Badge value={o.priority} />
              </dd>
            </div>
            <div>
              <dt>Order value</dt>
              <dd>{money(o.value)}</dd>
            </div>
            <div>
              <dt>Instructions</dt>
              <dd>{o.instructions || 'No special instructions'}</dd>
            </div>
          </dl>
        </Panel>

        <Panel title="Order timeline">
          <div className="timeline">
            {o.timeline.map((a, i) => (
              <div key={i}>
                <span className="timeline-dot" />
                <div>
                  <strong>{a.detail}</strong>
                  <small>{date(a.createdAt)}</small>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      {spec && <ActionForm spec={spec} onClose={() => setSpec(null)} />}
    </>
  );
}

function MaterialPlan({
  id,
  onForm,
}: {
  id: string;
  onForm: (s: FormSpec) => void;
}) {
  const query = useData<MaterialLine[]>(`/orders/${id}/materials`);

  return (
    <Panel
      title="Smart material plan"
      subtitle="Calculated from each fabric’s configured recipe"
      className="mt-5"
    >
      {query.data?.map((line) => (
        <div className="material-plan-row" key={line.itemId}>
          <span className="material-icon">
            <Package size={22} />
          </span>
          <div>
            <strong>{line.material}</strong>
            <small>
              {line.specification} · {line.fabric}
            </small>
          </div>
          <div>
            <small>Required</small>
            <strong>{number(line.required, 2)} kg</strong>
          </div>
          <div>
            <small>Reserved</small>
            <strong>{number(line.reserved, 2)} kg</strong>
          </div>
          <div>
            <small>Available</small>
            <strong>{number(line.available, 2)} kg</strong>
          </div>
          <div>
            <small>Shortage</small>
            <strong className={Number(line.shortage) > 0 ? 'red-text' : ''}>
              {number(line.shortage, 2)} kg
            </strong>
          </div>
          {line.productionId && (
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                onForm({
                  title: 'Reserve yarn for production',
                  description:
                    'Reserved yarn remains in stock until actual consumption is recorded.',
                  path: '/inventory/reservations',
                  fields: [
                    {
                      name: 'lotId',
                      label: 'Yarn lot',
                      type: 'select',
                      options: line.lots.map((l) => ({
                        value: l.id,
                        label: `${l.code} · ${l.available} kg available`,
                      })),
                    },
                    {
                      name: 'quantity',
                      label: 'Quantity (kg)',
                      type: 'number',
                      min: 0.001,
                      value: Math.max(
                        0,
                        Number(line.required) -
                          Number(line.reserved) -
                          Number(line.consumed),
                      ),
                    },
                  ],
                  transform: (body) => ({
                    ...body,
                    productionId: line.productionId,
                  }),
                })
              }
            >
              Reserve yarn
              <ArrowRight size={13} />
            </Button>
          )}
        </div>
      ))}
    </Panel>
  );
}
