import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { db } from '@loomos/db';
import { app } from '../src/app.js';

// End-to-end API tests for the main factory workflows. Each test talks to the real
// HTTP API exactly as the browser does: sign in, send the CSRF token, read the result.

const PASSWORD = 'TestPassword2026!';
type Agent = ReturnType<typeof request.agent> & { csrf: string };

const ids = {
  buyer: '',
  otherBuyer: '',
  recipe: '',
  lot: '',
  machines: {} as Record<string, string>,
  workers: [] as string[],
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

// Jobs a given user can see for one batch, in stage order.
async function jobsOf(agent: Agent, batchNumber: string) {
  const list = await get(agent, '/production?pageSize=100');
  return (list.data as { id: string; stage: string; status: string; production: { number: string } }[])
    .filter((j) => j.production.number === batchNumber);
}

async function batchOfOrder(orderId: string) {
  return db.productionOrder.findFirstOrThrow({ where: { orderId }, orderBy: { createdAt: 'asc' } });
}

// Runs one stage: the right operator accepts it, then finishes it.
async function runStage(agent: Agent, batchNumber: string, stage: string) {
  const job = (await jobsOf(agent, batchNumber)).find((j) => j.stage === stage);
  expect(job, `${stage} job for ${batchNumber}`).toBeTruthy();
  await post(agent, `/production/jobs/${job!.id}/advance`); // accept & start
  await post(agent, `/production/jobs/${job!.id}/advance`); // finish & hand over
}

let admin: Agent, manager: Agent, spinner: Agent, weaver: Agent, dyer: Agent, inspector: Agent, dispatcher: Agent;

async function newOrder(quantity = 400) {
  const deadline = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);
  return post(manager, '/orders', {
    buyerId: ids.buyer,
    deadline,
    priority: 'NORMAL',
    instructions: '',
    items: [{ recipeId: ids.recipe, fabric: 'Test poplin', color: 'Blue', quantity, price: 200 }],
  });
}

beforeAll(async () => {
  const factory = await db.factory.create({ data: { code: 'T-01', name: 'Test mill', location: 'Test' } });
  const buyer = await db.buyer.create({ data: { name: 'Test Buyer', email: 'b@test.local', city: 'Pune', initials: 'TB' } });
  const otherBuyer = await db.buyer.create({ data: { name: 'Other Buyer', email: 'o@test.local', city: 'Surat', initials: 'OB' } });
  const supplier = await db.supplier.create({ data: { name: 'Yarn Co', email: 's@test.local', city: 'Ludhiana' } });
  const recipe = await db.recipe.create({
    data: { name: 'Test poplin', material: 'Cotton yarn', specification: '40s', kgPerMetre: 0.2, wastePercent: 0, route: ['SPINNING', 'WEAVING', 'DYEING'], overheadPerMetre: 5 },
  });
  const lot = await db.yarnLot.create({
    data: { code: 'YL-TEST', material: 'Cotton yarn', color: 'Raw', specification: '40s', supplierId: supplier.id, location: 'Store', onHand: 100000, costPerKg: 250, threshold: 10 },
  });
  await db.shift.create({ data: { name: 'Morning', startHour: 6, hours: 8 } });
  for (const [code, type] of [['SP-1', 'SPINNING'], ['SP-2', 'SPINNING'], ['WV-1', 'WEAVING'], ['WV-2', 'WEAVING'], ['DY-1', 'DYEING'], ['DY-2', 'DYEING']]) {
    const m = await db.machine.create({ data: { code, name: code, type, location: 'Floor', capacityPerHour: 100, hourlyCost: 150, factoryId: factory.id } });
    ids.machines[code] = m.id;
  }
  for (const name of ['Asha', 'Bilal']) {
    const w = await db.worker.create({ data: { name, designation: 'Operator', initials: name[0], wageType: 'HOURLY', rate: 100 } });
    ids.workers.push(w.id);
  }
  Object.assign(ids, { buyer: buyer.id, otherBuyer: otherBuyer.id, recipe: recipe.id, lot: lot.id });

  await makeUser('admin@test.local', 'SUPER_ADMIN');
  await makeUser('manager@test.local', 'PRODUCTION_MANAGER');
  await makeUser('spinner@test.local', 'SPINNING_OPERATOR');
  await makeUser('weaver@test.local', 'WEAVING_OPERATOR');
  await makeUser('dyer@test.local', 'DYEING_OPERATOR');
  await makeUser('inspector@test.local', 'QUALITY_INSPECTOR');
  await makeUser('dispatch@test.local', 'DISPATCH_MANAGER');
  await makeUser('buyer@test.local', 'BUYER', { buyerId: buyer.id });

  [admin, manager, spinner, weaver, dyer, inspector, dispatcher] = await Promise.all(
    ['admin', 'manager', 'spinner', 'weaver', 'dyer', 'inspector', 'dispatch'].map((n) => signIn(`${n}@test.local`)),
  );
});

