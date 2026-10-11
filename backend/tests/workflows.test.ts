import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { db } from '@loomos/db';
import { app } from '../src/app.js';

// End-to-end API tests for the factory workflows. Each test talks to the real HTTP API
// exactly as the browser does: sign in, send the CSRF token, read the result.

const PASSWORD = 'TestPassword2026!';
type Agent = ReturnType<typeof request.agent> & { csrf: string };

const ids = {
  buyer: '',
  otherBuyer: '',
  recipe: '',
  lot: '',
  depts: {} as Record<string, string>,
  machines: {} as Record<string, string>,
  workers: {} as Record<string, string>, // spinner, weaver, dyer, flexible
};

async function signIn(email: string, password = PASSWORD): Promise<Agent> {
  const agent = request.agent(app) as Agent;
  const res = await agent.post('/api/v1/auth/login').send({ email, password });
  expect(res.status, res.text).toBe(200);
  agent.csrf = res.body.csrf;
  return agent;
}

// POST with the CSRF token; expects success unless a status is given.
async function post(agent: Agent, path: string, body: object = {}, status = 200) {
  const res = await agent.post(`/api/v1${path}`).set('X-CSRF-Token', agent.csrf).send(body);
  expect(res.status, `${path}: ${res.text}`).toBe(status);
  return res.body;
}

async function get(agent: Agent, path: string, status = 200) {
  const res = await agent.get(`/api/v1${path}`);
  expect(res.status, `${path}: ${res.text}`).toBe(status);
  return res.body;
}

async function makeUser(email: string, role: string, extra: object = {}) {
  return db.user.create({
    data: { email, name: email.split('@')[0], role, passwordHash: await bcrypt.hash(PASSWORD, 4), ...extra },
  });
}

const nextWeek = () => new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);

let admin: Agent, ops: Agent, manager: Agent, supervisor: Agent, maintenance: Agent, spinner: Agent, weaver: Agent, dyer: Agent, inspector: Agent, dispatcher: Agent, accounts: Agent, buyerUser: Agent;

// The office (operations manager) places orders for walk-in customers; buyers place their own.
async function newOrder(quantity = 400, agent: Agent = ops, buyerId = ids.buyer) {
  return post(agent, '/orders', {
    buyerId,
    deadline: nextWeek(),
    priority: 'NORMAL',
    instructions: '',
    items: [{ recipeId: ids.recipe, color: 'Blue', quantity }],
  });
}

async function batchOfOrder(orderId: string) {
  return db.productionOrder.findFirstOrThrow({ where: { orderId }, orderBy: { createdAt: 'asc' } });
}

const jobFor = (batchId: string, stage: string) => db.jobCard.findFirstOrThrow({ where: { productionId: batchId, stage } });

// The supervisor checks a worker in on the current shift (no-op if already in).
async function checkIn(workerId: string) {
  const open = await db.attendance.findFirst({ where: { workerId, checkInAt: { not: null }, checkOutAt: null } });
  if (open) return open;
  const board = await get(supervisor, '/shifts/board');
  return post(supervisor, '/attendance/check-in', { workerId, shiftId: board.current.id });
}

// A free machine of the stage's type.
async function freeMachine(stage: string) {
  return db.machine.findFirstOrThrow({ where: { type: stage, status: 'IDLE', active: true }, orderBy: { code: 'asc' } });
}

const operatorOf: Record<string, () => Agent> = { SPINNING: () => spinner, WEAVING: () => weaver, DYEING: () => dyer };
const workerOf: Record<string, string> = {};

// Finish a running stage: the operator confirms the final output of the run.
async function finishStage(agent: Agent, jobId: string, quantity?: number) {
  const job = await db.jobCard.findUniqueOrThrow({ where: { id: jobId } });
  return post(agent, `/production/jobs/${jobId}/complete`, { quantity: quantity ?? job.target.minus(job.output).toNumber(), hours: 2 });
}

// Runs one stage the way the floor does: the manager assigns machine + operator, the operator starts and finishes.
async function runStage(batchId: string, stage: string) {
  const job = await jobFor(batchId, stage);
  const machine = await freeMachine(stage);
  await checkIn(workerOf[stage]);
  const agent = operatorOf[stage]();
  await post(manager, `/production/jobs/${job.id}/assign`, { machineId: machine.id, workerId: workerOf[stage] });
  await post(agent, `/production/jobs/${job.id}/start`);
  await finishStage(agent, job.id);
}

