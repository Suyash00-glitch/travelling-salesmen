import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  ArrowRight, ShoppingBag, Activity, Factory, ShieldCheck, TriangleAlert, Package, CheckCircle2,
  Truck, Wallet, Clock, Users, Settings2, Pause, BarChart3, Wrench, AlertCircle, Layers,
} from 'lucide-react';
import { can, hasPermission, stageForRole, type Dashboard as Base } from '@loomos/shared';
import { useData } from '../../hooks/useFactory';
import { useAuth } from '../auth/Auth';
import { Badge, Kpi, Panel, PageHeader, Progress, Loading, ErrorState, TextLink, Empty } from '../../components/shared/common';
import { Button } from '../../components/ui/button';
import { number, date, label, money } from '../../lib/utils';

// The dashboard answers five questions for the signed-in role: what is happening now, what is
// pending, what needs attention, what is done, what is late. Cards differ by role; the
// "needs attention" list is the same everywhere.

interface Dashboard extends Base {
  pendingReview: number;
  readyJobs: number;
  assignedJobs: number;
  blockedJobs: number;
  lateJobs: number;
  jobs: { id: string; stage: string; status: string; target: string; output: string; machine: string | null; worker: string | null; mine: boolean; batch: { id: string; number: string; fabric: string; color: string; buyer: string }; due: string | null }[];
  machinesRunning: number;
  maintenance: number;
  rework: number;
  readyToDispatch: number;
  inTransit: number;
  delivered: number;
  lateShipments: number;
  lowStock: number;
  incoming: number;
  materials: { material: string; specification: string; onHand: string; reserved: string; available: string; consumed: string; low: boolean }[];
  shift: { current: { name: string; start: string; end: string } | null; checkedIn: { attendanceId: string; worker: { name: string; designation: string }; shift: { name: string } }[]; shifts: { name: string; state: string }[] } | null;
}

type Card = { label: string; value: string | number; unit?: string; meta: string; icon: ReactNode; accent?: boolean; href?: string };

const time = (v: string) => new Date(v).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });

