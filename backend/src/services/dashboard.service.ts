import { db, Prisma } from '@loomos/db';
import { can, hasPermission, stageForRole, type CurrentUser } from '@loomos/shared';
import { businessDay, D, sum } from '../lib/domain.js';
import { orderSummaries } from './order.service.js';
import { machineSummaries } from './machine.service.js';
import { financialReport } from './finance.service.js';

export async function dashboard(user: CurrentUser, date?: string) {
  const day = date ? businessDay(new Date(`${date}T12:00:00+05:30`)) : businessDay();
  const [orders, machines, lots, rolls, entries, activity] = await Promise.all([
    orderSummaries(user),
    machineSummaries(day),
    db.yarnLot.findMany(),
    db.fabricRoll.findMany({ include: { activeShipment: true } }),
    db.productionEntry.findMany({ where: { createdAt: { gte: new Date(day.getTime() - 6 * 86400000), lt: new Date(day.getTime() + 86400000) } }, include: { job: true } }),
    db.auditLog.findMany({ take: 8, orderBy: { createdAt: 'desc' }, where: !can(user.role, 'finance') ? { action: { not: { startsWith: 'finance.' } } } : undefined }),
  ]);

  const active = orders.filter((o) => !['COMPLETED', 'CANCELLED'].includes(o.status));
  const alerts: { id: string; title: string; description: string; severity: 'warning' | 'danger' | 'success'; href: string }[] = [];

  if (can(user.role, 'machines')) {
    machines.filter((m) => m.status === 'BREAKDOWN').forEach((m) => alerts.push({ id: m.id, title: `${m.code} needs attention`, description: m.downtime[0]?.reason ?? 'Breakdown reported by the floor team', severity: 'danger', href: '/machines' }));
  }
  if (can(user.role, 'inventory')) {
    lots.filter((l) => l.onHand.minus(l.reserved).lt(l.threshold)).forEach((l) => alerts.push({ id: l.id, title: `${l.material} running low`, description: `${l.onHand.minus(l.reserved)} kg available · ${l.specification}`, severity: 'warning', href: '/inventory' }));
  }
  if (can(user.role, 'orders')) {
    active.filter((o) => o.risk.reasons.length).slice(0, 3).forEach((o) => alerts.push({ id: o.id, title: `${o.number} · Delivery risk`, description: o.risk.reasons[0], severity: 'warning', href: `/orders/${o.id}` }));
  }
  if (can(user.role, 'quality')) {
    const rejected = rolls.filter((r) => r.quality === 'REWORK');
    if (rejected.length) alerts.push({ id: 'rework', title: `${rejected.length} rolls need rework`, description: 'Review defects before reinspection.', severity: 'warning', href: '/quality' });
  }

  const series = Array.from({ length: 7 }, (_, i) => {
    const start = new Date(day.getTime() - (6 - i) * 86400000);
    const end = new Date(start.getTime() + 86400000);
    return {
      date: start.toISOString(),
      label: new Intl.DateTimeFormat('en', { timeZone: 'Asia/Kolkata', weekday: 'short' }).format(start),
      output: sum(entries.filter((e) => e.createdAt >= start && e.createdAt < end).map((e) => e.quantity)).toNumber(),
      target: sum(machines.filter((m) => m.status !== 'OFFLINE').map((m) => D(m.capacityPerHour).mul(8))).toNumber(),
    };
  });

  return {
    date: day,
    activeOrders: active.length,
    dueSoon: active.filter((o) => new Date(o.deadline).getTime() - day.getTime() < 7 * 86400000).length,
    delayed: active.filter((o) => new Date(o.deadline) < day).length,
    availableYarn: sum(lots.map((l) => l.onHand.minus(l.reserved))).toString(),
    todayOutput: String(series[6].output),
    previousOutput: String(series[5].output),
    pendingQuality: rolls.filter((r) => r.quality === 'PENDING').length,
    passed: rolls.filter((r) => r.quality === 'PASSED').length,
    rejected: rolls.filter((r) => r.quality === 'REJECTED').length,
    finishedRolls: rolls.filter((r) => r.quality === 'PASSED' && !r.activeShipmentId).length,
    pendingDispatch: rolls.filter((r) => r.activeShipment?.status === 'DRAFT').length,
    running: machines.filter((m) => m.status === 'RUNNING').length,
    idle: machines.filter((m) => m.status === 'IDLE').length,
    breakdown: machines.filter((m) => m.status === 'BREAKDOWN').length,
    totalMachines: machines.length,
    series,
    orders: orders.slice(0, 5),
    machines,
    alerts,
    activity,
    finance: can(user.role, 'finance') ? await financialReport() : undefined,
  };
}