beforeAll(async () => {
  const factory = await db.factory.create({ data: { code: 'T-01', name: 'Test mill', location: 'Test' } });
  for (const code of ['SPINNING', 'WEAVING', 'DYEING']) {
    const d = await db.department.create({ data: { code, name: `${code} dept`, factoryId: factory.id } });
    ids.depts[code] = d.id;
  }
  const buyer = await db.buyer.create({ data: { name: 'Test Buyer', email: 'b@test.local', city: 'Pune', initials: 'TB' } });
  const otherBuyer = await db.buyer.create({ data: { name: 'Other Buyer', email: 'o@test.local', city: 'Surat', initials: 'OB' } });
  const supplier = await db.supplier.create({ data: { name: 'Yarn Co', email: 's@test.local', city: 'Ludhiana' } });
  const recipe = await db.recipe.create({
    data: { name: 'Test poplin', material: 'Cotton yarn', specification: '40s', kgPerMetre: 0.2, wastePercent: 0, route: ['SPINNING', 'WEAVING', 'DYEING'], overheadPerMetre: 5, pricePerMetre: 200 },
  });
  const lot = await db.yarnLot.create({
    data: { code: 'YL-TEST', material: 'Cotton yarn', color: 'Raw', specification: '40s', supplierId: supplier.id, location: 'Store', onHand: 100000, costPerKg: 250, threshold: 10 },
  });
  // Three shifts cover the whole day, so one is always "current".
  for (const [name, startHour] of [['Morning', 6], ['Evening', 14], ['Night', 22]] as const) {
    await db.shift.create({ data: { name, startHour, hours: 8 } });
  }
  for (const [code, type] of [['SP-1', 'SPINNING'], ['SP-2', 'SPINNING'], ['WV-1', 'WEAVING'], ['WV-2', 'WEAVING'], ['DY-1', 'DYEING'], ['DY-2', 'DYEING']]) {
    const m = await db.machine.create({ data: { code, name: code, type, location: 'Floor', capacityPerHour: 100, hourlyCost: 150, factoryId: factory.id, departmentId: ids.depts[type] } });
    ids.machines[code] = m.id;
  }
  for (const [key, name, dept] of [['spinner', 'Asha', 'SPINNING'], ['weaver', 'Bilal', 'WEAVING'], ['dyer', 'Chitra', 'DYEING'], ['flexible', 'Dev', '']]) {
    const w = await db.worker.create({ data: { name, designation: 'Operator', initials: name[0], wageType: 'HOURLY', rate: 100, departmentId: dept ? ids.depts[dept] : null } });
    ids.workers[key] = w.id;
  }
  Object.assign(workerOf, { SPINNING: ids.workers.spinner, WEAVING: ids.workers.weaver, DYEING: ids.workers.dyer });
  Object.assign(ids, { buyer: buyer.id, otherBuyer: otherBuyer.id, recipe: recipe.id, lot: lot.id });

  await makeUser('admin@test.local', 'SUPER_ADMIN');
  await makeUser('ops@test.local', 'OPERATIONS_MANAGER');
  await makeUser('manager@test.local', 'PRODUCTION_MANAGER');
  await makeUser('supervisor@test.local', 'SHIFT_SUPERVISOR');
  await makeUser('maintenance@test.local', 'MAINTENANCE_ENGINEER');
  await makeUser('spinner@test.local', 'SPINNING_OPERATOR', { workerId: ids.workers.spinner });
  await makeUser('weaver@test.local', 'WEAVING_OPERATOR', { workerId: ids.workers.weaver });
  await makeUser('dyer@test.local', 'DYEING_OPERATOR', { workerId: ids.workers.dyer });
  await makeUser('inspector@test.local', 'QUALITY_INSPECTOR');
  await makeUser('dispatch@test.local', 'DISPATCH_MANAGER');
  await makeUser('accounts@test.local', 'ACCOUNTS_MANAGER');
  await makeUser('buyer@test.local', 'BUYER', { buyerId: buyer.id });

  [admin, ops, manager, supervisor, maintenance, spinner, weaver, dyer, inspector, dispatcher, accounts, buyerUser] = await Promise.all(
    ['admin', 'ops', 'manager', 'supervisor', 'maintenance', 'spinner', 'weaver', 'dyer', 'inspector', 'dispatch', 'accounts', 'buyer'].map((n) => signIn(`${n}@test.local`)),
  );
});

describe('signup and administrator approval', () => {
  it('never lets a visitor ask for an admin role', async () => {
    const res = await request(app).post('/api/v1/auth/signup').send({ name: 'Sneaky', email: 'sneaky@test.local', password: PASSWORD, requestedRole: 'SUPER_ADMIN' });
    expect(res.status).toBe(400);
  });

  it('keeps new users pending until an admin approves them with a role', async () => {
    await request(app).post('/api/v1/auth/signup').send({ name: 'New Weaver', email: 'new.weaver@test.local', password: PASSWORD, requestedRole: 'WEAVING_OPERATOR' }).expect(201);
    const blocked = await request(app).post('/api/v1/auth/login').send({ email: 'new.weaver@test.local', password: PASSWORD });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.message).toMatch(/waiting for administrator approval/);

    const users = await get(admin, '/rbac/users?pageSize=100');
    const pending = users.data.find((u: { email: string }) => u.email === 'new.weaver@test.local');
    expect(pending).toMatchObject({ approvalStatus: 'PENDING', requestedRole: 'WEAVING_OPERATOR', active: false });
    await post(manager, `/rbac/users/${pending.id}/approve`, { role: 'WEAVING_OPERATOR' }, 403);
    await post(admin, `/rbac/users/${pending.id}/approve`, { role: 'WEAVING_OPERATOR' });

    const newWeaver = await signIn('new.weaver@test.local');
    expect((await get(newWeaver, '/auth/me')).user.role).toBe('WEAVING_OPERATOR');
    await get(newWeaver, '/reports/finance', 403);
  });

  it('turns an approved buyer signup into a buyer company account that only sees its own orders', async () => {
    await request(app).post('/api/v1/auth/signup').send({ name: 'Meera', email: 'meera@test.local', password: PASSWORD, requestedRole: 'BUYER', company: 'Meera Fabrics', city: 'Jaipur' }).expect(201);
    const user = await db.user.findUniqueOrThrow({ where: { email: 'meera@test.local' } });
    await post(admin, `/rbac/users/${user.id}/approve`, { role: 'BUYER' });
    const meera = await signIn('meera@test.local');
    expect((await get(meera, '/orders')).data).toHaveLength(0);
    await get(meera, '/production', 403);
    await get(meera, '/inventory', 403);
    await get(meera, '/machines', 403);
  });
});