function cardsFor(role: string, d: Dashboard): Card[] {
  const machines: Card = { label: 'Machines', value: d.machinesRunning, unit: `of ${d.totalMachines} running`, meta: `${d.idle} idle · ${d.breakdown} broken down`, icon: <Factory size={19} />, href: '/machines' };
  const running: Card = { label: 'Running now', value: d.running, unit: 'jobs', meta: `${number(d.todayOutput)} m produced today`, icon: <Activity size={19} />, accent: true, href: '/production' };
  const pending: Card = { label: 'Waiting to start', value: d.readyJobs + d.assignedJobs, unit: 'jobs', meta: `${d.readyJobs} need a machine & operator · ${d.assignedJobs} ready to start`, icon: <Settings2 size={19} />, href: '/production' };
  const blocked: Card = { label: 'Blocked or paused', value: d.blockedJobs, unit: 'jobs', meta: d.blockedJobs ? 'Reassign and start again' : 'Nothing is stuck', icon: <Pause size={19} />, href: '/production' };
  const late: Card = { label: 'Late', value: d.lateJobs + d.delayed, meta: `${d.lateJobs} jobs past due · ${d.delayed} orders past delivery date`, icon: <Clock size={19} />, href: '/batches?status=ONGOING' };
  const orders: Card = { label: 'Open orders', value: d.activeOrders, meta: `${d.pendingReview} waiting for review · ${d.dueSoon} due this week`, icon: <ShoppingBag size={19} />, href: '/orders' };
  const quality: Card = { label: 'Awaiting inspection', value: d.pendingQuality, unit: 'rolls', meta: `${d.rework} rework · ${d.rejected} rejected`, icon: <ShieldCheck size={19} />, href: '/quality' };
  const dispatch: Card = { label: 'Dispatch', value: d.pendingDispatch, unit: 'trucks loading', meta: `${d.readyToDispatch} rolls ready · ${d.inTransit} on the road · ${d.lateShipments} late`, icon: <Truck size={19} />, href: '/dispatch' };
  const stock: Card = { label: 'Yarn available', value: number(d.availableYarn), unit: 'kg', meta: `${d.lowStock} materials low · ${d.incoming} purchase orders due`, icon: <Package size={19} />, href: '/inventory' };
  const shiftCard: Card = { label: 'Current shift', value: d.shift?.current?.name ?? 'None', meta: d.shift?.current ? `${time(d.shift.current.start)} – ${time(d.shift.current.end)} · ${d.shift.checkedIn.length} checked in` : 'Between shifts', icon: <Users size={19} />, accent: true, href: '/workforce' };
  const f = d.finance;
  const moneyCards: Card[] = f ? [
    { label: 'Received', value: money(f.received), meta: `${money(f.billed)} invoiced`, icon: <Wallet size={19} />, accent: true, href: '/finance' },
    { label: 'Outstanding', value: money(f.outstanding), meta: `${f.pendingInvoices} unpaid invoices`, icon: <AlertCircle size={19} />, href: '/finance' },
    { label: 'Overdue', value: money(f.overdue), meta: `${f.overdueCount} invoices past due`, icon: <Clock size={19} />, href: '/finance' },
    { label: 'Expenses & claims', value: money(f.expenses), meta: `${f.pendingClaims} claims pending`, icon: <BarChart3 size={19} />, href: '/finance' },
  ] : [];

  switch (role) {
    case 'PRODUCTION_MANAGER': return [running, pending, blocked, late, machines, orders];
    case 'SHIFT_SUPERVISOR': return [shiftCard, running, blocked, machines];
    case 'SPINNING_OPERATOR': case 'WEAVING_OPERATOR': case 'DYEING_OPERATOR': case 'OPERATOR': return [running, pending, blocked, machines];
    case 'MAINTENANCE_ENGINEER': return [{ ...machines, accent: true }, { label: 'Breakdowns', value: d.breakdown, meta: 'Need repair', icon: <TriangleAlert size={19} />, href: '/machines' }, { label: 'Under maintenance', value: d.maintenance, meta: 'Confirm when repaired', icon: <Wrench size={19} />, href: '/machines' }, blocked];
    case 'INVENTORY_MANAGER': case 'PROCUREMENT_MANAGER': return [{ ...stock, accent: true }, { label: 'Low stock', value: d.lowStock, unit: 'materials', meta: 'Below reorder level', icon: <TriangleAlert size={19} />, href: '/inventory?filter=low' }, { label: 'Incoming', value: d.incoming, unit: 'purchase orders', meta: 'Ordered, not yet received', icon: <Truck size={19} />, href: '/procurement' }, orders];
    case 'QUALITY_INSPECTOR': return [{ ...quality, accent: true }, { label: 'Passed', value: d.passed, unit: 'rolls', meta: `${d.finishedRolls} ready for dispatch`, icon: <CheckCircle2 size={19} />, href: '/rolls' }, { label: 'Rework', value: d.rework, unit: 'rolls', meta: 'Send back or repair', icon: <TriangleAlert size={19} />, href: '/quality' }, { label: 'Rejected', value: d.rejected, unit: 'rolls', meta: 'Written off', icon: <AlertCircle size={19} />, href: '/quality' }];
    case 'DISPATCH_MANAGER': return [{ label: 'Ready to dispatch', value: d.readyToDispatch, unit: 'rolls', meta: 'Passed quality, not loaded', icon: <Layers size={19} />, accent: true, href: '/dispatch' }, { label: 'Loading', value: d.pendingDispatch, unit: 'trucks', meta: 'Verify labels and confirm', icon: <Truck size={19} />, href: '/dispatch' }, { label: 'On the road', value: d.inTransit, meta: `${d.lateShipments} late`, icon: <Clock size={19} />, href: '/dispatch' }, { label: 'Delivered', value: d.delivered, meta: 'Completed deliveries', icon: <CheckCircle2 size={19} />, href: '/dispatch' }];
    case 'ACCOUNTS_MANAGER': return moneyCards;
    default: return [running, orders, machines, quality, dispatch, stock, ...moneyCards.slice(0, 2)];
  }
}

