import '../../../backend/src/config/env.js';
import { db, type Tx } from '../src/index.js';
import bcrypt from 'bcryptjs';
import {
  type CurrentUser,
  permissionResources,
  permissionActions,
  ROLE_PERMISSIONS_TEMPLATE,
  standardRoles,
  type Role,
} from '@loomos/shared';
import { createOrder, planOrder } from '../../../backend/src/modules/orders/orders.service.js';
import { receiveYarn, reserveYarn } from '../../../backend/src/modules/inventory/inventory.service.js';
import { startJob, recordOutput, transitionJob, machineAction } from '../../../backend/src/modules/production/production.service.js';
import { inspectRoll } from '../../../backend/src/modules/quality/quality.service.js';
import { createShipment, verifyRoll, confirmShipment, buyerPayment } from '../../../backend/src/modules/dispatch/dispatch.service.js';
import { recordAttendance } from '../../../backend/src/modules/workforce/workforce.service.js';
import { D, businessDay } from '../../../backend/src/lib/domain.js';

export async function seedRbacAndFacilities(tx: Tx) {
  // 1. Seed Factory
  const factory = await tx.factory.upsert({
    where: { code: 'ETM-01' },
    update: { name: 'Everest Textile Mills · Main Plant', location: 'Ludhiana, Punjab', active: true },
    create: { code: 'ETM-01', name: 'Everest Textile Mills · Main Plant', location: 'Ludhiana, Punjab', active: true },
  });

  // 2. Seed Departments
  const deptDefs = [
    { code: 'SPINNING', name: 'Spinning Department' },
    { code: 'WEAVING', name: 'Weaving Shed' },
    { code: 'DYEING', name: 'Dyeing & Processing' },
    { code: 'QUALITY', name: 'Quality Assurance' },
    { code: 'DISPATCH', name: 'Dispatch & Logistics' },
    { code: 'FINANCE', name: 'Finance & Accounts' },
  ];

  const depts: Record<string, string> = {};
  for (const def of deptDefs) {
    const d = await tx.department.upsert({
      where: { code: def.code },
      update: { name: def.name, factoryId: factory.id, active: true },
      create: { code: def.code, name: def.name, factoryId: factory.id, active: true },
    });
    depts[def.code] = d.id;
  }

  // 3. Seed Permissions
  const permissionIds: Record<string, string> = {};
  for (const resource of permissionResources) {
    for (const action of permissionActions) {
      const code = `${resource}:${action}`;
      const name = `${action.toUpperCase()} ${resource.toUpperCase()}`;
      const p = await tx.permission.upsert({
        where: { code },
        update: { name, resource, action, description: `Allows user to ${action} ${resource}` },
        create: { code, name, resource, action, description: `Allows user to ${action} ${resource}` },
      });
      permissionIds[code] = p.id;
    }
  }

  // 4. Seed Standard Roles
  const roleDisplayNames: Record<string, string> = {
    SUPER_ADMIN: 'Super Administrator',
    ADMIN: 'System Administrator',
    PRODUCTION_MANAGER: 'Production Manager',
    INVENTORY_MANAGER: 'Inventory Manager',
    PROCUREMENT_MANAGER: 'Procurement Manager',
    SPINNING_OPERATOR: 'Spinning Operator',
    WEAVING_OPERATOR: 'Weaving Operator',
    DYEING_OPERATOR: 'Dyeing Operator',
    OPERATOR: 'Floor Operator',
    QUALITY_INSPECTOR: 'Quality Inspector',
    DISPATCH_MANAGER: 'Dispatch Manager',
    SHIFT_SUPERVISOR: 'Shift Supervisor',
    MAINTENANCE_ENGINEER: 'Maintenance Engineer',
    ACCOUNTS_MANAGER: 'Accounts Manager',
    BUYER: 'Buyer Portal User',
  };

  const seededRoles: Record<string, string> = {};
  for (const roleCode of standardRoles) {
    const roleRecord = await tx.role.upsert({
      where: { code: roleCode },
      update: {
        name: roleDisplayNames[roleCode] ?? roleCode,
        description: `Standard system role for ${roleDisplayNames[roleCode] ?? roleCode}`,
        isSystem: true,
      },
      create: {
        code: roleCode,
        name: roleDisplayNames[roleCode] ?? roleCode,
        description: `Standard system role for ${roleDisplayNames[roleCode] ?? roleCode}`,
        isSystem: true,
      },
    });
    seededRoles[roleCode] = roleRecord.id;

    // Link template permissions
    const allowedPerms = ROLE_PERMISSIONS_TEMPLATE[roleCode as Role] ?? [];
    for (const permCode of allowedPerms) {
      const permId = permissionIds[permCode];
      if (permId) {
        await tx.rolePermission.upsert({
          where: { roleId_permissionId: { roleId: roleRecord.id, permissionId: permId } },
          update: {},
          create: { roleId: roleRecord.id, permissionId: permId },
        });
      }
    }
  }

  return { factory, depts, seededRoles };
}

