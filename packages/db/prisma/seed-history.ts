import { randomUUID } from 'node:crypto';
import type { Tx } from '../src/index.js';
import type { CurrentUser } from '@loomos/shared';
import { createOrder, planOrder } from '../../../backend/src/services/order.service.js';
import { receiveYarn } from '../../../backend/src/services/inventory.service.js';
import { assignJob, startJob, recordOutput, completeJob } from '../../../backend/src/services/production.service.js';
import { inspectRoll, reworkRoll } from '../../../backend/src/services/quality.service.js';
import { createShipment, verifyRoll, confirmShipment, deliverShipment } from '../../../backend/src/services/dispatch.service.js';
import { buyerPayment, createBill, payBill, createClaim, decideClaim } from '../../../backend/src/services/finance.service.js';
import { calendarDate } from '../../../backend/src/lib/domain.js';

// Five months of believable history for the demo: orders that went through every stage,
// yarn receipts and bills, wages from daily attendance, expenses, breakdowns and claims.
// Everything is made with the real services (so the numbers reconcile) and then moved back
// to the day it happened.

const HOUR = 3600000;
const DAY = 24 * HOUR;
const IST_OFFSET = 5.5 * HOUR;

// Factory-time midnight `daysAgo` days before today.
function dayAgo(daysAgo: number) {
  const today = calendarDate(new Date());
  return new Date(today.getTime() - daysAgo * DAY - IST_OFFSET);
}
const at = (day: Date, hours: number) => new Date(day.getTime() + hours * HOUR);
const dowOf = (day: Date) => new Date(day.getTime() + IST_OFFSET).getUTCDay();
const weekOf = (day: Date) => Math.floor((day.getTime() + IST_OFFSET) / (7 * DAY));