describe('buyer ordering with fixed prices', () => {
  it('uses the material price from the database, whatever the client sends', async () => {
    const order = await post(buyerUser, '/orders', {
      buyerId: ids.otherBuyer, // ignored: buyers can only order for themselves
      deadline: nextWeek(),
      items: [{ recipeId: ids.recipe, color: 'Red', quantity: 100, price: 0 }],
    });
    const saved = await db.salesOrder.findUniqueOrThrow({ where: { id: order.id }, include: { items: true } });
    expect(saved.buyerId).toBe(ids.buyer);
    expect(saved.status).toBe('PENDING_REVIEW');
    expect(saved.items[0].price.toNumber()).toBe(200);
    expect(saved.items[0].fabric).toBe('Test poplin');
  });

  it('rejects zero quantities and delivery dates that are not in the future', async () => {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
    await post(buyerUser, '/orders', { buyerId: ids.buyer, deadline: nextWeek(), items: [{ recipeId: ids.recipe, color: 'Red', quantity: 0 }] }, 400);
    await post(buyerUser, '/orders', { buyerId: ids.buyer, deadline: today, items: [{ recipeId: ids.recipe, color: 'Red', quantity: 10 }] }, 400);
    await post(buyerUser, '/orders', { buyerId: ids.buyer, deadline: '2020-01-01', items: [{ recipeId: ids.recipe, color: 'Red', quantity: 10 }] }, 400);
  });

  it('lets only administrators change prices, and old orders keep their price', async () => {
    const before = await newOrder(10);
    await post(manager, `/recipes/${ids.recipe}/price`, { pricePerMetre: 250 }, 403);
    await post(buyerUser, `/recipes/${ids.recipe}/price`, { pricePerMetre: 1 }, 403);
    await post(admin, `/recipes/${ids.recipe}/price`, { pricePerMetre: 250 });
    const after = await newOrder(10);
    const [a, b] = await Promise.all([
      db.salesOrderItem.findFirstOrThrow({ where: { orderId: before.id } }),
      db.salesOrderItem.findFirstOrThrow({ where: { orderId: after.id } }),
    ]);
    expect(a.price.toNumber()).toBe(200);
    expect(b.price.toNumber()).toBe(250);
    await post(admin, `/recipes/${ids.recipe}/price`, { pricePerMetre: 200 });
  });
});

describe('production start checks', () => {
  it('refuses to start without a machine and operator, and starts only when everything is in place', async () => {
    const order = await newOrder(300);
    const batch = await batchOfOrder(order.id);
    const job = await jobFor(batch.id, 'SPINNING');

    const noAssign = await spinner.post(`/api/v1/production/jobs/${job.id}/start`).set('X-CSRF-Token', spinner.csrf).send({});
    expect(noAssign.status).toBe(409);
    expect(noAssign.body.error.message).toMatch(/select an available machine and operator/);

    // Only the production manager assigns: not operators, not the shift supervisor.
    await post(spinner, `/production/jobs/${job.id}/assign`, { machineId: ids.machines['SP-1'], workerId: ids.workers.spinner }, 403);
    await post(supervisor, `/production/jobs/${job.id}/assign`, { machineId: ids.machines['SP-1'], workerId: ids.workers.spinner }, 403);
    // Wrong machine type, wrong department, broken machine.
    await post(manager, `/production/jobs/${job.id}/assign`, { machineId: ids.machines['WV-1'], workerId: ids.workers.spinner }, 409);
    await post(manager, `/production/jobs/${job.id}/assign`, { machineId: ids.machines['SP-1'], workerId: ids.workers.weaver }, 409); // weaver is not in the spinning department
    await post(supervisor, `/machines/${ids.machines['SP-2']}/breakdown`, { reason: 'Test fault' });
    await post(manager, `/production/jobs/${job.id}/assign`, { machineId: ids.machines['SP-2'], workerId: ids.workers.spinner }, 409);
    await post(supervisor, `/machines/${ids.machines['SP-2']}/recover`, { reason: 'Fixed' }, 403); // only maintenance confirms repairs
    await post(maintenance, `/machines/${ids.machines['SP-2']}/recover`, { reason: 'Fixed' });

    // Assigned but the operator is not checked in: assigning works, starting does not.
    await db.attendance.updateMany({ where: { workerId: ids.workers.spinner, checkOutAt: null }, data: { checkOutAt: new Date() } });
    const assigned = await post(manager, `/production/jobs/${job.id}/assign`, { machineId: ids.machines['SP-1'], workerId: ids.workers.spinner });
    expect(assigned.status).toBe('ASSIGNED');
    expect((await db.machine.findUniqueOrThrow({ where: { id: ids.machines['SP-1'] } })).status).toBe('IDLE'); // nothing started
    const notIn = await spinner.post(`/api/v1/production/jobs/${job.id}/start`).set('X-CSRF-Token', spinner.csrf).send({});
    expect(notIn.status).toBe(409);
    expect(notIn.body.error.message).toMatch(/not checked in/);

    // A check-in from a shift that ended long ago does not count either.
    await db.attendance.deleteMany({ where: { workerId: ids.workers.spinner } });
    const shift = await db.shift.findFirstOrThrow();
    await db.attendance.create({ data: { workerId: ids.workers.spinner, shiftId: shift.id, date: new Date(Date.now() - 3 * 86400000), hours: 0, status: 'PRESENT', checkInAt: new Date(Date.now() - 3 * 86400000) } });
    const stale = await spinner.post(`/api/v1/production/jobs/${job.id}/start`).set('X-CSRF-Token', spinner.csrf).send({});
    expect(stale.status).toBe(409);
    expect(stale.body.error.message).toMatch(/shift has ended/);

    // The supervisor checks the spinner in → start succeeds, machine runs, run history exists.
    await db.attendance.deleteMany({ where: { workerId: ids.workers.spinner } });
    await checkIn(ids.workers.spinner);
    await post(supervisor, `/production/jobs/${job.id}/start`, {}, 403); // supervisors never start production
    await post(weaver, `/production/jobs/${job.id}/start`, {}, 403); // another team's stage
    await post(spinner, `/production/jobs/${job.id}/start`);
    const started = await db.jobCard.findUniqueOrThrow({ where: { id: job.id }, include: { machineRuns: true, shift: true } });
    expect(started.status).toBe('IN_PROGRESS');
    expect(started.shift).not.toBeNull();
    expect(started.machineRuns).toHaveLength(1);
    expect((await db.machine.findUniqueOrThrow({ where: { id: ids.machines['SP-1'] } })).status).toBe('RUNNING');
    await post(spinner, `/production/jobs/${job.id}/start`, {}, 409); // already running

    // The same operator cannot run two jobs at once, and a running job is never re-planned underneath them.
    const other = await batchOfOrder((await newOrder(50)).id);
    const otherJob = await jobFor(other.id, 'SPINNING');
    await post(manager, `/production/jobs/${otherJob.id}/assign`, { machineId: ids.machines['SP-2'], workerId: ids.workers.spinner }, 409);
    await post(manager, `/production/jobs/${job.id}/assign`, { machineId: ids.machines['SP-2'], workerId: ids.workers.spinner }, 409);

    // Finishing needs real output; a short run reduces the next stage's target and is written down.
    await post(spinner, `/production/jobs/${job.id}/complete`, { quantity: 0 }, 409);
    await post(spinner, `/production/jobs/${job.id}/complete`, { quantity: 250, hours: 3 });
    expect((await db.machine.findUniqueOrThrow({ where: { id: ids.machines['SP-1'] } })).status).toBe('IDLE');
    const weaving = await jobFor(batch.id, 'WEAVING');
    expect(weaving.status).toBe('READY');
    expect(weaving.target.toNumber()).toBe(250);
    expect(await db.auditLog.count({ where: { entityId: batch.id, detail: { contains: '50 m short' } } })).toBe(1);
    await post(manager, `/production/batches/${other.id}/cancel`, { reason: 'test cleanup' });
  });
});