async function seed() {
  const password = process.env.DEMO_PASSWORD;
  if (!password || password.startsWith('replace-')) {
    throw new Error('Set DEMO_PASSWORD in .env before seeding.');
  }
  const hash = await bcrypt.hash(password, 12);

  await db.$transaction(async (tx) => {
    const { factory, depts, seededRoles } = await seedRbacAndFacilities(tx);

    const userCount = await tx.user.count();
    if (userCount > 0) {
      console.log('Database already has users. Ensuring RBAC user-role mappings and demo accounts...');
      const existingUsers = await tx.user.findMany();
      for (const u of existingUsers) {
        const roleId = seededRoles[u.role] ?? seededRoles['ADMIN'];
        if (roleId) {
          await tx.userRole.upsert({
            where: { userId_roleId: { userId: u.id, roleId } },
            update: {},
            create: { userId: u.id, roleId },
          });
        }
        if (!u.factoryId && factory.id) {
          await tx.user.update({
            where: { id: u.id },
            data: { factoryId: factory.id },
          });
        }
      }

      const allDemoUsers = [
        { role: 'PRODUCTION_MANAGER', email: 'production', name: 'Vikram Singh', dept: depts['WEAVING'] },
        { role: 'INVENTORY_MANAGER', email: 'inventory', name: 'Neha Gupta', dept: depts['WEAVING'] },
        { role: 'PROCUREMENT_MANAGER', email: 'procurement', name: 'Anil Kapoor', dept: depts['WEAVING'] },
        { role: 'SPINNING_OPERATOR', email: 'spinning', name: 'Anjali Mehta', dept: depts['SPINNING'] },
        { role: 'WEAVING_OPERATOR', email: 'weaving', name: 'Rajesh Kumar', dept: depts['WEAVING'] },
        { role: 'DYEING_OPERATOR', email: 'dyeing', name: 'Priya Sharma', dept: depts['DYEING'] },
        { role: 'OPERATOR', email: 'operator', name: 'Rajesh Kumar', dept: depts['WEAVING'] },
        { role: 'QUALITY_INSPECTOR', email: 'quality', name: 'Sunita Devi', dept: depts['QUALITY'] },
        { role: 'DISPATCH_MANAGER', email: 'dispatch', name: 'Rohan Shah', dept: depts['DISPATCH'] },
        { role: 'SHIFT_SUPERVISOR', email: 'supervisor', name: 'Sanjay Dutt', dept: depts['WEAVING'] },
        { role: 'MAINTENANCE_ENGINEER', email: 'maintenance', name: 'Ravi Verma', dept: depts['WEAVING'] },
        { role: 'ACCOUNTS_MANAGER', email: 'accounts', name: 'Kavita Rao', dept: depts['FINANCE'] },
      ];

      for (const demoUser of allDemoUsers) {
        const email = `${demoUser.email}@loomos.demo`;
        const userRec = await tx.user.upsert({
          where: { email },
          update: {
            role: demoUser.role,
            factoryId: factory.id,
            departmentId: demoUser.dept ?? null,
            active: true,
          },
          create: {
            name: demoUser.name,
            email,
            passwordHash: hash,
            role: demoUser.role,
            factoryId: factory.id,
            departmentId: demoUser.dept ?? null,
            active: true,
          },
        });

        const roleId = seededRoles[demoUser.role];
        if (roleId) {
          await tx.userRole.upsert({
            where: { userId_roleId: { userId: userRec.id, roleId } },
            update: {},
            create: { userId: userRec.id, roleId },
          });
        }
      }

      // Ensure an audit entry for RBAC system initialization
      const adminUser = await tx.user.findFirst({ where: { email: 'owner@loomos.demo' } });
      if (adminUser) {
        await tx.auditLog.create({
          data: {
            actorId: adminUser.id,
            actorName: adminUser.name,
            action: 'rbac.system.initialized',
            entityId: factory.id,
            detail: 'Super Admin initialized multi-unit RBAC roles, facilities, and permissions.',
          },
        });
      }

      return;
    }

    // Buyers & Suppliers
    const buyers = await Promise.all([
      ['Arvind Textiles', 'Ahmedabad', 'AT'],
      ['Fabindia', 'New Delhi', 'FI'],
      ['Raymond Apparel', 'Mumbai', 'RA'],
      ['H&M Sourcing', 'Bengaluru', 'HM'],
      ['Westside', 'Mumbai', 'WS'],
    ].map(([name, city, initials], i) =>
      tx.buyer.create({ data: { name, city, initials, email: `buyer${i + 1}@example.test` } }),
    ));

    const suppliers = await Promise.all([
      ['Vardhman Yarns', 'Ludhiana'],
      ['Nahar Spinning Mills', 'Coimbatore'],
      ['Trident Fibres', 'Barnala'],
    ].map(([name, city], i) =>
      tx.supplier.create({ data: { name, city, email: `supplier${i}@example.test` } }),
    ));

    // Workers linked to departments
    const workers = await Promise.all([
      ['Rajesh Kumar', 'Loom operator', depts['WEAVING']],
      ['Priya Sharma', 'Dyeing specialist', depts['DYEING']],
      ['Amit Patel', 'Loom operator', depts['WEAVING']],
      ['Sunita Devi', 'Quality inspector', depts['QUALITY']],
      ['Vikram Singh', 'Floor supervisor', depts['WEAVING']],
      ['Anjali Mehta', 'Ring frame operator', depts['SPINNING']],
      ['Ravi Verma', 'Machine technician', depts['WEAVING']],
      ['Meena Kumari', 'Packing operator', depts['DISPATCH']],
    ].map(([name, designation, departmentId], i) =>
      tx.worker.create({
        data: {
          name,
          designation,
          initials: name.split(' ').map((n) => n[0]).join(''),
          wageType: i === 7 ? 'PIECE' : 'HOURLY',
          rate: i === 7 ? 3 : 90 + i * 5,
          departmentId,
        },
      }),
    ));

    const shifts = await Promise.all([
      ['Morning shift', 6],
      ['Evening shift', 14],
      ['Night shift', 22],
    ].map(([name, startHour]) =>
      tx.shift.create({ data: { name: String(name), startHour: Number(startHour), hours: 8 } }),
    ));

    // Demo Users
    const admin = await tx.user.create({
      data: {
        name: 'Aditya Mehta',
        email: 'owner@loomos.demo',
        role: 'SUPER_ADMIN',
        passwordHash: hash,
        factoryId: factory.id,
      },
    });
    if (seededRoles['SUPER_ADMIN']) {
      await tx.userRole.create({ data: { userId: admin.id, roleId: seededRoles['SUPER_ADMIN'] } });
    }
    if (seededRoles['ADMIN']) {
      await tx.userRole.create({ data: { userId: admin.id, roleId: seededRoles['ADMIN'] } });
    }

    const demoUsers = [
      { role: 'PRODUCTION_MANAGER', email: 'production', name: 'Vikram Singh', dept: depts['WEAVING'] },
      { role: 'INVENTORY_MANAGER', email: 'inventory', name: 'Neha Gupta', dept: depts['WEAVING'] },
      { role: 'PROCUREMENT_MANAGER', email: 'procurement', name: 'Anil Kapoor', dept: depts['WEAVING'] },
      { role: 'SPINNING_OPERATOR', email: 'spinning', name: 'Anjali Mehta', dept: depts['SPINNING'], workerId: workers[5].id },
      { role: 'WEAVING_OPERATOR', email: 'weaving', name: 'Rajesh Kumar', dept: depts['WEAVING'], workerId: workers[0].id },
      { role: 'DYEING_OPERATOR', email: 'dyeing', name: 'Priya Sharma', dept: depts['DYEING'], workerId: workers[1].id },
      { role: 'OPERATOR', email: 'operator', name: 'Rajesh Kumar', dept: depts['WEAVING'], workerId: workers[0].id },
      { role: 'QUALITY_INSPECTOR', email: 'quality', name: 'Sunita Devi', dept: depts['QUALITY'], workerId: workers[3].id },
      { role: 'DISPATCH_MANAGER', email: 'dispatch', name: 'Rohan Shah', dept: depts['DISPATCH'] },
      { role: 'SHIFT_SUPERVISOR', email: 'supervisor', name: 'Sanjay Dutt', dept: depts['WEAVING'], workerId: workers[4].id },
      { role: 'MAINTENANCE_ENGINEER', email: 'maintenance', name: 'Ravi Verma', dept: depts['WEAVING'], workerId: workers[6].id },
      { role: 'ACCOUNTS_MANAGER', email: 'accounts', name: 'Kavita Rao', dept: depts['FINANCE'] },
      { role: 'BUYER', email: 'buyer', name: 'Arvind Textiles', buyerId: buyers[0].id },
    ];

    for (const u of demoUsers) {
      const createdUser = await tx.user.create({
        data: {
          name: u.name,
          email: `${u.email}@loomos.demo`,
          role: u.role,
          passwordHash: hash,
          buyerId: u.buyerId ?? null,
          workerId: u.workerId ?? null,
          factoryId: factory.id,
          departmentId: u.dept ?? null,
        },
      });

      const roleId = seededRoles[u.role];
      if (roleId) {
        await tx.userRole.create({
          data: { userId: createdUser.id, roleId },
        });
      }
    }

    const actor: CurrentUser = {
      id: admin.id,
      name: admin.name,
      email: admin.email,
      role: 'ADMIN',
      buyerId: null,
      workerId: null,
    };

    const recipes = await Promise.all([
      { name: 'Premium cotton poplin', material: 'Cotton yarn', specification: '40s combed', kgPerMetre: 0.18, wastePercent: 3, route: ['WEAVING', 'DYEING'], overheadPerMetre: 8 },
      { name: 'Cotton twill', material: 'Cotton yarn', specification: '30s carded', kgPerMetre: 0.24, wastePercent: 4, route: ['WEAVING', 'DYEING'], overheadPerMetre: 10 },
      { name: 'Linen blend', material: 'Linen blend yarn', specification: '40 lea', kgPerMetre: 0.21, wastePercent: 3, route: ['WEAVING', 'DYEING'], overheadPerMetre: 12 },
      { name: 'Raw cotton fabric', material: 'Cotton fibre', specification: 'Long staple', kgPerMetre: 0.2, wastePercent: 5, route: ['SPINNING', 'WEAVING'], overheadPerMetre: 8 },
    ].map((data) => tx.recipe.create({ data })));

    const lots = [];
    for (let i = 0; i < 6; i++) {
      const recipe = recipes[i % 4];
      const lot = await receiveYarn(tx, {
        supplierId: suppliers[i % 3].id,
        reference: `GRN-2026-${String(i + 1).padStart(3, '0')}`,
        material: recipe.material,
        color: ['Natural', 'Ivory', 'Natural', 'Raw white'][i % 4],
        specification: recipe.specification,
        quantity: i === 5 ? 85 : 4500 + i * 300,
        costPerKg: 260 + i * 22,
        location: `Warehouse A · Rack ${i + 1}`,
        threshold: i === 5 ? 150 : 500,
      }, actor);
      lots.push(lot);
    }

    // Machines linked to Factory & Department
    const machines = [];
    for (let i = 0; i < 12; i++) {
      const type = i < 8 ? 'WEAVING' : i < 11 ? 'DYEING' : 'SPINNING';
      const departmentId = depts[type];
      machines.push(
        await tx.machine.create({
          data: {
            code: `${i < 8 ? 'LM' : i < 11 ? 'DY' : 'SP'}-${String(i + 1).padStart(2, '0')}`,
            name: i < 8 ? ['Air-jet loom', 'Rapier loom', 'Shuttle loom'][i % 3] : i < 11 ? 'Jet dyeing machine' : 'Ring spinning frame',
            type,
            location: i < 8 ? 'Weaving hall · Floor 1' : 'Processing hall · Floor 2',
            capacityPerHour: i < 8 ? 120 + i * 8 : 100,
            hourlyCost: i < 8 ? 180 : 260,
            status: i === 10 ? 'MAINTENANCE' : 'IDLE',
            factoryId: factory.id,
            departmentId,
          },
        }),
      );
    }

    const targets = [1200, 1600, 1400, 1000, 800, 1200, 1600, 900, 1200];
    for (let i = 0; i < targets.length; i++) {
      const recipe = recipes[i % 3];
      const deadline = new Date(Date.now() + (i === 4 ? -1 : 3 + i) * 86400000).toISOString().slice(0, 10);
      const order = await createOrder(tx, {
        buyerId: buyers[i % 5].id,
        deadline,
        priority: i === 4 ? 'URGENT' : i % 3 === 0 ? 'HIGH' : 'NORMAL',
        instructions: ['Pre-shrunk finish. Colour fastness grade 4.', 'Pack rolls individually with buyer labels.', 'Maintain consistent shade across all rolls.'][i % 3],
        items: [{ recipeId: recipe.id, fabric: recipe.name, color: ['Sage green', 'Indigo blue', 'Warm ivory', 'Terracotta', 'Midnight navy'][i % 5], quantity: targets[i], price: 185 + i * 15 }],
      }, actor);
      await tx.salesOrder.update({ where: { id: order.id }, data: { number: `SO-2026-${String(1048 + i).padStart(4, '0')}`, createdAt: new Date(Date.now() - (12 - i) * 86400000) } });
      if (i === 8) continue;
      await planOrder(tx, order.id, actor);
      const production = await tx.productionOrder.findUniqueOrThrow({ where: { itemId: order.items[0].id }, include: { jobs: { orderBy: { sequence: 'asc' } } } });
      await tx.productionOrder.update({ where: { id: production.id }, data: { number: `WO-${2041 + i}` } });
      if (i === 7) continue;
      const lot = lots[i % 3];
      const required = D(targets[i]).mul(recipe.kgPerMetre).mul(D(1).plus(recipe.wastePercent.div(100))).toDecimalPlaces(3).toNumber();
      await reserveYarn(tx, { lotId: lot.id, productionId: production.id, quantity: required }, actor);
      for (const job of production.jobs) {
        if (i >= 2 && job.sequence === 1) break;
        const machine = job.stage === 'DYEING' ? machines[8] : machines[i];
        const worker = workers[i];
        await startJob(tx, job.id, { machineId: machine.id, workerId: worker.id, shiftId: shifts[0].id }, actor);
        const output = i < 2 ? targets[i] : Math.floor(targets[i] * [0.68, 0.45, 0.3, 0.6, 0.8][(i - 2) % 5]);
        const last = job.sequence === production.jobs.length - 1;
        const lengths = last ? Array.from({ length: Math.ceil(output / 200) }, (_, j) => Math.min(200, output - j * 200)) : [];
        const entry = await recordOutput(tx, job.id, { quantity: output, waste: 0, hours: Number(D(output).div(machine.capacityPerHour).toFixed(3)), lotId: job.sequence === 0 ? lot.id : undefined, consumedKg: job.sequence === 0 ? D(output).mul(recipe.kgPerMetre).toNumber() : 0, rollLengths: lengths }, actor);
        const createdAt = new Date(businessDay().getTime() - (6 - i % 7) * 86400000 + 8 * 3600000);
        await tx.productionEntry.update({ where: { id: entry.id }, data: { createdAt } });
        await tx.costAllocation.updateMany({ where: { source: entry.id }, data: { createdAt } });
        if (i < 2) await transitionJob(tx, job.id, 'complete', actor);
      }
      if (i < 2) {
        const rolls = await tx.fabricRoll.findMany({ where: { productionId: production.id }, orderBy: { createdAt: 'asc' } });
        for (let j = 0; j < rolls.length; j++) {
          await tx.fabricRoll.update({ where: { id: rolls[j].id }, data: { code: `RL-${3010 + i * 10 + j}` } });
          if (i === 1 && j === rolls.length - 1) continue;
          await inspectRoll(tx, rolls[j].id, { result: i === 1 && j === rolls.length - 2 ? 'REWORK' : 'PASSED', defects: i === 1 && j === rolls.length - 2 ? ['Colour mismatch'] : [], notes: 'Demonstration inspection record' }, actor);
        }
        const eligible = rolls.slice(0, i === 0 ? rolls.length : 2);
        const shipment = await createShipment(tx, { orderId: order.id, rollIds: eligible.map((r) => r.id), transport: i === 0 ? 'GJ 01 AB 4821 · Blue Dart Freight' : 'MH 04 JK 7820 · TCI Express' }, actor);
        if (i === 0) {
          for (const roll of eligible) await verifyRoll(tx, shipment.id, roll.id);
          const invoice = await confirmShipment(tx, shipment.id, actor);
          await buyerPayment(tx, invoice.id, { amount: 120000, reference: 'DEMO-NEFT-1026' }, actor);
        }
      }
    }

    await machineAction(tx, machines[4].id, 'breakdown', 'Warp tension sensor fault · Maintenance team assigned', actor);
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    for (const worker of workers) await recordAttendance(tx, { workerId: worker.id, shiftId: shifts[0].id, date: today, hours: 8, status: 'PRESENT' }, actor);
    await tx.purchaseOrder.create({ data: { number: 'PO-2026-041', supplierId: suppliers[0].id, material: 'Cotton yarn', color: 'Natural', specification: '30s carded', quantity: 2500, costPerKg: 285, expectedAt: new Date(Date.now() + 3 * 86400000) } });
    await tx.operatingExpense.create({ data: { category: 'Utilities', description: 'Demonstration factory electricity expense', amount: 18400 } });
  }, { timeout: 120000 });

  console.log('LoomOS demonstration factory & RBAC seeded. Sign in with owner@loomos.demo and DEMO_PASSWORD.');
}

seed().finally(() => db.$disconnect());