describe('signup and administrator approval', () => {
  it('never lets a visitor ask for an admin role', async () => {
    const res = await request(app).post('/api/v1/auth/signup').send({
      name: 'Sneaky', email: 'sneaky@test.local', password: PASSWORD, requestedRole: 'SUPER_ADMIN',
    });
    expect(res.status).toBe(400);
  });

  it('keeps new users pending until an admin approves them with a role', async () => {
    const res = await request(app).post('/api/v1/auth/signup').send({
      name: 'New Weaver', email: 'new.weaver@test.local', password: PASSWORD, requestedRole: 'WEAVING_OPERATOR', phone: '99999',
    });
    expect(res.status, res.text).toBe(201);

    const blocked = await request(app).post('/api/v1/auth/login').send({ email: 'new.weaver@test.local', password: PASSWORD });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.message).toMatch(/waiting for administrator approval/);

    // Admins are told; floor staff are not.
    const adminFeed = await get(admin, '/notifications/feed');
    expect(adminFeed.items.some((n: { title: string }) => n.title === 'New signup: New Weaver')).toBe(true);
    const weaverFeed = await get(weaver, '/notifications/feed');
    expect(weaverFeed.items.some((n: { category: string }) => n.category === 'USER')).toBe(false);

    const users = await get(admin, '/rbac/users?pageSize=100');
    const pending = users.data.find((u: { email: string }) => u.email === 'new.weaver@test.local');
    expect(pending).toMatchObject({ approvalStatus: 'PENDING', requestedRole: 'WEAVING_OPERATOR', active: false });

    // Only administrators can approve, and the old activate switch cannot skip approval.
    await post(manager, `/rbac/users/${pending.id}/approve`, { role: 'WEAVING_OPERATOR' }, 403);
    await post(admin, `/rbac/users/${pending.id}/toggle-status`, {}, 400);
    await post(admin, `/rbac/users/${pending.id}/approve`, { role: 'WEAVING_OPERATOR' });

    const newWeaver = await signIn('new.weaver@test.local');
    const me = await get(newWeaver, '/auth/me');
    expect(me.user.role).toBe('WEAVING_OPERATOR');
    await get(newWeaver, '/reports/finance', 403); // only what the role allows
    const feed = await get(newWeaver, '/notifications/feed');
    expect(feed.items[0].title).toBe('Welcome to LoomOS');
  });

  it('turns an approved buyer signup into a buyer company account', async () => {
    await request(app).post('/api/v1/auth/signup').send({
      name: 'Meera', email: 'meera@test.local', password: PASSWORD, requestedRole: 'BUYER', company: 'Meera Fabrics', city: 'Jaipur',
    }).expect(201);
    const user = await db.user.findUniqueOrThrow({ where: { email: 'meera@test.local' } });
    await post(admin, `/rbac/users/${user.id}/approve`, { role: 'BUYER' });
    const approved = await db.user.findUniqueOrThrow({ where: { id: user.id }, include: { buyer: true } });
    expect(approved.buyer?.name).toBe('Meera Fabrics');
  });

  it('blocks rejected signups from signing in', async () => {
    await request(app).post('/api/v1/auth/signup').send({
      name: 'Nope', email: 'nope@test.local', password: PASSWORD, requestedRole: 'QUALITY_INSPECTOR',
    }).expect(201);
    const user = await db.user.findUniqueOrThrow({ where: { email: 'nope@test.local' } });
    await post(admin, `/rbac/users/${user.id}/reject`, { reason: 'Not an employee' });
    const res = await request(app).post('/api/v1/auth/login').send({ email: 'nope@test.local', password: PASSWORD });
    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/declined/);
  });
});