export function DashboardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const query = useData<Dashboard>('/dashboard');

  if (query.isPending) return <Loading />;
  if (query.error) return <ErrorState error={query.error} retry={() => void query.refetch()} />;

  const d = query.data!;
  const role = user.role;
  const ownStage = stageForRole(role);
  const cards = cardsFor(role, d);
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
  const showJobs = can(user, 'production') && d.jobs.length > 0;
  const showOrders = can(user, 'orders') && !ownStage && role !== 'SHIFT_SUPERVISOR';
  const showChart = ['SUPER_ADMIN', 'ADMIN', 'OPERATIONS_MANAGER', 'PRODUCTION_MANAGER'].includes(role);

  return (
    <>
      <PageHeader eyebrow={`${label(role).toUpperCase()} · ${date(d.date)}`} title={`Good ${greeting}, ${user.name.split(' ')[0]}`} description={roleLine(role, d)}>
        {(can(user, 'reports') || hasPermission(user, 'production', 'manage')) && (
          <Button variant="outline" onClick={() => navigate('/reports')}><BarChart3 size={16} /> Reports</Button>
        )}
      </PageHeader>

      <div className="kpi-grid">
        {cards.map((c) => (
          <div key={c.label} onClick={() => c.href && navigate(c.href)} style={{ cursor: c.href ? 'pointer' : undefined }}>
            <Kpi label={c.label} value={c.value} unit={c.unit} icon={c.icon} meta={c.meta} accent={c.accent} />
          </div>
        ))}
      </div>

      <div className="dashboard-grid">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {showJobs && (
            <Panel title={ownStage ? 'Your jobs' : 'Jobs needing action'} subtitle="Waiting, running, or stuck" action={<TextLink onClick={() => navigate('/production')}>Production floor <ArrowRight size={14} /></TextLink>}>
              <div className="record-list">
                {d.jobs.map((j) => (
                  <div className="record" key={j.id}>
                    <div>
                      <strong>{j.batch.number}</strong> · {label(j.stage)} · {j.batch.fabric}, {j.batch.color}
                      <p>{j.batch.buyer} · {j.machine ?? 'no machine'} · {j.worker ?? 'no operator'}{j.mine ? ' (you)' : ''}{j.due ? ` · due ${date(j.due)}` : ''}</p>
                    </div>
                    <div className="cell-stack" style={{ alignItems: 'flex-end' }}>
                      <Badge value={j.status} />
                      <span className="record-meta">{number(j.output)} / {number(j.target)} m</span>
                    </div>
                  </div>
                ))}
              </div>
            </Panel>
          )}

          {role === 'SHIFT_SUPERVISOR' && d.shift && (
            <Panel title="On shift now" subtitle={d.shift.current ? `${d.shift.current.name} · ${d.shift.checkedIn.length} checked in` : 'No shift running'} action={<TextLink onClick={() => navigate('/workforce')}>Check in / out <ArrowRight size={14} /></TextLink>}>
              {d.shift.checkedIn.length ? (
                <div className="batch-flags">
                  {d.shift.checkedIn.map((c) => <span key={c.attendanceId} className="flag" style={{ fontSize: 13, padding: '6px 12px' }}>{c.worker.name} · {c.worker.designation}</span>)}
                </div>
              ) : <Empty title="Nobody is checked in" description="Check workers in when the shift starts." />}
            </Panel>
          )}

          {['INVENTORY_MANAGER', 'PROCUREMENT_MANAGER'].includes(role) && (
            <Panel title="Stock by material" action={<TextLink onClick={() => navigate('/inventory')}>Inventory <ArrowRight size={14} /></TextLink>}>
              <div className="record-list">
                {d.materials.map((m) => (
                  <div className="record" key={m.material + m.specification}>
                    <div><strong>{m.material}</strong> · {m.specification}<p>{number(m.consumed)} kg used · {number(m.reserved)} kg reserved</p></div>
                    <div className="cell-stack" style={{ alignItems: 'flex-end' }}><strong>{number(m.available)} kg free</strong>{m.low && <Badge value="REJECTED">Low</Badge>}</div>
                  </div>
                ))}
              </div>
            </Panel>
          )}

          {showChart && (
            <Panel title="Production this week" subtitle="Metres recorded per day">
              <div style={{ height: 220 }}>
                <ResponsiveContainer>
                  <AreaChart data={d.series} margin={{ left: 0, right: 16, top: 10, bottom: 0 }}>
                    <defs>
                      <linearGradient id="outputFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#c8f135" stopOpacity={0.55} />
                        <stop offset="95%" stopColor="#c8f135" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid vertical={false} stroke="#eceef1" />
                    <XAxis dataKey="label" tick={{ fill: '#3b4049', fontSize: 12 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: '#3b4049', fontSize: 12 }} axisLine={false} tickLine={false} width={44} />
                    <Tooltip formatter={(v) => [`${number(Number(v))} m`, 'Output']} contentStyle={{ borderRadius: 10, border: '1px solid #d9e3dd', fontSize: 12 }} />
                    <Area type="monotone" dataKey="output" stroke="#111316" strokeWidth={2} fill="url(#outputFill)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Panel>
          )}

          {showOrders && (
            <Panel title="Orders" subtitle="Latest customer orders" action={<TextLink onClick={() => navigate('/orders')}>All orders <ArrowRight size={14} /></TextLink>}>
              <div className="record-list">
                {d.orders.map((o) => (
                  <div className="record" key={o.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/orders/${o.id}`)}>
                    <div><strong>{o.number}</strong> · {o.buyer.name}<p>{o.items[0]?.fabric} · {number(o.quantity)} m · due {date(o.deadline)}</p></div>
                    <div className="cell-stack" style={{ alignItems: 'flex-end', minWidth: 140 }}>
                      <Badge value={o.status} />
                      <Progress value={o.progress} label={`${o.progress}%`} />
                    </div>
                  </div>
                ))}
              </div>
            </Panel>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Panel title="Needs attention" subtitle={d.alerts.length ? `${d.alerts.length} item${d.alerts.length > 1 ? 's' : ''}` : 'All clear'}>
            {d.alerts.length ? (
              <div className="record-list">
                {d.alerts.map((a) => (
                  <div className="record" key={a.id} style={{ cursor: 'pointer', borderLeft: `4px solid ${a.severity === 'danger' ? '#d93a44' : '#e08a00'}` }} onClick={() => navigate(a.href)}>
                    <div><strong>{a.title}</strong><p>{a.description}</p></div>
                    <ArrowRight size={15} />
                  </div>
                ))}
              </div>
            ) : <Empty title="Nothing needs attention" description="Breakdowns, blocked jobs, low stock and late deliveries appear here." />}
          </Panel>

          <Panel title="Recent activity">
            <div className="history-list">
              {d.activity.map((a) => (
                <div key={a.id}><p>{a.detail}</p><small>{a.actorName} · {new Date(a.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })}</small></div>
              ))}
            </div>
          </Panel>
        </div>
      </div>
    </>
  );
}

function roleLine(role: string, d: Dashboard) {
  switch (role) {
    case 'PRODUCTION_MANAGER': return `${d.running} jobs running, ${d.readyJobs + d.assignedJobs} waiting to start, ${d.blockedJobs} stuck.`;
    case 'SHIFT_SUPERVISOR': return d.shift?.current ? `${d.shift.current.name} is on. ${d.shift.checkedIn.length} workers checked in, ${d.breakdown} machines down.` : 'No shift is running right now.';
    case 'QUALITY_INSPECTOR': return `${d.pendingQuality} rolls are waiting for inspection.`;
    case 'DISPATCH_MANAGER': return `${d.pendingDispatch} trucks loading, ${d.inTransit} on the road.`;
    case 'ACCOUNTS_MANAGER': return d.finance ? `${money(d.finance.outstanding)} outstanding, ${d.finance.overdueCount} invoices overdue.` : '';
    case 'INVENTORY_MANAGER': case 'PROCUREMENT_MANAGER': return `${number(d.availableYarn)} kg of yarn free, ${d.lowStock} materials running low.`;
    case 'MAINTENANCE_ENGINEER': return `${d.breakdown} breakdowns, ${d.maintenance} machines under maintenance.`;
    default: return d.running || d.activeOrders ? `${d.running} jobs running across ${d.activeOrders} open orders.` : 'Here is what is happening across the mill.';
  }
}