describe('shift handover', () => {
  it('pauses a running job when its operator checks out, and lets the supervisor hand it to the next operator', async () => {
    const order = await newOrder(100);
    const batch = await batchOfOrder(order.id);
    const job = await jobFor(batch.id, 'SPINNING');
    await checkIn(ids.workers.spinner);
    await post(manager, `/production/jobs/${job.id}/assign`, { machineId: ids.machines['SP-1'], workerId: ids.workers.spinner });
    await post(spinner, `/production/jobs/${job.id}/start`);

    // Handover to someone who is not checked in is refused; operators cannot hand over at all.
    await post(spinner, `/production/jobs/${job.id}/handover`, { workerId: ids.workers.flexible }, 403);
    await db.attendance.updateMany({ where: { workerId: ids.workers.flexible, checkOutAt: null }, data: { checkOutAt: new Date() } });
    await post(supervisor, `/production/jobs/${job.id}/handover`, { workerId: ids.workers.flexible }, 409);
    await db.attendance.deleteMany({ where: { workerId: ids.workers.flexible } });
    await checkIn(ids.workers.flexible);
    await post(supervisor, `/production/jobs/${job.id}/handover`, { workerId: ids.workers.flexible, reason: 'Evening shift' });
    let state = await db.jobCard.findUniqueOrThrow({ where: { id: job.id }, include: { machineRuns: { orderBy: { startedAt: 'asc' } } } });
    expect(state).toMatchObject({ status: 'IN_PROGRESS', workerId: ids.workers.flexible, machineId: ids.machines['SP-1'] });
    expect(state.machineRuns).toHaveLength(2);
    expect(state.machineRuns[0].endedAt).not.toBeNull();
    expect(state.machineRuns[1]).toMatchObject({ workerId: ids.workers.flexible, reason: 'Shift handover', endedAt: null });

    // The new operator checks out without a handover: the job pauses and the machine is freed.
    const open = await db.attendance.findFirstOrThrow({ where: { workerId: ids.workers.flexible, checkOutAt: null } });
    await post(supervisor, `/attendance/${open.id}/check-out`);
    state = await db.jobCard.findUniqueOrThrow({ where: { id: job.id }, include: { machineRuns: { orderBy: { startedAt: 'asc' } } } });
    expect(state.status).toBe('PAUSED');
    expect((await db.machine.findUniqueOrThrow({ where: { id: ids.machines['SP-1'] } })).status).toBe('IDLE');
    expect(state.machineRuns.every((r) => r.endedAt)).toBe(true);
    expect(await db.auditLog.count({ where: { entityId: batch.id, detail: { contains: 'checked out' } } })).toBe(1);

    // The manager moves the paused job back to the spinner, who starts again.
    await post(manager, `/production/jobs/${job.id}/assign`, { machineId: ids.machines['SP-1'], workerId: ids.workers.spinner, reason: 'Back on shift' });
    await post(spinner, `/production/jobs/${job.id}/start`);
    await finishStage(spinner, job.id);
    await post(manager, `/production/batches/${batch.id}/cancel`, { reason: 'test cleanup' });
  });
});