describe('customer order production', () => {
  it('runs an order through every stage, hands over with notifications, and reaches ready-to-ship', async () => {
    const order = await newOrder(400);
    const batch = await batchOfOrder(order.id);
    expect(batch).toMatchObject({ purpose: 'ORDER', fabric: 'Test poplin', color: 'Blue' });

    await runStage(spinner, batch.number, 'SPINNING');
    const weaverFeed = await get(weaver, '/notifications/feed');
    expect(weaverFeed.items.some((n: { title: string }) => n.title === `${batch.number} is ready for weaving`)).toBe(true);

    // A weaver cannot touch the dyeing stage.
    const dyeJob = await db.jobCard.findFirstOrThrow({ where: { productionId: batch.id, stage: 'DYEING' } });
    await post(weaver, `/production/jobs/${dyeJob.id}/advance`, {}, 403);

    await runStage(weaver, batch.number, 'WEAVING');
    await runStage(dyer, batch.number, 'DYEING');

    const rolls = await db.fabricRoll.findMany({ where: { productionId: batch.id } });
    expect(rolls.length).toBe(2);
    for (const roll of rolls) await post(inspector, `/rolls/${roll.id}/inspections`, { result: 'PASSED', defects: [], notes: '' });

    expect((await db.salesOrder.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('READY');
    const detail = await get(manager, `/orders/${order.id}`);
    expect(detail.timeline.some((t: { detail: string }) => t.detail.includes('dyeing completed'))).toBe(true);

    // Yarn reservations are fully released once the batch is done.
    const lot = await db.yarnLot.findUniqueOrThrow({ where: { id: ids.lot } });
    expect(lot.reserved.toNumber()).toBe(0);
  });
});

describe('rework', () => {
  it('sends a batch back to dyeing during dyeing, tracks it, and continues normally afterwards', async () => {
    const order = await newOrder(300);
    const batch = await batchOfOrder(order.id);
    await runStage(spinner, batch.number, 'SPINNING');
    await runStage(weaver, batch.number, 'WEAVING');

    const dyeJob = (await jobsOf(dyer, batch.number)).find((j) => j.stage === 'DYEING')!;
    await post(dyer, `/production/jobs/${dyeJob.id}/advance`); // dyeing starts
    const running = await db.jobCard.findUniqueOrThrow({ where: { id: dyeJob.id } });

    await post(dyer, `/production/batches/${batch.id}/rework`, {
      defectType: 'DYEING_DEFECT', reason: 'Shade variation', returnStage: 'DYEING', machineId: ids.machines['DY-2'], workerId: ids.workers[0],
    });

    let state = await db.jobCard.findUniqueOrThrow({ where: { id: dyeJob.id } });
    expect(state).toMatchObject({ status: 'READY', machineId: ids.machines['DY-2'] });
    expect((await db.machine.findUniqueOrThrow({ where: { id: running.machineId! } })).status).toBe('IDLE');
    expect((await db.productionOrder.findUniqueOrThrow({ where: { id: batch.id } })).status).toBe('REWORK');

    // Managers can find it with the rework filter, and the dyeing team was told.
    const filtered = await get(manager, '/production/batches?status=REWORK');
    expect(filtered.data.map((b: { id: string }) => b.id)).toContain(batch.id);
    const feed = await get(dyer, '/notifications/feed');
    expect(feed.items.some((n: { category: string }) => n.category === 'REWORK')).toBe(false); // the dyer raised it
    const managerFeed = await get(manager, '/notifications/feed');
    expect(managerFeed.items.some((n: { title: string }) => n.title === `Rework: ${batch.number} back to dyeing`)).toBe(true);

    await post(dyer, `/production/jobs/${dyeJob.id}/advance`); // rework accepted on the planned machine
    state = await db.jobCard.findUniqueOrThrow({ where: { id: dyeJob.id } });
    expect(state.machineId).toBe(ids.machines['DY-2']);
    expect((await db.reworkJob.findFirstOrThrow({ where: { productionId: batch.id } })).status).toBe('IN_PROGRESS');

    await post(dyer, `/production/jobs/${dyeJob.id}/advance`); // rework finished
    const rework = await db.reworkJob.findFirstOrThrow({ where: { productionId: batch.id } });
    expect(rework).toMatchObject({ status: 'COMPLETED', returnStage: 'DYEING', fromStage: 'DYEING', raisedBy: 'dyer' });
    expect(rework.cost.toNumber()).toBeGreaterThan(0);
    expect((await db.productionOrder.findUniqueOrThrow({ where: { id: batch.id } })).status).toBe('COMPLETED');
    expect(await db.fabricRoll.count({ where: { productionId: batch.id } })).toBe(2);

    const detail = await get(manager, `/production/batches/${batch.id}`);
    expect(detail.reworks).toHaveLength(1);
    expect(detail.history.some((h: { action: string }) => h.action === 'production.rework.completed')).toBe(true);
  });

  it('sends failed rolls from quality check back to weaving without restarting spinning', async () => {
    const order = await newOrder(200);
    const batch = await batchOfOrder(order.id);
    await runStage(spinner, batch.number, 'SPINNING');
    await runStage(weaver, batch.number, 'WEAVING');
    await runStage(dyer, batch.number, 'DYEING');

    const [roll] = await db.fabricRoll.findMany({ where: { productionId: batch.id } });
    await post(inspector, `/rolls/${roll.id}/inspections`, { result: 'REWORK', defects: ['Broken picks'], notes: '' });
    expect(await db.reworkJob.count({ where: { rollId: roll.id, status: 'OPEN', returnStage: null } })).toBe(1);

    await post(inspector, `/production/batches/${batch.id}/rework`, {
      defectType: 'WEAVING_DEFECT', reason: 'Broken picks across width', returnStage: 'WEAVING', rollIds: [roll.id],
    });
    const jobs = await db.jobCard.findMany({ where: { productionId: batch.id }, orderBy: { sequence: 'asc' } });
    expect(jobs.map((j) => j.status)).toEqual(['COMPLETED', 'READY', 'PLANNED']);
    expect(jobs[1].target.toNumber()).toBe(roll.length.toNumber());
    expect((await db.fabricRoll.findUniqueOrThrow({ where: { id: roll.id } })).quality).toBe('REWORK');
    expect(await db.reworkJob.count({ where: { rollId: roll.id, returnStage: null, status: 'CANCELLED' } })).toBe(1);

    await runStage(weaver, batch.number, 'WEAVING');
    await runStage(dyer, batch.number, 'DYEING');

    // Same roll goes back to inspection; no extra rolls are made.
    expect(await db.fabricRoll.count({ where: { productionId: batch.id } })).toBe(1);
    expect((await db.fabricRoll.findUniqueOrThrow({ where: { id: roll.id } })).quality).toBe('PENDING');
    await post(inspector, `/rolls/${roll.id}/inspections`, { result: 'PASSED', defects: [], notes: '' });

    const history = await get(manager, '/production/reworks?stage=WEAVING');
    expect(history.data.some((r: { rollCodes: string[]; status: string }) => r.rollCodes.includes(roll.code) && r.status === 'COMPLETED')).toBe(true);
  });

  it('refuses rework to a stage the batch has not reached', async () => {
    const order = await newOrder(100);
    const batch = await batchOfOrder(order.id);
    await post(manager, `/production/batches/${batch.id}/rework`, { defectType: 'DYEING_DEFECT', reason: 'Too early', returnStage: 'DYEING' }, 409);
  });
});

describe('standalone production', () => {
  it('makes stock without an order, uses the planned machine, and ships it against a later order', async () => {
    // Floor operators cannot create batches; production managers can.
    await post(spinner, '/production/batches', { recipeId: ids.recipe, color: 'Ecru', quantity: 200, purpose: 'STOCK' }, 403);
    const batch = await post(manager, '/production/batches', {
      recipeId: ids.recipe, color: 'Ecru', quantity: 200, purpose: 'STOCK', spinningMachineId: ids.machines['SP-2'], notes: 'Fast mover',
    });
    expect(batch).toMatchObject({ purpose: 'STOCK', orderId: null, itemId: null });

    const spinFeed = await get(spinner, '/notifications/feed');
    expect(spinFeed.items.some((n: { title: string }) => n.title === `New stock batch ${batch.number}`)).toBe(true);

    const job = (await jobsOf(spinner, batch.number)).find((j) => j.stage === 'SPINNING')!;
    await post(spinner, `/production/jobs/${job.id}/advance`);
    expect((await db.jobCard.findUniqueOrThrow({ where: { id: job.id } })).machineId).toBe(ids.machines['SP-2']);
    await post(spinner, `/production/jobs/${job.id}/advance`);
    await runStage(weaver, batch.number, 'WEAVING');
    await runStage(dyer, batch.number, 'DYEING');

    const [roll] = await db.fabricRoll.findMany({ where: { productionId: batch.id } });
    await post(inspector, `/rolls/${roll.id}/inspections`, { result: 'PASSED', defects: [], notes: '' });
    expect((await db.fabricRoll.findUniqueOrThrow({ where: { id: roll.id } })).location).toMatch(/Finished stock/);

    const stock = await get(manager, '/rolls?source=STOCK&quality=PASSED');
    expect(stock.data.map((r: { id: string }) => r.id)).toContain(roll.id);
    expect((await get(manager, '/production/batches?purpose=STANDALONE')).data.map((b: { id: string }) => b.id)).toContain(batch.id);

    // A later order for the same fabric is filled from stock at the order's price.
    const order = await newOrder(200);
    const shipment = await post(dispatcher, '/shipments', { orderId: order.id, rollIds: [roll.id], transport: 'MH-12 AB 1234' });
    await post(dispatcher, `/shipments/${shipment.id}/verify`, { code: roll.code });
    const invoice = await post(dispatcher, `/shipments/${shipment.id}/confirm`);
    expect(Number(invoice.total)).toBe(200 * 200);
  });
});

describe('production problems', () => {
  it('handles a breakdown: logs the issue, moves the job to another machine, restarts, resolves', async () => {
    const order = await newOrder(200);
    const batch = await batchOfOrder(order.id);
    const job = (await jobsOf(spinner, batch.number)).find((j) => j.stage === 'SPINNING')!;
    await post(spinner, `/production/jobs/${job.id}/advance`);
    const started = await db.jobCard.findUniqueOrThrow({ where: { id: job.id } });

    await post(spinner, `/machines/${started.machineId}/breakdown`, { reason: 'Spindle bearing seized' });
    expect((await db.jobCard.findUniqueOrThrow({ where: { id: job.id } })).status).toBe('BLOCKED');
    const issue = await db.productionIssue.findFirstOrThrow({ where: { productionId: batch.id } });
    expect(issue).toMatchObject({ type: 'MACHINE_BREAKDOWN', status: 'OPEN' });

    const other = started.machineId === ids.machines['SP-1'] ? ids.machines['SP-2'] : ids.machines['SP-1'];
    await post(spinner, `/production/jobs/${job.id}/reassign`, { machineId: other, reason: 'Breakdown' }, 403);
    await post(manager, `/production/jobs/${job.id}/reassign`, { machineId: other, workerId: ids.workers[1], reason: 'Breakdown' });
    await post(spinner, `/production/jobs/${job.id}/advance`); // restart
    const restarted = await db.jobCard.findUniqueOrThrow({ where: { id: job.id } });
    expect(restarted).toMatchObject({ status: 'IN_PROGRESS', machineId: other, workerId: ids.workers[1] });

    await post(manager, `/production/issues/${issue.id}/resolve`, { resolution: 'Moved to the other frame' });
    expect((await db.productionIssue.findUniqueOrThrow({ where: { id: issue.id } })).status).toBe('RESOLVED');
    await post(manager, `/machines/${started.machineId}/recover`, { reason: 'Bearing replaced' });
  });

  it('cancels a batch, gives the yarn back, and creates a replacement for the same order', async () => {
    const before = await db.yarnLot.findUniqueOrThrow({ where: { id: ids.lot } });
    const order = await newOrder(250);
    const batch = await batchOfOrder(order.id);
    const job = (await jobsOf(spinner, batch.number)).find((j) => j.stage === 'SPINNING')!;
    await post(spinner, `/production/jobs/${job.id}/advance`); // reserves yarn
    expect((await db.yarnLot.findUniqueOrThrow({ where: { id: ids.lot } })).reserved.toNumber()).toBeGreaterThan(before.reserved.toNumber());

    await post(manager, `/production/batches/${batch.id}/issues`, { type: 'MATERIAL_SHORTAGE', description: 'Wrong count of yarn issued', holdJob: true });
    expect((await db.jobCard.findUniqueOrThrow({ where: { id: job.id } })).status).toBe('BLOCKED');

    await post(manager, `/production/batches/${batch.id}/cancel`, { reason: 'Wrong yarn count used' });
    expect((await db.yarnLot.findUniqueOrThrow({ where: { id: ids.lot } })).reserved.toNumber()).toBe(before.reserved.toNumber());
    expect((await db.jobCard.findMany({ where: { productionId: batch.id } })).every((j) => j.status === 'CANCELLED')).toBe(true);
    expect(await db.productionIssue.count({ where: { productionId: batch.id, status: 'OPEN' } })).toBe(0);

    const replacement = await post(manager, `/production/batches/${batch.id}/replacement`, { quantity: 250, reason: 'Redo with correct yarn' });
    expect(replacement).toMatchObject({ purpose: 'REPLACEMENT', orderId: order.id, replacesId: batch.id });
    const failed = await get(manager, '/production/batches?status=FAILED');
    expect(failed.data.map((b: { id: string }) => b.id)).toContain(batch.id);
  });
});

describe('filters and analytics', () => {
  it('combines filters on real records', async () => {
    const all = (await get(manager, '/production/batches?pageSize=100')).data as { id: string; department: string; order: { buyer: { id: string } } | null }[];
    const forBuyer = (await get(manager, `/production/batches?buyerId=${ids.buyer}&pageSize=100`)).data as typeof all;
    expect(forBuyer.length).toBeGreaterThan(0);
    expect(forBuyer.every((b) => b.order?.buyer.id === ids.buyer)).toBe(true);
    expect((await get(manager, `/production/batches?buyerId=${ids.otherBuyer}`)).data).toHaveLength(0);

    const spinning = (await get(manager, '/production/batches?department=SPINNING&status=PENDING&pageSize=100')).data as typeof all;
    expect(spinning.every((b) => b.department === 'SPINNING')).toBe(true);

    const onMachine = (await get(manager, `/production/batches?machineId=${ids.machines['DY-2']}&rework=yes`)).data;
    expect(onMachine.length).toBeGreaterThan(0);

    // Operators only see batches that pass through their stage.
    const weaverView = (await get(weaver, '/production/batches?pageSize=100')).data;
    expect(weaverView.length).toBe(all.length);
  });

  it('builds dashboard analytics from the database', async () => {
    const a = await get(manager, '/analytics');
    const produced = a.dailyOutput.reduce((s: number, d: { DYEING: number }) => s + d.DYEING, 0);
    expect(produced).toBeGreaterThan(0);
    expect(a.quality.passed).toBeGreaterThan(0);
    expect(a.quality.rework).toBeGreaterThan(0);
    expect(a.rework.byType.map((r: { type: string }) => r.type)).toEqual(expect.arrayContaining(['DYEING_DEFECT', 'WEAVING_DEFECT']));
    expect(a.productionStatus.find((s: { status: string }) => s.status === 'FAILED').count).toBe(1);
    expect(a.customers[0]).toMatchObject({ buyer: 'Test Buyer' });

    const dyeingOnly = await get(manager, '/analytics?stage=DYEING');
    expect(dyeingOnly.departmentOutput).toHaveLength(1);
    await get(spinner, '/analytics');
    await get(manager, '/analytics?from=not-a-date', 400);
  });

  it('marks notifications as read', async () => {
    const before = await get(weaver, '/notifications/feed');
    expect(before.unread).toBeGreaterThan(0);
    await post(weaver, `/notifications/${before.items[0].id}/read`);
    expect((await get(weaver, '/notifications/feed')).unread).toBe(before.unread - 1);
    await post(weaver, '/notifications/read-all');
    expect((await get(weaver, '/notifications/feed')).unread).toBe(0);
  });
});
