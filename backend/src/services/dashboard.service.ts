import { db } from '@loomos/db';
import { can, hasPermission, stageForRole, type CurrentUser } from '@loomos/shared';
import { businessDay, D, sum } from '../lib/domain.js';
import { orderSummaries } from './order.service.js';
import { machineSummaries } from './machine.service.js';
import { financialReport } from './finance.service.js';
import { materialSummary } from './inventory.service.js';
import { shiftBoard } from './workforce.service.js';

// One call builds everything a dashboard can show. Each number is only computed for roles
// that may see that area, and the browser picks the cards for the signed-in role.

type Alert = { id: string; title: string; description: string; severity: 'warning' | 'danger' | 'success'; href: string };

export async function dashboard(user: CurrentUser, date?: string) {
  const day = date ? businessDay(new Date(`${date}T12:00:00+05:30`)) : businessDay();
  const now = new Date();
  const ownStage = stageForRole(user.role);

  const [orders, machines, rolls, entries, activity, jobs, shipments, materials, shift] = await Promise.all([
    can(user, 'orders') ? orderSummaries(user) : [],
    can(user, 'machines') ? machineSummaries(day) : [],
    can(user, 'quality') || can(user, 'rolls') ? db.fabricRoll.findMany({ include: { activeShipment: true, production: { select: { orderId: true } } } }) : [],
    db.productionEntry.findMany({ where: { createdAt: { gte: new Date(day.getTime() - 6 * 86400000), lt: new Date(day.getTime() + 86400000) } } }),
    db.auditLog.findMany({ take: 8, orderBy: { createdAt: 'desc' }, where: !can(user, 'finance') ? { action: { not: { startsWith: 'finance.' } } } : undefined }),
    can(user, 'production')
      ? db.jobCard.findMany({
          where: { status: { notIn: ['COMPLETED', 'CANCELLED'] }, production: { status: { not: 'CANCELLED' } }, ...(ownStage ? { stage: ownStage } : {}) },
          include: { machine: { select: { code: true } }, worker: { select: { id: true, name: true } }, production: { select: { id: true, number: true, fabric: true, color: true, dueDate: true, order: { select: { deadline: true, buyer: { select: { name: true } } } } } } },
          orderBy: [{ status: 'asc' }, { productionId: 'asc' }],
        })
      : [],
    can(user, 'dispatch') ? db.shipment.findMany({ include: { order: { include: { buyer: true } } } }) : [],
    can(user, 'inventory') ? materialSummary() : [],
    can(user, 'workforce') || hasPermission(user, 'attendance', 'manage') ? shiftBoard(now) : null,
  ]);

  const active = orders.filter((o) => !['COMPLETED', 'CANCELLED'].includes(o.status));
  const alerts: Alert[] = [];

  if (can(user, 'machines')) {
    machines.filter((m) => m.status === 'BREAKDOWN').forEach((m) => alerts.push({ id: m.id, title: `${m.code} needs attention`, description: m.downtime[0]?.reason ?? 'Breakdown reported by the floor team', severity: 'danger', href: '/machines' }));
  }
  if (can(user, 'production')) {
    const blocked = jobs.filter((j) => j.status === 'BLOCKED');
    blocked.slice(0, 3).forEach((j) => alerts.push({ id: j.id, title: `${j.production.number} is blocked at ${j.stage.toLowerCase()}`, description: 'Reassign the machine or operator, then start it again', severity: 'danger', href: '/production' }));
    const waiting = jobs.filter((j) => j.status === 'READY');
    if (waiting.length) alerts.push({ id: 'ready', title: `${waiting.length} job${waiting.length > 1 ? 's' : ''} need a machine and operator`, description: waiting.slice(0, 3).map((j) => `${j.production.number} · ${j.stage.toLowerCase()}`).join(' · '), severity: 'warning', href: '/production' });
  }
  if (can(user, 'inventory')) {
    materials.filter((m) => m.low).forEach((m) => alerts.push({ id: m.material + m.specification, title: `${m.material} running low`, description: `${m.available.toFixed(0)} kg available · ${m.specification}`, severity: 'warning', href: '/inventory' }));
  }
  if ((can(user, 'inventory') || can(user, 'procurement')) && user.role !== 'BUYER') {
    const short = active.filter((o) => o.yarn?.status === 'SHORT');
    if (short.length) {
      alerts.push({
        id: 'yarn-short',
        title: `${short.length} order${short.length > 1 ? 's' : ''} cannot start: not enough yarn`,
        description: short.slice(0, 3).map((o) => `${o.number}: ${o.yarn!.shortKg} kg ${o.yarn!.material}`).join(' · '),
        severity: 'warning',
        href: can(user, 'procurement') ? '/procurement' : '/inventory',
      });
    }
  }
  if (can(user, 'orders') && user.role !== 'BUYER') {
    active.filter((o) => o.risk.reasons.length).slice(0, 3).forEach((o) => alerts.push({ id: o.id, title: `${o.number} · Delivery risk`, description: o.risk.reasons[0], severity: 'warning', href: `/orders/${o.id}` }));
  }
  if (can(user, 'quality')) {
    const rework = rolls.filter((r) => r.quality === 'REWORK').length;
    if (rework) alerts.push({ id: 'rework', title: `${rework} roll${rework > 1 ? 's' : ''} need rework`, description: 'Send back to a stage or repair at the bay', severity: 'warning', href: '/quality' });
  }
  if (can(user, 'dispatch')) {
    const late = shipments.filter((s) => s.status === 'DISPATCHED' && s.expectedAt && s.expectedAt < now);
    late.slice(0, 3).forEach((s) => alerts.push({ id: s.id, title: `${s.number} is late`, description: `${s.order.buyer.name} expected it on ${s.expectedAt!.toLocaleDateString('en-IN')}`, severity: 'danger', href: '/dispatch' }));
  }

  const series = Array.from({ length: 7 }, (_, i) => {
    const start = new Date(day.getTime() - (6 - i) * 86400000);
    const end = new Date(start.getTime() + 86400000);
    return {
      date: start.toISOString(),
      label: new Intl.DateTimeFormat('en', { timeZone: 'Asia/Kolkata', weekday: 'short' }).format(start),
      output: sum(entries.filter((e) => e.createdAt >= start && e.createdAt < end).map((e) => e.quantity)).toNumber(),
      target: sum(machines.filter((m) => m.active && m.status !== 'OFFLINE').map((m) => D(m.capacityPerHour).mul(8))).toNumber(),
    };
  });

  const finishedRolls = rolls.filter((r) => r.quality === 'PASSED' && !r.activeShipmentId);
  const dueDate = (j: (typeof jobs)[number]) => j.production.dueDate ?? j.production.order?.deadline ?? null;

  return {
    date: day,
    series,
    alerts,
    activity,
    // Orders
    activeOrders: active.length,
    dueSoon: active.filter((o) => new Date(o.deadline).getTime() - day.getTime() < 7 * 86400000).length,
    delayed: active.filter((o) => new Date(o.deadline) < day).length,
    pendingReview: orders.filter((o) => o.status === 'PENDING_REVIEW').length,
    orders: orders.slice(0, 6),
    // Where every order is, from request to delivery (for the "orders by stage" chart).
    orderStages: [
      ['Waiting review', ['PENDING_REVIEW']],
      ['Planned', ['CONFIRMED', 'PLANNED']],
      ['In production', ['IN_PRODUCTION']],
      ['Quality check', ['QUALITY']],
      ['Ready to ship', ['READY']],
      ['On the way', ['PARTIAL', 'DISPATCHED']],
      ['Delivered', ['COMPLETED']],
    ].map(([stage, statuses]) => ({ stage: stage as string, count: orders.filter((o) => (statuses as string[]).includes(o.status)).length })),
    yarnShort: active.filter((o) => o.yarn?.status === 'SHORT').length,
    // Production
    todayOutput: String(series[6].output),
    previousOutput: String(series[5].output),
    running: jobs.filter((j) => j.status === 'IN_PROGRESS').length,
    readyJobs: jobs.filter((j) => j.status === 'READY').length,
    assignedJobs: jobs.filter((j) => j.status === 'ASSIGNED').length,
    blockedJobs: jobs.filter((j) => ['BLOCKED', 'PAUSED'].includes(j.status)).length,
    lateJobs: jobs.filter((j) => dueDate(j) && dueDate(j)! < now).length,
    jobs: jobs.slice(0, 8).map((j) => ({
      id: j.id, stage: j.stage, status: j.status, target: j.target.toString(), output: j.output.toString(),
      machine: j.machine?.code ?? null, worker: j.worker?.name ?? null, mine: j.worker?.id === user.workerId,
      batch: { id: j.production.id, number: j.production.number, fabric: j.production.fabric, color: j.production.color, buyer: j.production.order?.buyer.name ?? 'Stock' },
      due: dueDate(j)?.toISOString() ?? null,
    })),
    // Machines
    machinesRunning: machines.filter((m) => m.status === 'RUNNING').length,
    idle: machines.filter((m) => m.active && m.status === 'IDLE').length,
    breakdown: machines.filter((m) => m.status === 'BREAKDOWN').length,
    maintenance: machines.filter((m) => m.status === 'MAINTENANCE').length,
    totalMachines: machines.filter((m) => m.active).length,
    machines,
    // Quality
    pendingQuality: rolls.filter((r) => r.quality === 'PENDING').length,
    passed: rolls.filter((r) => r.quality === 'PASSED').length,
    rework: rolls.filter((r) => r.quality === 'REWORK').length,
    rejected: rolls.filter((r) => r.quality === 'REJECTED').length,
    finishedRolls: finishedRolls.length,
    // Dispatch
    readyToDispatch: finishedRolls.filter((r) => r.production.orderId).length,
    pendingDispatch: shipments.filter((s) => s.status === 'DRAFT').length,
    inTransit: shipments.filter((s) => s.status === 'DISPATCHED').length,
    delivered: shipments.filter((s) => s.status === 'DELIVERED').length,
    lateShipments: shipments.filter((s) => s.status === 'DISPATCHED' && s.expectedAt && s.expectedAt < now).length,
    // Inventory
    availableYarn: sum(materials.map((m) => m.available)).toString(),
    lowStock: materials.filter((m) => m.low).length,
    materials,
    incoming: can(user, 'inventory') ? await db.purchaseOrder.count({ where: { status: { in: ['ORDERED', 'PARTIAL'] } } }) : 0,
    // People
    shift,
    // Money
    finance: can(user, 'finance') ? await financialReport() : undefined,
  };
}