describe('customer order production', () => {
  it('runs an order through every stage and reaches ready-to-ship, releasing the yarn', async () => {
    const lotBefore = await db.yarnLot.findUniqueOrThrow({ where: { id: ids.lot } });
    const order = await newOrder(400);
    const batch = await batchOfOrder(order.id);
    await runStage(batch.id, 'SPINNING');

    // A weaver cannot touch the dyeing stage; the weaving team was notified.
    const dyeJob = await jobFor(batch.id, 'DYEING');
    await post(weaver, `/production/jobs/${dyeJob.id}/assign`, { machineId: ids.machines['DY-1'], workerId: ids.workers.weaver }, 403);
    const feed = await get(weaver, '/notifications/feed');
    expect(feed.items.some((n: { title: string }) => n.title === `${batch.number} is ready for weaving`)).toBe(true);

    await runStage(batch.id, 'WEAVING');
    await runStage(batch.id, 'DYEING');

    const rolls = await db.fabricRoll.findMany({ where: { productionId: batch.id } });
    expect(rolls.length).toBe(2);
    for (const roll of rolls) await post(inspector, `/rolls/${roll.id}/inspections`, { result: 'PASSED', defects: [], notes: '' });
    expect((await db.salesOrder.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('READY');

    // Yarn: 400 m × 0.2 kg consumed, nothing left reserved.
    const lotAfter = await db.yarnLot.findUniqueOrThrow({ where: { id: ids.lot } });
    expect(lotAfter.reserved.toNumber()).toBe(0);
    expect(lotBefore.onHand.minus(lotAfter.onHand).toNumber()).toBeCloseTo(80, 1);
  });
});

describe('inventory safety', () => {
  it('never over-reserves when two people reserve the same lot at once', async () => {
    const supplier = await db.supplier.findFirstOrThrow();
    const small = await db.yarnLot.create({ data: { code: 'YL-SMALL', material: 'Cotton yarn', color: 'Raw', specification: '40s', supplierId: supplier.id, location: 'Store', onHand: 50, costPerKg: 250, threshold: 1 } });
    const a = await batchOfOrder((await newOrder(150)).id); // needs 30 kg
    const b = await batchOfOrder((await newOrder(150)).id); // needs 30 kg
    const results = await Promise.all([
      admin.post('/api/v1/inventory/reservations').set('X-CSRF-Token', admin.csrf).send({ lotId: small.id, productionId: a.id, quantity: 30 }),
      admin.post('/api/v1/inventory/reservations').set('X-CSRF-Token', admin.csrf).send({ lotId: small.id, productionId: b.id, quantity: 30 }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await db.yarnLot.findUniqueOrThrow({ where: { id: small.id } })).reserved.toNumber()).toBe(30);

    // Cancelling the batch gives the yarn back; stock can never go below what is reserved.
    const winner = results[0].status === 200 ? a : b;
    await post(manager, `/inventory/${small.id}/adjust`, { quantity: 40, reason: 'Damaged', kind: 'DAMAGED' }, 403); // view-only role
    await post(admin, `/inventory/${small.id}/adjust`, { quantity: 40, reason: 'Damaged', kind: 'DAMAGED' }, 409);
    await post(manager, `/production/batches/${winner.id}/cancel`, { reason: 'test' });
    expect((await db.yarnLot.findUniqueOrThrow({ where: { id: small.id } })).reserved.toNumber()).toBe(0);
    await post(admin, `/inventory/${small.id}/adjust`, { quantity: 40, reason: 'Damaged in store', kind: 'DAMAGED' });
    expect((await db.yarnLot.findUniqueOrThrow({ where: { id: small.id } })).onHand.toNumber()).toBe(10);
    await post(manager, `/production/batches/${(winner === a ? b : a).id}/cancel`, { reason: 'test' });
  });

  it('shows stock by material with consumed quantities', async () => {
    const materials = await get(manager, '/inventory/materials');
    const cotton = materials.find((m: { material: string; specification: string }) => m.material === 'Cotton yarn' && m.specification === '40s');
    expect(Number(cotton.consumed)).toBeGreaterThan(0);
    expect(Number(cotton.available)).toBe(Number(cotton.onHand) - Number(cotton.reserved));
  });
});

describe('machine breakdown and reassignment', () => {
  it('blocks the job, lets a manager move it, restarts it, and records the repair', async () => {
    const order = await newOrder(200);
    const batch = await batchOfOrder(order.id);
    const job = await jobFor(batch.id, 'SPINNING');
    await checkIn(ids.workers.spinner);
    await post(manager, `/production/jobs/${job.id}/assign`, { machineId: ids.machines['SP-1'], workerId: ids.workers.spinner });
    await post(spinner, `/production/jobs/${job.id}/start`);
    await post(spinner, `/production/jobs/${job.id}/output`, { quantity: 50, hours: 1, waste: 0, consumedKg: 10, rollLengths: [] });

    await post(spinner, `/machines/${ids.machines['SP-1']}/breakdown`, { reason: 'Spindle bearing seized' });
    expect((await db.jobCard.findUniqueOrThrow({ where: { id: job.id } })).status).toBe('BLOCKED');
    const issue = await db.productionIssue.findFirstOrThrow({ where: { productionId: batch.id } });
    expect(issue.type).toBe('MACHINE_BREAKDOWN');

    // Reassignment does not start anything by itself.
    await post(manager, `/production/jobs/${job.id}/assign`, { machineId: ids.machines['SP-1'], workerId: ids.workers.spinner, reason: 'retry' }, 409); // still broken
    await post(manager, `/production/jobs/${job.id}/assign`, { machineId: ids.machines['SP-2'], workerId: ids.workers.spinner, reason: 'Breakdown' });
    let state = await db.jobCard.findUniqueOrThrow({ where: { id: job.id } });
    expect(state).toMatchObject({ status: 'BLOCKED', machineId: ids.machines['SP-2'] });
    expect(state.output.toNumber()).toBe(50); // completed output is kept

    await post(spinner, `/production/jobs/${job.id}/start`);
    state = await db.jobCard.findUniqueOrThrow({ where: { id: job.id }, include: { machineRuns: true } } as never);
    expect(state.status).toBe('IN_PROGRESS');
    expect((await db.machineAssignment.count({ where: { jobId: job.id } }))).toBe(2);

    await post(spinner, `/production/issues/${issue.id}/resolve`, { resolution: 'x' }, 403); // closing problems is a manager decision
    await post(manager, `/production/issues/${issue.id}/resolve`, { resolution: 'Moved to SP-2' });
    await post(maintenance, `/machines/${ids.machines['SP-1']}/recover`, { reason: 'Bearing replaced' });
    const history = await get(manager, `/machines/${ids.machines['SP-1']}/history`);
    expect(history.downtime[0]).toMatchObject({ kind: 'BREAKDOWN', resolution: 'Bearing replaced' });
    expect(history.downtime[0].endedAt).not.toBeNull();
    expect((await db.machine.findUniqueOrThrow({ where: { id: ids.machines['SP-1'] } })).status).toBe('IDLE');

    await finishStage(spinner, job.id);
    await post(manager, `/production/batches/${batch.id}/cancel`, { reason: 'test cleanup' });
  });

  it('adds, edits and deactivates machines without deleting history', async () => {
    await post(manager, '/machines', { code: 'NEW-1', name: 'New loom', type: 'WEAVING', location: 'Bay 9', capacityPerHour: 90, hourlyCost: 100 }, 403);
    await post(supervisor, '/machines', { code: 'NEW-1', name: 'New loom', type: 'WEAVING', location: 'Bay 9', capacityPerHour: 90, hourlyCost: 100 }, 403);
    const created = await post(maintenance, '/machines', { code: 'NEW-1', name: 'New loom', type: 'WEAVING', location: 'Bay 9', capacityPerHour: 90, hourlyCost: 100 });
    await post(maintenance, `/machines/${created.id}/update`, { name: 'New air-jet loom' });
    await post(maintenance, `/machines/${created.id}/deactivate`, { reason: 'Sold' });
    const machine = await db.machine.findUniqueOrThrow({ where: { id: created.id } });
    expect(machine).toMatchObject({ active: false, name: 'New air-jet loom' });
    const lookups = await get(manager, '/lookups');
    expect(lookups.machines.some((m: { id: string }) => m.id === created.id)).toBe(false);
    const order = await newOrder(10);
    const job = await jobFor((await batchOfOrder(order.id)).id, 'WEAVING');
    await post(manager, `/production/jobs/${job.id}/assign`, { machineId: created.id, workerId: ids.workers.weaver }, 409);
    await post(admin, `/machines/${created.id}/activate`, { reason: 'Back' });
    expect((await db.machine.findUniqueOrThrow({ where: { id: created.id } })).status).toBe('IDLE');
  });
});

describe('shift attendance', () => {
  it('only the shift supervisor checks workers in and out, once per shift, with corrections audited', async () => {
    const board = await get(supervisor, '/shifts/board');
    expect(board.current).not.toBeNull();
    const flexible = ids.workers.flexible;
    await post(manager, '/attendance/check-in', { workerId: flexible, shiftId: board.current.id }, 403);
    await post(spinner, '/attendance/check-in', { workerId: flexible, shiftId: board.current.id }, 403);

    const completed = board.shifts.find((s: { state: string }) => s.state === 'COMPLETED');
    if (completed) {
      const res = await supervisor.post('/api/v1/attendance/check-in').set('X-CSRF-Token', supervisor.csrf).send({ workerId: flexible, shiftId: completed.id });
      expect(res.status).toBe(409);
    }

    const att = await post(supervisor, '/attendance/check-in', { workerId: flexible, shiftId: board.current.id });
    await post(supervisor, '/attendance/check-in', { workerId: flexible, shiftId: board.current.id }, 409); // already in
    expect((await get(supervisor, '/shifts/board')).checkedIn.some((c: { worker: { id: string } }) => c.worker.id === flexible)).toBe(true);

    await post(supervisor, `/attendance/${att.id}/overtime`, { extraHours: 2, reason: 'Urgent order' });
    await post(supervisor, `/attendance/${att.id}/check-out`);
    await post(supervisor, `/attendance/${att.id}/check-out`, {}, 409); // already out
    const record = await db.attendance.findUniqueOrThrow({ where: { id: att.id }, include: { wage: true } });
    expect(record.checkOutAt).not.toBeNull();
    expect(record.overtimeHours.toNumber()).toBe(2);
    expect(record.wage).not.toBeNull();

    await post(supervisor, `/attendance/${att.id}/correct`, { hours: 8, status: 'PRESENT', reason: 'Forgot to check out on time' });
    expect((await db.attendance.findUniqueOrThrow({ where: { id: att.id } })).hours.toNumber()).toBe(8);
    expect(await db.auditLog.count({ where: { action: 'attendance.corrected', entityId: flexible } })).toBe(1);
  });
});

describe('quality, rework, dispatch and accounts', () => {
  it('fails a roll back to weaving, reinspects it, ships, delivers, invoices and settles with payments and a claim', async () => {
    const order = await newOrder(200);
    const batch = await batchOfOrder(order.id);
    await runStage(batch.id, 'SPINNING');
    await runStage(batch.id, 'WEAVING');
    await runStage(batch.id, 'DYEING');

    const [roll] = await db.fabricRoll.findMany({ where: { productionId: batch.id } });
    await post(inspector, `/rolls/${roll.id}/inspections`, { result: 'REWORK', defects: ['Broken picks'], notes: '' });
    // Failed rolls cannot be shipped.
    await post(dispatcher, '/shipments', { orderId: order.id, rollIds: [roll.id], transport: 'MH-12 AB 1234' }, 409);

    await post(inspector, `/production/batches/${batch.id}/rework`, { defectType: 'WEAVING_DEFECT', reason: 'Broken picks', returnStage: 'WEAVING', rollIds: [roll.id] });
    const jobs = await db.jobCard.findMany({ where: { productionId: batch.id }, orderBy: { sequence: 'asc' } });
    expect(jobs.map((j) => j.status)).toEqual(['COMPLETED', 'READY', 'PLANNED']);
    await runStage(batch.id, 'WEAVING');
    await runStage(batch.id, 'DYEING');
    expect(await db.fabricRoll.count({ where: { productionId: batch.id } })).toBe(1);
    expect((await db.reworkJob.findFirstOrThrow({ where: { productionId: batch.id, returnStage: 'WEAVING' } })).status).toBe('COMPLETED');
    await post(inspector, `/rolls/${roll.id}/inspections`, { result: 'PASSED', defects: [], notes: '' });

    // Dispatch: ready → on the road → delivered. Only the right transitions are allowed.
    const shipment = await post(dispatcher, '/shipments', { orderId: order.id, rollIds: [roll.id], transport: 'MH-12 AB 1234', expectedAt: nextWeek() });
    await post(dispatcher, `/shipments/${shipment.id}/deliver`, {}, 409);
    await post(dispatcher, `/shipments/${shipment.id}/confirm`, {}, 409); // label not verified
    await post(dispatcher, `/shipments/${shipment.id}/verify`, { code: roll.code });
    const invoice = await post(dispatcher, `/shipments/${shipment.id}/confirm`);
    expect(Number(invoice.total)).toBe(200 * 200);
    expect((await get(dispatcher, '/shipments?status=DISPATCHED')).data.some((s: { id: string }) => s.id === shipment.id)).toBe(true);
    await post(dispatcher, `/shipments/${shipment.id}/deliver`, { receivedBy: 'Gate 2' });
    expect((await db.shipment.findUniqueOrThrow({ where: { id: shipment.id } })).status).toBe('DELIVERED');
    expect((await get(buyerUser, '/shipments')).data.some((s: { id: string; status: string }) => s.id === shipment.id && s.status === 'DELIVERED')).toBe(true);

    // Accounts: partial payments, duplicate reference rejected, claim credits the invoice.
    await post(dispatcher, `/invoices/${invoice.id}/payments`, { amount: 10000, reference: 'UTR-1' }, 403);
    await post(accounts, `/invoices/${invoice.id}/payments`, { amount: 10000, reference: 'UTR-1' });
    await post(accounts, `/invoices/${invoice.id}/payments`, { amount: 5000, reference: 'UTR-1' }, 409);
    await post(accounts, `/invoices/${invoice.id}/payments`, { amount: 50000, reference: 'UTR-2' }, 409); // more than owed
    const claim = await post(accounts, '/claims', { party: 'BUYER', buyerId: ids.buyer, invoiceId: invoice.id, amount: 4000, reason: 'Short by 20 m' });
    await post(accounts, `/claims/${claim.id}/decide`, { decision: 'APPROVED', note: 'Verified' });
    const report = await get(accounts, '/reports/finance');
    const inv = report.invoices.find((i: { id: string }) => i.id === invoice.id);
    expect(Number(inv.outstanding)).toBe(40000 - 10000 - 4000);
    await post(accounts, `/invoices/${invoice.id}/payments`, { amount: 26000, reference: 'UTR-3' });
    expect((await db.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).status).toBe('PAID');
    expect((await db.salesOrder.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('COMPLETED');
  });
});

describe('bills, money this month, shifts and users', () => {
  it('lets accounts enter a bill once, pay it, and shows it in this month\'s result', async () => {
    const supplier = await db.supplier.findFirstOrThrow();
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
    const body = { supplierId: supplier.id, number: 'PWR-OCT', category: 'POWER', description: 'Electricity', amount: 50000, billDate: today };
    await post(dispatcher, '/bills', body, 403);
    const bill = await post(accounts, '/bills', body);
    await post(accounts, '/bills', body, 409); // same bill number twice
    await post(accounts, '/bills', { ...body, number: 'FUTURE', billDate: '2999-01-01' }, 400);
    await post(accounts, `/bills/${bill.id}/payments`, { amount: 60000, reference: 'NEFT-PWR-1' }, 409); // more than owed
    await post(accounts, `/bills/${bill.id}/payments`, { amount: 20000, reference: 'NEFT-PWR-1' });
    await post(accounts, `/bills/${bill.id}/payments`, { amount: 1000, reference: 'NEFT-PWR-1' }, 409); // duplicate reference
    const report = await get(accounts, '/reports/finance');
    const row = report.bills.find((b: { id: string }) => b.id === bill.id);
    expect(Number(row.outstanding)).toBe(30000);
    expect(report.pnl.otherBills).toBeGreaterThanOrEqual(50000);
    expect(report.trend).toHaveLength(6);
    expect(report.pnl.profit).toBeCloseTo(report.pnl.sales - report.pnl.spend, 2);
    const month = await get(accounts, `/reports/finance?month=${today.slice(0, 7)}`);
    expect(month.bills.some((b: { id: string }) => b.id === bill.id)).toBe(true);
  });

  it('receives yarn for a specific order and refuses yarn the order does not use', async () => {
    const supplier = await db.supplier.findFirstOrThrow();
    const order = await newOrder(100);
    const base = { supplierId: supplier.id, color: 'Raw', quantity: 50, costPerKg: 250, location: 'Store', threshold: 10, orderId: order.id };
    await post(admin, '/inventory/receipts', { ...base, reference: 'GRN-WRONG', material: 'Polyester', specification: '150D' }, 409);
    const lot = await post(admin, '/inventory/receipts', { ...base, reference: 'GRN-FOR-ORDER', material: 'Cotton yarn', specification: '40s' });
    expect(lot.orderId).toBe(order.id);
    await post(admin, '/inventory/receipts', { ...base, reference: 'GRN-FOR-ORDER', material: 'Cotton yarn', specification: '40s' }, 409); // same challan twice
    const bill = await db.supplierBill.findFirstOrThrow({ where: { receipt: { lotId: lot.id } } });
    expect(bill).toMatchObject({ category: 'YARN', number: 'GRN-FOR-ORDER', supplierId: supplier.id });
    const orders = await get(ops, '/orders?pageSize=100');
    expect(orders.data.find((o: { id: string }) => o.id === order.id).yarn.status).toBe('ENOUGH');
    // Starting that order's spinning uses the yarn bought for it first.
    const batch = await batchOfOrder(order.id);
    const job = await jobFor(batch.id, 'SPINNING');
    await checkIn(ids.workers.spinner);
    await post(manager, `/production/jobs/${job.id}/assign`, { machineId: (await freeMachine('SPINNING')).id, workerId: ids.workers.spinner });
    await post(spinner, `/production/jobs/${job.id}/start`);
    const reservations = await db.stockReservation.findMany({ where: { productionId: batch.id }, orderBy: { createdAt: 'asc' } });
    expect(reservations[0].lotId).toBe(lot.id);
    await finishStage(spinner, job.id); // consumes across both lots without failing
    await post(manager, `/production/batches/${batch.id}/cancel`, { reason: 'test cleanup' });
  });

  it('reports what happened in each shift and lets only admins change shifts', async () => {
    const report = await get(manager, '/shifts/report');
    expect(report.shifts.length).toBeGreaterThanOrEqual(3);
    expect(report.week).toHaveLength(7);
    await get(spinner, '/shifts/report', 403);
    await post(supervisor, '/shifts', { name: 'General', startHour: 9, hours: 8 }, 403);
    const shift = await post(admin, '/shifts', { name: 'General', startHour: 9, hours: 8 });
    await post(admin, '/shifts', { name: 'general', startHour: 10, hours: 8 }, 409);
    await post(admin, `/shifts/${shift.id}/update`, { active: false });
    expect((await get(supervisor, '/shifts/board')).shifts.some((x: { id: string }) => x.id === shift.id)).toBe(false);
  });

  it('pays all unpaid wages up to a date in one wage run', async () => {
    const before = await db.wageEntry.count({ where: { paidAt: null } });
    expect(before).toBeGreaterThan(0);
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
    const run = await post(accounts, '/wages/pay-all', { upTo: today });
    expect(run.count).toBe(before);
    await post(accounts, '/wages/pay-all', { upTo: today }, 409);
  });

  it('lets the admin create working logins: an operator with a new worker record and a buyer', async () => {
    await post(admin, '/rbac/users', { name: 'Ravi Kumar', email: 'ravi@test.local', password: PASSWORD, role: 'WEAVING_OPERATOR', departmentId: ids.depts.WEAVING }, 400); // no worker
    const created = await admin.post('/api/v1/rbac/users').set('X-CSRF-Token', admin.csrf).send({ name: 'Ravi Kumar', email: 'ravi@test.local', password: PASSWORD, role: 'WEAVING_OPERATOR', departmentId: ids.depts.WEAVING, workerId: 'NEW' });
    expect(created.status, created.text).toBe(201);
    const user = await db.user.findUniqueOrThrow({ where: { email: 'ravi@test.local' }, include: { worker: true } });
    expect(user.worker).toMatchObject({ name: 'Ravi Kumar', departmentId: ids.depts.WEAVING });
    const ravi = await signIn('ravi@test.local');
    expect((await get(ravi, '/production')).data.every((j: { stage: string }) => j.stage === 'WEAVING')).toBe(true);
    const buyer = await admin.post('/api/v1/rbac/users').set('X-CSRF-Token', admin.csrf).send({ name: 'New Fabrics Ltd', email: 'newfab@test.local', password: PASSWORD, role: 'BUYER', buyerId: 'NEW' });
    expect(buyer.status, buyer.text).toBe(201);
    const login = await signIn('newfab@test.local');
    expect((await get(login, '/orders')).data).toHaveLength(0);
    await manager.post('/api/v1/rbac/users').set('X-CSRF-Token', manager.csrf).send({ name: 'x', email: 'x@test.local', password: PASSWORD, role: 'BUYER' }).expect(403);
  });
});

describe('standalone production and access control', () => {
  it('makes stock without an order and ships it against a later order', async () => {
    await post(spinner, '/production/batches', { recipeId: ids.recipe, color: 'Ecru', quantity: 200, purpose: 'STOCK' }, 403);
    const batch = await post(manager, '/production/batches', { recipeId: ids.recipe, color: 'Ecru', quantity: 200, purpose: 'STOCK' });
    expect(batch).toMatchObject({ purpose: 'STOCK', orderId: null });
    await runStage(batch.id, 'SPINNING');
    await runStage(batch.id, 'WEAVING');
    await runStage(batch.id, 'DYEING');
    const [roll] = await db.fabricRoll.findMany({ where: { productionId: batch.id } });
    await post(inspector, `/rolls/${roll.id}/inspections`, { result: 'PASSED', defects: [], notes: '' });
    expect((await get(manager, '/rolls?source=STOCK&quality=PASSED')).data.map((r: { id: string }) => r.id)).toContain(roll.id);
    const order = await newOrder(200);
    const shipment = await post(dispatcher, '/shipments', { orderId: order.id, rollIds: [roll.id], transport: 'MH-12 AB 1234' });
    await post(dispatcher, `/shipments/${shipment.id}/verify`, { code: roll.code });
    expect(Number((await post(dispatcher, `/shipments/${shipment.id}/confirm`)).total)).toBe(200 * 200);
  });

  it('keeps every role inside its own area', async () => {
    await get(spinner, '/rbac/users', 403);
    await get(spinner, '/reports/finance', 403);
    await get(spinner, '/workers', 403);
    await get(inspector, '/reports/finance', 403);
    await get(dispatcher, '/inventory', 403);
    await get(buyerUser, '/workers', 403);
    await get(buyerUser, '/reports/finance', 403);
    await get(buyerUser, '/rbac/users', 403);
    await post(inspector, '/production/batches', { recipeId: ids.recipe, color: 'x', quantity: 1, purpose: 'STOCK' }, 403);
    await post(supervisor, '/production/batches', { recipeId: ids.recipe, color: 'x', quantity: 1, purpose: 'STOCK' }, 403);
    await post(accounts, `/machines/${ids.machines['SP-1']}/breakdown`, { reason: 'x' }, 403);
    await post(maintenance, `/machines/${ids.machines['SP-1']}/maintenance`, { reason: 'Oil change' });
    await post(supervisor, `/machines/${ids.machines['SP-1']}/recover`, { reason: 'x' }, 403);
    await post(maintenance, `/machines/${ids.machines['SP-1']}/recover`, { reason: 'Serviced' });
    await get(maintenance, '/orders', 403);
    await get(supervisor, '/orders', 403);
    await get(supervisor, '/workers'); // supervisor sees the workforce
    await get(manager, '/workers'); // manager may view, not check in (tested above)
  });

  it('filters and analytics work on real records', async () => {
    const forBuyer = (await get(manager, `/production/batches?buyerId=${ids.buyer}&pageSize=100`)).data;
    expect(forBuyer.length).toBeGreaterThan(0);
    expect((await get(manager, `/production/batches?buyerId=${ids.otherBuyer}`)).data).toHaveLength(0);
    const onWorker = (await get(manager, `/production/batches?workerId=${ids.workers.weaver}&pageSize=100`)).data;
    expect(onWorker.length).toBeGreaterThan(0);
    const a = await get(manager, '/analytics');
    expect(a.quality.passed).toBeGreaterThan(0);
    expect(a.rework.byType.map((r: { type: string }) => r.type)).toContain('WEAVING_DEFECT');
    const dash = await get(supervisor, '/dashboard');
    expect(dash.shift.current).not.toBeNull();
    const feed = await get(weaver, '/notifications/feed');
    expect(feed.unread).toBeGreaterThan(0);
    await post(weaver, '/notifications/read-all');
    expect((await get(weaver, '/notifications/feed')).unread).toBe(0);
  });
});
