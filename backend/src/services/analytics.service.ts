import { db, Prisma } from '@loomos/db';
import { businessDay, sum } from '../lib/domain.js';
import { statusGroup } from './production.service.js';

// Factory analytics for the dashboard charts. Everything is calculated from real records.

export interface AnalyticsFilters {
  from?: string; // yyyy-mm-dd, default: 13 days before `to`
  to?: string; // yyyy-mm-dd, default: today
  buyerId?: string;
  stage?: string; // SPINNING, WEAVING or DYEING
}

const DAY = 86400000;
const stages = ['SPINNING', 'WEAVING', 'DYEING'] as const;

const dayLabel = (d: Date) =>
  new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' }).format(d);

export async function analytics(filters: AnalyticsFilters) {
  const to = businessDay(filters.to ? new Date(`${filters.to}T12:00:00+05:30`) : new Date());
  const from = filters.from ? businessDay(new Date(`${filters.from}T12:00:00+05:30`)) : new Date(to.getTime() - 13 * DAY);
  const end = new Date(to.getTime() + DAY);
  const days = Math.min(92, Math.max(1, Math.round((end.getTime() - from.getTime()) / DAY)));
  const inRange = { gte: from, lt: end };

  // Customer filter applies to everything that belongs to a batch.
  const batchWhere: Prisma.ProductionOrderWhereInput = filters.buyerId ? { order: { buyerId: filters.buyerId } } : {};
  const stageWhere = filters.stage ? { stage: filters.stage } : {};

  const [entries, machines, batches, reworks, inspections, orders] = await Promise.all([
    db.productionEntry.findMany({
      where: { createdAt: inRange, job: { ...stageWhere, production: batchWhere } },
      include: { job: { select: { stage: true, machineId: true } } },
    }),
    db.machine.findMany({ where: filters.stage ? { type: filters.stage } : {}, orderBy: { code: 'asc' } }),
    db.productionOrder.findMany({
      where: batchWhere,
      include: {
        jobs: { select: { stage: true, status: true } },
        order: { select: { deadline: true } },
        reworks: { select: { status: true } },
        rolls: { select: { quality: true } },
      },
    }),
    db.reworkJob.findMany({
      where: { createdAt: inRange, production: batchWhere, ...(filters.stage ? { returnStage: filters.stage } : {}) },
    }),
    db.qualityInspection.findMany({
      where: { createdAt: inRange, roll: { production: batchWhere } },
      select: { result: true, createdAt: true },
    }),
    db.salesOrder.findMany({
      where: { status: { not: 'CANCELLED' }, ...(filters.buyerId ? { buyerId: filters.buyerId } : {}) },
      include: { buyer: true, items: true, shipments: true, productions: { include: { rolls: true } } },
    }),
  ]);

  // 1. Daily output per stage.
  const dailyOutput = Array.from({ length: days }, (_, i) => {
    const start = new Date(from.getTime() + i * DAY);
    const stop = new Date(start.getTime() + DAY);
    const today = entries.filter((e) => e.createdAt >= start && e.createdAt < stop);
    const row = { date: start.toISOString(), label: dayLabel(start), SPINNING: 0, WEAVING: 0, DYEING: 0 };
    for (const stage of stages) row[stage] = sum(today.filter((e) => e.job.stage === stage).map((e) => e.quantity)).toNumber();
    return row;
  });

  // 2. Output and waste per department.
  const departmentOutput = stages
    .filter((s) => !filters.stage || s === filters.stage)
    .map((stage) => {
      const rows = entries.filter((e) => e.job.stage === stage);
      return { stage, output: sum(rows.map((e) => e.quantity)).toNumber(), waste: sum(rows.map((e) => e.waste)).toNumber() };
    });

  // 3. Machine utilisation: reported run hours against one 8-hour shift per day.
  const machineUtilization = machines.map((m) => {
    const runHours = sum(entries.filter((e) => e.job.machineId === m.id).map((e) => e.hours)).toNumber();
    return { code: m.code, type: m.type, status: m.status, runHours, utilization: Math.min(100, Math.round((runHours / (days * 8)) * 100)) };
  });

  const machineStatus = ['RUNNING', 'IDLE', 'BREAKDOWN', 'MAINTENANCE', 'OFFLINE']
    .map((status) => ({ status, count: machines.filter((m) => m.status === status).length }))
    .filter((s) => s.count > 0);

  // 4. Production status of every batch (not limited to the date range: this is "right now").
  const relevant = filters.stage ? batches.filter((b) => b.jobs.some((j) => j.stage === filters.stage)) : batches;
  const productionStatus = ['PENDING', 'ONGOING', 'REWORK', 'COMPLETED', 'FAILED'].map((status) => ({
    status,
    count: relevant.filter((b) => statusGroup(b) === status).length,
  }));

  // 5. Delays: unfinished batches past their due date.
  const now = Date.now();
  const open = relevant.filter((b) => !['COMPLETED', 'CANCELLED'].includes(b.status));
  const due = (b: (typeof batches)[number]) => b.dueDate ?? b.order?.deadline ?? null;
  const lateBatches = open.filter((b) => due(b) && due(b)!.getTime() < now);
  const delays = {
    delayed: lateBatches.length,
    onTime: open.length - lateBatches.length,
    late: lateBatches
      .map((b) => ({
        id: b.id,
        number: b.number,
        daysLate: Math.ceil((now - due(b)!.getTime()) / DAY),
        department: b.jobs.find((j) => !['COMPLETED', 'CANCELLED'].includes(j.status))?.stage ?? 'QUALITY',
      }))
      .sort((a, b) => b.daysLate - a.daysLate)
      .slice(0, 6),
  };

  // 6. Rework by defect type and by the stage work was sent back to.
  const typeNames = [...new Set(reworks.map((r) => r.defectType))];
  const rework = {
    byType: typeNames.map((type) => {
      const rows = reworks.filter((r) => r.defectType === type);
      return { type, count: rows.length, quantity: sum(rows.map((r) => r.quantity)).toNumber() };
    }).sort((a, b) => b.count - a.count),
    byStage: [...stages, 'REWORK BAY'].map((stage) => ({
      stage,
      count: reworks.filter((r) => (r.returnStage ?? 'REWORK BAY') === stage).length,
    })).filter((s) => s.count > 0),
    open: reworks.filter((r) => r.status === 'OPEN' || r.status === 'IN_PROGRESS').length,
    completed: reworks.filter((r) => r.status === 'COMPLETED').length,
  };

  // 7. Quality pass / fail.
  const passed = inspections.filter((i) => i.result === 'PASSED').length;
  const reworked = inspections.filter((i) => i.result === 'REWORK').length;
  const rejected = inspections.filter((i) => i.result === 'REJECTED').length;
  const quality = {
    passed,
    rework: reworked,
    rejected,
    passRate: inspections.length ? Math.round((passed / inspections.length) * 100) : 0,
    daily: Array.from({ length: days }, (_, i) => {
      const start = new Date(from.getTime() + i * DAY);
      const stop = new Date(start.getTime() + DAY);
      const today = inspections.filter((x) => x.createdAt >= start && x.createdAt < stop);
      return { date: start.toISOString(), label: dayLabel(start), passed: today.filter((x) => x.result === 'PASSED').length, failed: today.filter((x) => x.result !== 'PASSED').length };
    }),
  };

  // 8. Customer-wise: ordered vs produced vs dispatched metres.
  const byBuyer = new Map<string, { buyer: string; ordered: number; produced: number; dispatched: number }>();
  for (const o of orders) {
    const row = byBuyer.get(o.buyerId) ?? { buyer: o.buyer.name, ordered: 0, produced: 0, dispatched: 0 };
    row.ordered += sum(o.items.map((i) => i.quantity)).toNumber();
    row.produced += sum(o.productions.flatMap((p) => p.rolls).map((r) => r.length)).toNumber();
    row.dispatched += sum(o.shipments.filter((s) => s.status === 'DISPATCHED').map((s) => s.quantity)).toNumber();
    byBuyer.set(o.buyerId, row);
  }
  const customers = [...byBuyer.values()].sort((a, b) => b.ordered - a.ordered);

  return {
    from: from.toISOString(),
    to: to.toISOString(),
    dailyOutput,
    departmentOutput,
    machineUtilization,
    machineStatus,
    productionStatus,
    delays,
    rework,
    quality,
    customers,
  };
}