// A small deterministic random generator, so every seed produces the same demo.
function random(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

interface Ctx {
  actor: CurrentUser;
  people: { ops: CurrentUser; production: CurrentUser; inspector: CurrentUser; dispatcher: CurrentUser; accounts: CurrentUser; store: CurrentUser; supervisor: CurrentUser; maintenance: CurrentUser };
  buyers: { id: string; name: string }[];
  yarnSuppliers: { id: string; name: string }[];
  serviceSuppliers: Record<'POWER' | 'DYES_CHEMICALS' | 'SPARES' | 'TRANSPORT', { id: string; name: string }>;
  recipes: { id: string; name: string; material: string; specification: string }[];
  workers: { id: string; name: string; departmentId: string | null; rate: { toNumber(): number } }[];
  // Worker indexes per stage (operators who run that stage's machines).
  crews: Record<'SPINNING' | 'WEAVING' | 'DYEING', number[]>;
  // Office and support staff who work the morning shift.
  dayStaff: number[];
  machines: { id: string; code: string; type: string }[];
  shifts: { id: string; name: string; startHour: number }[];
  // The calendar date attendance is open for right now (history stops the day before).
  currentShiftDate: Date;
}

type Log = { actorId: string; actorName: string; action: string; entityId: string; detail: string; createdAt: Date };

export async function seedHistory(tx: Tx, ctx: Ctx) {
  const rnd = random(20261011);
  const logs: Log[] = [];
  const log = (who: CurrentUser, action: string, entityId: string, detail: string, createdAt: Date) =>
    logs.push({ actorId: who.id, actorName: who.name, action, entityId, detail, createdAt });
  const startedAt = new Date();
  // The app treats these ledgers as append-only (database triggers). History is written "now"
  // and then moved to the day it happened, so the seed lifts the guard only while it does that.
  const ledgers = ['StockMovement', 'QualityInspection', 'AuditLog'];
  for (const table of ledgers) await tx.$executeRawUnsafe(`ALTER TABLE "${table}" DISABLE TRIGGER USER`);

  // ---------- Who works which shift ----------
  // Floor crews rotate shifts weekly; each person has one weekly day off. Office staff work mornings.
  const offDay = (w: number) => (w * 3) % 7;
  const shiftFor = (w: number, day: Date) => (ctx.dayStaff.includes(w) ? 0 : (w + weekOf(day)) % ctx.shifts.length);
  const forced = new Map<string, number>(); // `${worker}:${dayMs}` → shift index, for people who ran a stage

  // ---------- Yarn receipts, one per material per month, with their bills ----------
  const monthsBack = [5, 4, 3, 2, 1, 0];
  const today = calendarDate(new Date());
  const monthStart = (back: number) => {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - back, 1));
    return new Date(d.getTime() - IST_OFFSET);
  };
  const receiptPlan = [
    { recipe: 0, kg: 8000, cost: 268, color: 'Natural', threshold: 600 },
    { recipe: 1, kg: 8000, cost: 279, color: 'Ivory', threshold: 600 },
    { recipe: 2, kg: 8000, cost: 302, color: 'Natural', threshold: 800 },
    { recipe: 3, kg: 8000, cost: 241, color: 'Raw white', threshold: 500 },
  ];
  let grn = 1;
  for (const back of monthsBack) {
    for (const [i, r] of receiptPlan.entries()) {
      const recipe = ctx.recipes[r.recipe];
      const day = new Date(monthStart(back).getTime() + (1 + i) * DAY);
      if (day > new Date()) continue;
      const reference = `GRN-${String(grn++).padStart(4, '0')}`;
      const supplier = ctx.yarnSuppliers[i % ctx.yarnSuppliers.length];
      const kg = Math.round(r.kg * (0.9 + rnd() * 0.2));
      const costPerKg = Math.round(r.cost * (0.97 + rnd() * 0.06));
      const lot = await receiveYarn(tx, {
        supplierId: supplier.id, reference, material: recipe.material, color: r.color, specification: recipe.specification,
        quantity: kg, costPerKg, location: `Warehouse A · Rack ${i + 1}`, threshold: r.threshold,
      } as never, ctx.people.store);
      const when = at(day, 11);
      await tx.yarnLot.update({ where: { id: lot.id }, data: { createdAt: when } });
      const receipt = await tx.goodsReceipt.update({ where: { lotId: lot.id }, data: { receivedAt: when } });
      const bill = await tx.supplierBill.update({ where: { receiptId: receipt.id }, data: { billDate: when, createdAt: when, dueAt: new Date(when.getTime() + 30 * DAY) } });
      await tx.stockMovement.updateMany({ where: { source: receipt.id }, data: { createdAt: when } });
      log(ctx.people.store, 'inventory.received', lot.id, `${lot.code} · ${kg} kg ${recipe.material} ${r.color} received from ${supplier.name}`, when);
      // Supplier bills are paid about three weeks after the yarn arrives.
      const paidOn = at(day, 21 * 24 + 15);
      if (paidOn < new Date()) {
        const payment = await payBill(tx, bill.id, { amount: bill.total.toNumber(), reference: `RTGS-${reference}` }, ctx.people.accounts);
        await tx.supplierPayment.update({ where: { id: payment.id }, data: { createdAt: paidOn } });
        log(ctx.people.accounts, 'finance.supplier_payment', bill.id, `₹${bill.total.toFixed(0)} paid to ${supplier.name} for ${reference}`, paidOn);
      }
    }
  }

  // ---------- Other bills and expenses, every month ----------
  for (const back of monthsBack) {
    const m = monthStart(back);
    const bills: [keyof Ctx['serviceSuppliers'], number, number, string][] = [
      ['POWER', 5, 168000, 'Electricity for the month'],
      ['DYES_CHEMICALS', 12, 82000, 'Reactive dyes and auxiliaries'],
      ['SPARES', 18, 26000, 'Loom spares, spindles and belts'],
      ['TRANSPORT', 24, 19000, 'Outward freight'],
    ];
    for (const [category, dayOfMonth, amount, description] of bills) {
      const day = new Date(m.getTime() + (dayOfMonth - 1) * DAY);
      if (day > dayAgo(0)) continue;
      const supplier = ctx.serviceSuppliers[category];
      const total = Math.round(amount * (0.85 + rnd() * 0.3));
      const ymd = new Date(day.getTime() + IST_OFFSET).toISOString().slice(0, 10);
      const bill = await createBill(tx, { supplierId: supplier.id, number: `${category.slice(0, 3)}-${ymd.slice(0, 7).replace('-', '')}`, category, description, amount: total, billDate: ymd } as never, ctx.people.accounts);
      const when = at(day, 12);
      await tx.supplierBill.update({ where: { id: bill.id }, data: { createdAt: when } });
      log(ctx.people.accounts, 'finance.bill', bill.id, `Bill from ${supplier.name} · ₹${total} · ${description}`, when);
      const paidOn = at(day, 18 * 24 + 12);
      if (paidOn < new Date()) {
        const payment = await payBill(tx, bill.id, { amount: total, reference: `NEFT-${category.slice(0, 3)}-${ymd}` }, ctx.people.accounts);
        await tx.supplierPayment.update({ where: { id: payment.id }, data: { createdAt: paidOn } });
      }
    }
    const expenses: [string, number, number, string][] = [
      ['Rent', 1, 95000, 'Factory shed rent'],
      ['Office', 8, 12000, 'Stationery, internet and phones'],
      ['Maintenance', 15, 18000, 'Compressor and boiler servicing'],
      ['Transport', 22, 9000, 'Staff bus'],
    ];
    for (const [category, dayOfMonth, amount, description] of expenses) {
      const day = new Date(m.getTime() + (dayOfMonth - 1) * DAY);
      if (day > dayAgo(0)) continue;
      await tx.operatingExpense.create({ data: { category, description, amount: Math.round(amount * (0.9 + rnd() * 0.2)), recordedBy: ctx.people.accounts.name, createdAt: at(day, 13) } });
    }
  }

  // ---------- Orders that went through the whole mill ----------
  // daysAgo the order arrived, buyer, recipe, colour, metres, quality outcome, payment
  // One hundred orders spread over five months: a new order roughly every day and a half, rotating
  // through the buyers and fabrics, with the occasional rework or rejection and a few still unpaid.
  const colours = ['Ivory', 'Navy', 'Sand', 'Raw white', 'Sky blue', 'Charcoal', 'Olive', 'Peach', 'Natural', 'Maroon', 'Sage green', 'White', 'Indigo', 'Ecru', 'Lilac', 'Rust', 'Khaki', 'Mint', 'Beige', 'Black', 'Coral', 'Teal', 'Grey', 'Mustard', 'Bottle green'];
  const ORDERS = 125;
  const plan: [number, number, number, string, number, 'ok' | 'rework' | 'reject' | 'pending', 'full' | 'half' | 'none'][] = Array.from({ length: ORDERS }, (_, i) => {
    const daysAgo = Math.round(152 - (i * 148) / (ORDERS - 1));
    const quality = i >= ORDERS - 2 ? 'pending' : i % 11 === 6 ? 'reject' : i % 7 === 3 ? 'rework' : 'ok';
    const payment = daysAgo > 40 ? (i % 9 === 4 ? 'half' : 'full') : daysAgo > 20 ? (i % 3 === 0 ? 'none' : i % 3 === 1 ? 'half' : 'full') : 'none';
    return [daysAgo, i % ctx.buyers.length, (i * 3) % ctx.recipes.length, colours[i % colours.length], 1200 + ((i * 37) % 8) * 200, quality, payment];
  });
  const defectsFor = ['Colour mismatch', 'Uneven weaving', 'Holes', 'Stains', 'Broken picks'];
  const trucks = ['PB-10-GT-4521', 'HR-55-KL-0932', 'GJ-01-AB-7781', 'MH-04-CD-1190', 'DL-1C-AA-5520', 'RJ-14-GH-3301'];
  const drivers = ['Gurpreet Singh', 'Mahesh Yadav', 'Suresh Patil', 'Ramesh Chauhan', 'Iqbal Sheikh', 'Kuldeep Rana'];

  for (const [index, [daysAgo, buyerIdx, recipeIdx, color, metres, quality, payment]] of plan.entries()) {
    const created = dayAgo(daysAgo);
    const buyer = ctx.buyers[buyerIdx];
    const recipe = ctx.recipes[recipeIdx];
    const order = await createOrder(tx, {
      buyerId: buyer.id,
      deadline: new Date(created.getTime() + 12 * DAY + IST_OFFSET).toISOString().slice(0, 10),
      priority: index % 5 === 0 ? 'HIGH' : 'NORMAL',
      instructions: '',
      items: [{ recipeId: recipe.id, color, quantity: metres }],
    }, ctx.people.ops);
    const orderNumber = `SO-2026-${String(700 + index).padStart(4, '0')}`;
    await tx.salesOrder.update({ where: { id: order.id }, data: { number: orderNumber, createdAt: at(created, 10), deadline: at(created, 12 * 24 + 18) } });
    await planOrder(tx, order.id, ctx.people.ops);
    const batch = await tx.productionOrder.findUniqueOrThrow({ where: { itemId: order.items[0].id }, include: { jobs: { orderBy: { sequence: 'asc' } } } });
    const batchNumber = `WO-${1700 + index}`;
    await tx.productionOrder.update({ where: { id: batch.id }, data: { number: batchNumber, createdAt: at(created, 10.5), dueDate: at(created, 12 * 24 + 18) } });
    log(ctx.people.ops, 'order.created', order.id, `${orderNumber} · New order from ${buyer.name}: ${metres} m ${recipe.name}, ${color}`, at(created, 10));
    log(ctx.people.ops, 'production.created', batch.id, `${batchNumber} · ${metres} m ${recipe.name} planned for order ${orderNumber}`, at(created, 10.5));

    // Run the three stages on consecutive days, on whichever shift the chosen operator works.
    let lastEnd = at(created, 11);
    for (const job of batch.jobs) {
      let stageDay = dayAgo(daysAgo - 1 - job.sequence);
      const crew = ctx.crews[job.stage as 'SPINNING' | 'WEAVING' | 'DYEING'];
      const candidates = crew.filter((w) => dowOf(stageDay) !== offDay(w));
      const workerIdx = candidates[(index + job.sequence) % candidates.length];
      const worker = ctx.workers[workerIdx];
      let shiftIdx = shiftFor(workerIdx, stageDay);
      let start = at(stageDay, ctx.shifts[shiftIdx].startHour + 0.5);
      // Stages never overlap: if this shift starts before the last stage ended, use the next day.
      if (start <= lastEnd) {
        stageDay = new Date(stageDay.getTime() + DAY);
        shiftIdx = shiftFor(workerIdx, stageDay);
        start = at(stageDay, ctx.shifts[shiftIdx].startHour + 0.5);
      }
      forced.set(`${workerIdx}:${stageDay.getTime()}`, shiftIdx);
      const machines = ctx.machines.filter((m) => m.type === job.stage);
      const machine = machines[(index + job.sequence) % machines.length];

      await assignJob(tx, job.id, { machineId: machine.id, workerId: worker.id }, ctx.people.production);
      await startJob(tx, job.id, ctx.actor);
      const first = Math.round(metres * 0.6);
      const hours = (m: number) => Math.min(7.5, Math.round((m / 140) * 10) / 10);
      await recordOutput(tx, job.id, { quantity: first, waste: Math.round(first * 0.01), hours: hours(first), consumedKg: 0, rollLengths: [] }, ctx.actor);
      await completeJob(tx, job.id, { quantity: metres - first, waste: Math.round((metres - first) * 0.01), hours: hours(metres - first), consumedKg: 0, rollLengths: [] }, ctx.actor);

      // Move the run to its real time.
      const entryTimes = [at(start, 3), at(start, 7)];
      const end = at(start, 7.25);
      lastEnd = end;
      await tx.jobCard.update({ where: { id: job.id }, data: { startedAt: start, endedAt: end, shiftId: ctx.shifts[shiftIdx].id } });
      await tx.machineAssignment.updateMany({ where: { jobId: job.id }, data: { startedAt: start, endedAt: end, shiftId: ctx.shifts[shiftIdx].id } });
      await tx.workerAssignment.updateMany({ where: { jobId: job.id }, data: { startedAt: start, endedAt: end } });
      const entries = await tx.productionEntry.findMany({ where: { jobId: job.id }, orderBy: { createdAt: 'asc' } });
      for (const [n, entry] of entries.entries()) {
        const when = entryTimes[Math.min(n, entryTimes.length - 1)];
        await tx.productionEntry.update({ where: { id: entry.id }, data: { createdAt: when } });
        await tx.costAllocation.updateMany({ where: { source: { startsWith: entry.id } }, data: { createdAt: when } });
        await tx.stockMovement.updateMany({ where: { source: entry.id }, data: { createdAt: when } });
        await tx.fabricRoll.updateMany({ where: { entryId: entry.id }, data: { createdAt: when } });
      }
      const stage = job.stage.toLowerCase();
      log(ctx.people.production, 'production.assigned', batch.id, `${batchNumber} · ${stage} assigned to ${machine.code} · ${worker.name}`, at(start, -0.5));
      log({ ...ctx.actor, name: worker.name }, 'production.started', batch.id, `${batchNumber} · ${stage} started on ${machine.code} by ${worker.name} (${ctx.shifts[shiftIdx].name})`, start);
      log({ ...ctx.actor, name: worker.name }, 'production.output', batch.id, `${batchNumber} · ${machine.code} · ${first} m ${stage} output recorded`, entryTimes[0]);
      const next = batch.jobs.find((j) => j.sequence === job.sequence + 1);
      log({ ...ctx.actor, name: worker.name }, 'production.complete', batch.id, `${batchNumber} · ${stage} completed with ${metres} m · ${next ? `sent to ${next.stage.toLowerCase()}` : 'fabric rolls sent to quality check'}`, end);
    }
    await tx.stockReservation.updateMany({ where: { productionId: batch.id }, data: { createdAt: at(created, 11) } });

    if (quality === 'pending') continue; // made, waiting for the inspector

    // Quality: the inspector checks every roll the morning after dyeing.
    const inspectDay = new Date(Math.max(dayAgo(daysAgo - 4).getTime(), lastEnd.getTime() - (lastEnd.getTime() + IST_OFFSET) % DAY + DAY - IST_OFFSET));
    const inspectAt = at(inspectDay, 10);
    const rolls = await tx.fabricRoll.findMany({ where: { productionId: batch.id }, orderBy: { code: 'asc' } });
    const defect = defectsFor[index % defectsFor.length];
    let reworked = 0;
    let rejected = 0;
    for (const [n, roll] of rolls.entries()) {
      if (quality === 'rework' && n === 1) {
        await inspectRoll(tx, roll.id, { result: 'REWORK', defects: [defect], notes: 'Found at final inspection' }, ctx.people.inspector);
        await reworkRoll(tx, roll.id, 1800, `Repaired at the bay: ${defect.toLowerCase()} corrected`, ctx.people.inspector);
        reworked += 1;
      }
      if (quality === 'reject' && n === 2) {
        await inspectRoll(tx, roll.id, { result: 'REJECTED', defects: ['Holes'], notes: 'Too many holes to repair' }, ctx.people.inspector);
        rejected += 1;
        continue;
      }
      await inspectRoll(tx, roll.id, { result: 'PASSED', defects: [], notes: '' }, ctx.people.inspector);
    }
    const inspections = await tx.qualityInspection.findMany({ where: { roll: { productionId: batch.id } }, orderBy: { createdAt: 'asc' } });
    for (const [n, inspection] of inspections.entries()) {
      await tx.qualityInspection.update({ where: { id: inspection.id }, data: { createdAt: at(inspectAt, n * 0.1) } });
    }
    await tx.reworkJob.updateMany({ where: { productionId: batch.id }, data: { createdAt: at(inspectAt, 0.5), completedAt: at(inspectAt, 5) } });
    await tx.costAllocation.updateMany({ where: { productionId: batch.id, category: 'REWORK' }, data: { createdAt: at(inspectAt, 5) } });
    log(ctx.people.inspector, 'quality.inspected', batch.id, `${batchNumber} · ${rolls.length} rolls inspected: ${rolls.length - reworked - rejected} passed first time${reworked ? `, ${reworked} repaired (${defect.toLowerCase()})` : ''}${rejected ? `, ${rejected} rejected (holes)` : ''}`, at(inspectAt, 2));

    // Dispatch the next day; the buyer receives it two days later.
    const passed = await tx.fabricRoll.findMany({ where: { productionId: batch.id, quality: 'PASSED' } });
    const shipAt = at(inspectDay, 24 + 15);
    if (shipAt > new Date()) continue;
    const truck = index % trucks.length;
    const shipment = await createShipment(tx, { orderId: order.id, rollIds: passed.map((r) => r.id), transport: trucks[truck], driverName: drivers[truck], driverPhone: `+91 98${String(10000000 + index * 7919).slice(0, 8)}`, expectedAt: new Date(shipAt.getTime() + 2 * DAY + IST_OFFSET).toISOString().slice(0, 10) }, ctx.people.dispatcher);
    for (const roll of passed) await verifyRoll(tx, shipment.id, roll.code, ctx.people.dispatcher);
    const invoice = await confirmShipment(tx, shipment.id, ctx.people.dispatcher);
    const deliverAt = at(shipAt, 45);
    const delivered = deliverAt < new Date();
    if (delivered) await deliverShipment(tx, shipment.id, { receivedBy: `${buyer.name} stores`, note: '' }, ctx.people.dispatcher);
    const dsp = `DSP-${String(5000 + index)}`;
    const inv = `INV-2026-${String(400 + index)}`;
    await tx.shipment.update({ where: { id: shipment.id }, data: { number: dsp, createdAt: at(shipAt, -3), confirmedAt: shipAt, deliveredAt: delivered ? deliverAt : null } });
    await tx.invoice.update({ where: { id: invoice.id }, data: { number: inv, createdAt: shipAt, dueAt: new Date(shipAt.getTime() + 30 * DAY) } });
    await tx.fabricRoll.updateMany({ where: { productionId: batch.id, quality: 'PASSED' }, data: { location: delivered ? 'Delivered' : 'Dispatched' } });
    log(ctx.people.dispatcher, 'shipment.confirmed', shipment.id, `${dsp} · ${invoice.total.toFixed(0)} ₹ invoiced (${inv}) · ${passed.length} rolls on ${trucks[truck]}`, shipAt);
    log(ctx.people.dispatcher, 'shipment.confirmed', order.id, `${dsp} · dispatched on ${trucks[truck]}`, shipAt);
    if (delivered) log(ctx.people.dispatcher, 'shipment.delivered', order.id, `${dsp} delivered to ${buyer.name}`, deliverAt);

    // Buyers pay within three weeks, some in two parts, a few not yet.
    const pay = async (share: number, afterDays: number, suffix: string) => {
      const when = at(shipAt, afterDays * 24);
      if (when > new Date()) return;
      const amount = Math.round(invoice.total.toNumber() * share * 100) / 100;
      const p = await buyerPayment(tx, invoice.id, { amount, reference: `UTR-${inv}-${suffix}` }, ctx.people.accounts);
      await tx.buyerPayment.update({ where: { id: p.id }, data: { createdAt: when } });
      log(ctx.people.accounts, 'finance.payment', invoice.id, `₹${amount.toFixed(0)} received from ${buyer.name} against ${inv}`, when);
    };
    if (payment === 'full') await pay(1, 18 + (index % 6), 'A');
    if (payment === 'half') await pay(0.5, 14, 'A');
  }

  // ---------- A credit claim and a supplier claim ----------
  const creditInvoice = await tx.invoice.findFirst({ where: { status: 'PARTIAL' }, orderBy: { createdAt: 'asc' }, include: { shipment: { include: { order: true } } } });
  if (creditInvoice) {
    const claim = await createClaim(tx, { party: 'BUYER', buyerId: creditInvoice.shipment.order.buyerId, invoiceId: creditInvoice.id, orderId: creditInvoice.shipment.order.id, amount: 6500, reason: 'Two rolls arrived with crushed cores' }, ctx.people.accounts);
    await decideClaim(tx, claim.id, { decision: 'APPROVED', note: 'Photos checked, credit given' }, ctx.actor);
    const when = at(creditInvoice.createdAt, 6 * 24);
    await tx.claim.update({ where: { id: claim.id }, data: { createdAt: when, decidedAt: at(when, 26) } });
  }
  const shortSupply = await createClaim(tx, { party: 'SUPPLIER', supplierId: ctx.yarnSuppliers[1].id, amount: 9200, reason: '34 kg short in the last cotton delivery' }, ctx.people.accounts);
  await tx.claim.update({ where: { id: shortSupply.id }, data: { createdAt: dayAgo(9) } });

  // ---------- Breakdowns and maintenance over the months ----------
  const downtime: [number, string, string, string, number, string][] = [
    [140, 'LM-01', 'BREAKDOWN', 'Shuttle box jammed', 3, 'Shuttle box cleaned and re-timed'],
    [118, 'SP-02', 'BREAKDOWN', 'Spindle bearing noise', 5, 'Bearing replaced'],
    [101, 'DY-01', 'MAINTENANCE', 'Quarterly heat exchanger service', 6, 'Serviced and pressure tested'],
    [77, 'LM-02', 'BREAKDOWN', 'Warp beam tension fault', 4, 'Tension spring replaced'],
    [58, 'DY-02', 'BREAKDOWN', 'Circulation pump tripped', 2.5, 'Pump motor rewound'],
    [36, 'SP-01', 'MAINTENANCE', 'Drafting zone cleaning', 4, 'Cleaned and oiled'],
    [21, 'LM-01', 'BREAKDOWN', 'Weft sensor failure', 2, 'Sensor replaced'],
    [8, 'DY-01', 'BREAKDOWN', 'Temperature controller error', 3, 'Controller recalibrated'],
    [2, 'SP-02', 'MAINTENANCE', 'Belt alignment', 2, 'Belts aligned'],
  ];
  for (const [ago, code, kind, reason, hours, resolution] of downtime) {
    const machine = ctx.machines.find((m) => m.code === code);
    if (!machine) continue;
    const start = at(dayAgo(ago), 9 + (ago % 9));
    await tx.downtimeEvent.create({ data: { machineId: machine.id, kind, reason, resolution, reportedBy: ctx.people.supervisor.name, startedAt: start, endedAt: at(start, hours) } });
    log(ctx.people.supervisor, kind === 'BREAKDOWN' ? 'machine.breakdown' : 'machine.maintenance', machine.id, `${code} · ${reason}`, start);
    log(ctx.people.maintenance, 'machine.repaired', machine.id, `${code} · ${resolution}`, at(start, hours));
  }

  // ---------- Attendance and wages for every day up to yesterday ----------
  const firstDay = dayAgo(153);
  const attendance: { id: string; workerId: string; shiftId: string; date: Date; hours: number; status: string; checkInAt: Date | null; checkOutAt: Date | null; overtimeHours: number; recordedBy: string; note: string }[] = [];
  const wages: { workerId: string; attendanceId: string; amount: number; calculation: string; paidAt: Date | null }[] = [];
  for (let day = firstDay; calendarDate(new Date(day.getTime() + HOUR)) < ctx.currentShiftDate; day = new Date(day.getTime() + DAY)) {
    for (const [w, worker] of ctx.workers.entries()) {
      const key = `${w}:${day.getTime()}`;
      const mustWork = forced.has(key);
      if (!mustWork && dowOf(day) === offDay(w)) continue;
      const shiftIdx = forced.get(key) ?? shiftFor(w, day);
      const shift = ctx.shifts[shiftIdx];
      const absent = !mustWork && rnd() < 0.03;
      const overtime = !absent && rnd() < 0.06 ? 2 : 0;
      const id = randomUUID();
      const checkIn = at(day, shift.startHour - 0.25 + rnd() * 0.4);
      const hours = absent ? 0 : 8;
      attendance.push({
        id,
        workerId: worker.id,
        shiftId: shift.id,
        date: calendarDate(at(day, 12)),
        hours,
        status: absent ? 'ABSENT' : 'PRESENT',
        checkInAt: absent ? null : checkIn,
        checkOutAt: absent ? null : at(checkIn, 8 + overtime),
        overtimeHours: overtime,
        recordedBy: ctx.people.supervisor.name,
        note: overtime ? `Overtime ${overtime} h: urgent order.` : absent ? 'Absent without leave' : '',
      });
      if (!absent) {
        const paidAt = at(day, 6 * 24 + 18);
        wages.push({
          workerId: worker.id,
          attendanceId: id,
          amount: Math.round(worker.rate.toNumber() * (hours + overtime) * 100) / 100,
          calculation: `${hours + overtime} hours × rate`,
          paidAt: paidAt < dayAgo(0) ? paidAt : null,
        });
      }
    }
  }
  await tx.attendance.createMany({ data: attendance });
  await tx.wageEntry.createMany({ data: wages });

  // ---------- Clean up: history needs no notifications; its activity log is the curated one ----------
  await tx.notification.deleteMany({});
  await tx.auditLog.deleteMany({ where: { createdAt: { gte: startedAt } } });
  await tx.auditLog.createMany({ data: logs });
  for (const table of ledgers) await tx.$executeRawUnsafe(`ALTER TABLE "${table}" ENABLE TRIGGER USER`);

  return { orders: plan.length, attendance: attendance.length };
}
