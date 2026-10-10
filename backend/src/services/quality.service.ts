import { db, type Tx } from '@loomos/db';
import type { CurrentUser } from '@loomos/shared';
import { audit, D, ensure, type Actor } from '../lib/domain.js';
import { notify, managers } from './notification.service.js';

export async function inspectRoll(tx: Tx, id: string, input: { result: string; defects: string[]; notes: string }, actor: Actor) {
  const roll = await tx.fabricRoll.findUnique({ where: { id }, include: { production: true } });
  ensure(roll, 'Roll not found.', 404);
  ensure(!roll.activeShipmentId, 'A reserved or shipped roll cannot be inspected.');
  ensure(roll.quality === 'PENDING', 'Start rework before recording a new inspection.');
  const production = roll.production;

  const inspection = await tx.qualityInspection.create({ data: { rollId: id, inspector: actor.name, ...input } });
  const stockRoll = !production.orderId;
  await tx.fabricRoll.update({
    where: { id },
    data: {
      quality: input.result,
      location: input.result === 'PASSED'
        ? (stockRoll ? 'Warehouse A · Finished stock' : 'Warehouse A · Finished goods')
        : input.result === 'REWORK' ? 'Rework · Bay 02' : 'QC · Hold',
    },
  });

  if (input.result === 'REWORK') {
    // Default: repair at the rework bay. The inspector can instead send it back to a stage.
    await tx.reworkJob.create({
      data: {
        rollId: id,
        productionId: production.id,
        defectType: 'QUALITY_FAILURE',
        reason: input.defects.join(', '),
        fromStage: 'QUALITY',
        quantity: roll.length,
        rollCodes: [roll.code],
        raisedBy: actor.name,
      },
    });
  }

  if (input.result !== 'PASSED') {
    await notify(tx, {
      roles: [...managers, 'SHIFT_SUPERVISOR'],
      title: `Quality ${input.result === 'REWORK' ? 'rework' : 'rejection'}: ${roll.code}`,
      message: `${production.number} · ${input.defects.join(', ')}${input.notes ? ` · ${input.notes}` : ''}`,
      category: 'QUALITY',
      link: `/batches?open=${production.id}`,
      skipUserId: actor.id,
    });
  }

  // The order is ready to ship once every roll has passed and nothing is still being made.
  if (production.orderId) {
    const pending = await tx.fabricRoll.count({ where: { production: { orderId: production.orderId, status: { not: 'CANCELLED' } }, quality: { not: 'PASSED' } } });
    const incomplete = await tx.productionOrder.count({ where: { orderId: production.orderId, status: { notIn: ['COMPLETED', 'CANCELLED'] } } });
    if (!pending && !incomplete) {
      await tx.salesOrder.updateMany({ where: { id: production.orderId, status: { in: ['QUALITY', 'IN_PRODUCTION', 'PLANNED'] } }, data: { status: 'READY' } });
    }
  }
  await audit(tx, actor, 'quality.inspected', id, `${roll.code} · ${input.result.toLowerCase()}`);
  await audit(tx, actor, 'quality.inspected', production.id, `${production.number} · roll ${roll.code} ${input.result.toLowerCase()}${input.defects.length ? `: ${input.defects.join(', ')}` : ''}`);
  return inspection;
}

// Repair at the rework bay (no stage needed): the roll goes back to inspection.
export async function reworkRoll(tx: Tx, id: string, cost: number, notes: string, actor: Actor) {
  const roll = await tx.fabricRoll.findUnique({ where: { id }, include: { production: true, reworks: true } });
  ensure(roll, 'Roll not found.', 404);
  ensure(roll.quality === 'REWORK' && !roll.activeShipmentId, 'Only unshipped rework rolls can be returned to inspection.');

  const job = roll.reworks.find((j) => j.status === 'OPEN' && !j.returnStage);
  ensure(job, 'This roll is waiting for a stage rework, not a bay repair.');

  await tx.reworkJob.update({
    where: { id: job.id },
    data: { status: 'COMPLETED', cost, outcome: `Repaired at rework bay: ${notes}`, resolvedBy: actor.name, completedAt: new Date() },
  });
  await tx.costAllocation.create({
    data: { orderId: roll.production.orderId, productionId: roll.productionId, category: 'REWORK', amount: D(cost), source: job.id, methodology: notes },
  });
  await tx.fabricRoll.update({ where: { id }, data: { quality: 'PENDING', location: 'QC • Bay 01', cost: { increment: cost } } });
  await audit(tx, actor, 'quality.rework', id, `${roll.code} · Rework completed, awaiting reinspection`);
  await audit(tx, actor, 'production.rework.completed', roll.productionId, `${roll.code} repaired at rework bay: ${notes}`);
  return { id };
}

export async function rollPassport(id: string, user: CurrentUser) {
  const roll = await db.fabricRoll.findFirst({
    where: { OR: [{ id }, { code: id }] },
    include: {
      inspections: { orderBy: { createdAt: 'desc' } },
      reworks: { orderBy: { createdAt: 'desc' } },
      production: {
        include: {
          order: { include: { buyer: true } },
          reworks: { where: { returnStage: { not: null } }, orderBy: { createdAt: 'desc' } },
          jobs: { include: { machine: true, entries: { include: { consumptions: { include: { lot: { include: { supplier: true } } } } } } } },
        },
      },
      shipmentHistory: { include: { shipment: { include: { order: { include: { buyer: true } } } } } },
    },
  });
  ensure(roll, 'Roll not found.', 404);
  const order = roll.production.order ?? roll.shipmentHistory[0]?.shipment.order ?? null;
  if (user.role === 'BUYER') ensure(order?.buyerId === user.buyerId, 'Roll not found.', 404);

  const reworks = [
    ...roll.reworks,
    ...roll.production.reworks.filter((r) => r.rollCodes.includes(roll.code) && !roll.reworks.some((own) => own.id === r.id)),
  ];

  return {
    id: roll.id,
    code: roll.code,
    length: roll.length,
    quality: roll.quality,
    location: roll.location,
    fabric: roll.production.fabric,
    color: roll.production.color,
    batch: roll.production.number,
    order: order?.number ?? 'Finished stock',
    buyer: order?.buyer.name ?? 'Not yet allocated',
    createdAt: roll.createdAt,
    inspections: roll.inspections,
    reworks: user.role === 'BUYER' ? [] : reworks,
    stages: roll.production.jobs.map((j) => ({ stage: j.stage, status: j.status, machine: j.machine?.code, output: j.output, startedAt: j.startedAt, endedAt: j.endedAt })),
    lots: user.role === 'BUYER' ? [] : roll.production.jobs.flatMap((j) => j.entries.flatMap((e) => e.consumptions.map((c) => ({ code: c.lot.code, material: c.lot.material, supplier: c.lot.supplier.name, quantity: c.quantity })))),
    shipments: roll.shipmentHistory.map((s) => ({ number: s.shipment.number, status: s.shipment.status, transport: s.shipment.transport })),
  };
}