// ==================== TEAM INBOX ====================

type Notice = { id: string; title: string; description: string; severity: 'warning' | 'danger' | 'success'; href: string };

// Work waiting for the signed-in user's team. Built from live data, so it is
// always accurate and needs no separate notification table.
export async function workInbox(user: CurrentUser): Promise<Notice[]> {
  const notices: Notice[] = [];
  const stage = stageForRole(user.role);

  if (stage || can(user.role, 'production')) {
    const ready = await db.jobCard.findMany({
      where: { status: 'READY', ...(stage ? { stage } : {}) },
      include: { production: true },
      orderBy: { production: { createdAt: 'asc' } },
    });
    for (const job of ready) {
      notices.push({
        id: `job-${job.id}`,
        title: `${job.production.number} is ready for ${job.stage.toLowerCase()}`,
        description: `${job.production.fabric} · ${job.production.color} · ${job.target.toString()} m · Tap to accept`,
        severity: 'success',
        href: '/production',
      });
    }
  }

  if (hasPermission(user, 'users', 'manage')) {
    const pending = await db.user.count({ where: { approvalStatus: 'PENDING' } });
    if (pending) {
      notices.push({ id: 'signups', title: `${pending} new user${pending > 1 ? 's' : ''} waiting for approval`, description: 'Review the request and choose a role', severity: 'warning', href: '/settings' });
    }
  }

  if (hasPermission(user, 'orders', 'approve')) {
    const requests = await db.salesOrder.findMany({ where: { status: 'PENDING_REVIEW' }, include: { buyer: true } });
    for (const order of requests) {
      notices.push({ id: `order-${order.id}`, title: `New order from ${order.buyer.name}`, description: `${order.number} is waiting for your review`, severity: 'warning', href: `/orders/${order.id}` });
    }
  }

  // Quality and dispatch work is grouped per order, so each new batch gets its own notice.
  const rollsByOrder = async (where: Prisma.FabricRollWhereInput) => {
    const rolls = await db.fabricRoll.findMany({ where, include: { production: { include: { order: true } } } });
    const groups = new Map<string, { number: string; count: number }>();
    for (const roll of rolls) {
      // Stock batches have no order, so they are grouped by batch instead.
      const key = roll.production.order?.id ?? roll.production.id;
      const group = groups.get(key) ?? { number: roll.production.order?.number ?? roll.production.number, count: 0 };
      group.count += 1;
      groups.set(key, group);
    }
    return groups;
  };

  if (hasPermission(user, 'quality', 'update')) {
    for (const [orderId, g] of await rollsByOrder({ quality: 'PENDING' })) {
      notices.push({ id: `quality-${orderId}`, title: `${g.number}: ${g.count} roll${g.count > 1 ? 's' : ''} to inspect`, description: 'Check each roll and mark it passed or failed', severity: 'warning', href: '/quality' });
    }
  }

  if (hasPermission(user, 'dispatch', 'update')) {
    for (const [orderId, g] of await rollsByOrder({ quality: 'PASSED', activeShipmentId: null })) {
      notices.push({ id: `dispatch-${orderId}`, title: `${g.number}: ${g.count} roll${g.count > 1 ? 's' : ''} ready to ship`, description: 'Passed quality check · create a shipment', severity: 'success', href: '/dispatch' });
    }
  }

  return notices;
}
