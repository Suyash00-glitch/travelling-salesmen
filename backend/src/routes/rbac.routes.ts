import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { db, type Tx } from '@loomos/db';
import {
  userSchema,
  updateUserSchema,
  roleSchema,
  updateRoleSchema,
  factorySchema,
  departmentSchema,
} from '@loomos/shared';
import { requireSuperAdmin } from '../middleware/auth.js';
import { ensure, audit } from '../lib/domain.js';
import { id, page } from '../lib/route-helpers.js';

export const rbacRouter = Router();

// Protect all RBAC management routes with Super Admin check
rbacRouter.use(requireSuperAdmin);

// ==================== USER MANAGEMENT ====================

// List all system users with roles, factory, and department details
rbacRouter.get('/users', async (req, res) => {
  const users = await db.user.findMany({
    include: {
      factory: { select: { id: true, name: true, code: true } },
      department: { select: { id: true, name: true, code: true } },
      buyer: { select: { id: true, name: true } },
      worker: { select: { id: true, name: true, designation: true } },
      userRoles: {
        include: {
          role: { select: { id: true, code: true, name: true } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  const formatted = users.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    roles: Array.from(new Set([u.role, ...u.userRoles.map((ur) => ur.role.code)])),
    active: u.active,
    buyerId: u.buyerId,
    buyerName: u.buyer?.name,
    workerId: u.workerId,
    workerName: u.worker?.name,
    factoryId: u.factoryId,
    factoryName: u.factory?.name,
    departmentId: u.departmentId,
    departmentName: u.department?.name,
    createdAt: u.createdAt.toISOString(),
  }));

  res.json(page(req, formatted));
});

// Create a new user with multi-role assignment and department scoping
rbacRouter.post('/users', async (req, res) => {
  const input = userSchema.parse(req.body);
  const { password, roles: assignedRoleCodes = [], ...data } = input;

  const existing = await db.user.findUnique({
    where: { email: data.email.toLowerCase() },
  });
  ensure(!existing, 'A user with this email address already exists.', 409);

  const passwordHash = await bcrypt.hash(password, 12);
  const roleCode = data.role;
  const allRoleCodes = Array.from(new Set([roleCode, ...assignedRoleCodes]));

  // Find role records
  const roleRecords = await db.role.findMany({
    where: { code: { in: allRoleCodes } },
  });

  const user = await db.user.create({
    data: {
      name: data.name,
      email: data.email.toLowerCase(),
      passwordHash,
      role: roleCode,
      active: data.active ?? true,
      buyerId: data.buyerId ?? null,
      workerId: data.workerId ?? null,
      factoryId: data.factoryId ?? null,
      departmentId: data.departmentId ?? null,
      userRoles: {
        create: roleRecords.map((r) => ({ roleId: r.id })),
      },
    },
    include: {
      userRoles: { include: { role: true } },
      factory: true,
      department: true,
    },
  });

  await audit(
    db as unknown as Tx,
    req.actor,
    'rbac.user.created',
    user.id,
    `Created user ${user.name} (${user.email}) with roles [${allRoleCodes.join(', ')}]`,
  );

  res.status(201).json({ id: user.id, email: user.email, name: user.name });
});

// Update user profile, roles, status, and assignments
rbacRouter.patch('/users/:id', async (req, res) => {
  const userId = id(req);
  const input = updateUserSchema.parse(req.body);

  const existing = await db.user.findUnique({ where: { id: userId } });
  ensure(existing, 'User not found.', 404);

  const updateData: Record<string, unknown> = {};
  if (input.name !== undefined) updateData.name = input.name;
  if (input.role !== undefined) updateData.role = input.role;
  if (input.active !== undefined) updateData.active = input.active;
  if (input.buyerId !== undefined) updateData.buyerId = input.buyerId;
  if (input.workerId !== undefined) updateData.workerId = input.workerId;
  if (input.factoryId !== undefined) updateData.factoryId = input.factoryId;
  if (input.departmentId !== undefined) updateData.departmentId = input.departmentId;
  if (input.password) {
    updateData.passwordHash = await bcrypt.hash(input.password, 12);
  }

  // Update roles if provided
  if (input.roles !== undefined || input.role !== undefined) {
    const primaryRole = input.role ?? existing.role;
    const assignedRoleCodes = Array.from(new Set([primaryRole, ...(input.roles ?? [])]));
    const roleRecords = await db.role.findMany({
      where: { code: { in: assignedRoleCodes } },
    });

    await db.userRole.deleteMany({ where: { userId } });
    if (roleRecords.length > 0) {
      await db.userRole.createMany({
        data: roleRecords.map((r) => ({ userId, roleId: r.id })),
      });
    }
  }

  const updated = await db.user.update({
    where: { id: userId },
    data: updateData,
  });

  // If user was deactivated, invalidate all active sessions immediately
  if (input.active === false) {
    await db.session.deleteMany({ where: { userId } });
  }

  await audit(
    db as unknown as Tx,
    req.actor,
    'rbac.user.updated',
    userId,
    `Updated user ${updated.email}: active=${updated.active}, role=${updated.role}`,
  );

  res.json({ ok: true, id: updated.id });
});

// Toggle account activation / suspension
rbacRouter.post('/users/:id/toggle-status', async (req, res) => {
  const userId = id(req);
  const user = await db.user.findUnique({ where: { id: userId } });
  ensure(user, 'User not found.', 404);
  ensure(user.id !== req.actor.id, 'You cannot suspend your own account.', 400);

  const newActive = !user.active;
  const updated = await db.user.update({
    where: { id: userId },
    data: { active: newActive },
  });

  // Invalidate sessions immediately on deactivation
  if (!newActive) {
    await db.session.deleteMany({ where: { userId } });
  }

  await audit(
    db as unknown as Tx,
    req.actor,
    newActive ? 'rbac.user.activated' : 'rbac.user.deactivated',
    userId,
    `${newActive ? 'Activated' : 'Suspended'} user ${user.email}`,
  );

  res.json({ id: updated.id, active: updated.active });
});

// ==================== ROLE MANAGEMENT ====================

// List all roles with attached permissions and user counts
rbacRouter.get('/roles', async (_req, res) => {
  const roles = await db.role.findMany({
    include: {
      permissions: {
        include: {
          permission: { select: { code: true } },
        },
      },
      _count: {
        select: { users: true },
      },
    },
    orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
  });

  const formatted = roles.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    description: r.description,
    isSystem: r.isSystem,
    permissions: r.permissions.map((rp) => rp.permission.code),
    userCount: r._count.users,
  }));

  res.json(formatted);
});

// Create a custom role with permissions
rbacRouter.post('/roles', async (req, res) => {
  const input = roleSchema.parse(req.body);

  const existing = await db.role.findUnique({ where: { code: input.code } });
  ensure(!existing, `Role code '${input.code}' already exists.`, 409);

  // Find permission records
  const permissionRecords = await db.permission.findMany({
    where: { code: { in: input.permissions } },
  });

  const role = await db.role.create({
    data: {
      code: input.code,
      name: input.name,
      description: input.description,
      isSystem: false,
      permissions: {
        create: permissionRecords.map((p) => ({ permissionId: p.id })),
      },
    },
  });

  await audit(
    db as unknown as Tx,
    req.actor,
    'rbac.role.created',
    role.id,
    `Created custom role ${role.name} (${role.code}) with ${permissionRecords.length} permissions`,
  );

  res.status(201).json(role);
});

// Update role details and permission mappings
rbacRouter.put('/roles/:id', async (req, res) => {
  const roleId = id(req);
  const input = updateRoleSchema.parse(req.body);

  const role = await db.role.findUnique({ where: { id: roleId } });
  ensure(role, 'Role not found.', 404);

  const updateData: Record<string, unknown> = {};
  if (input.name !== undefined) updateData.name = input.name;
  if (input.description !== undefined) updateData.description = input.description;

  if (input.permissions !== undefined) {
    const permissionRecords = await db.permission.findMany({
      where: { code: { in: input.permissions } },
    });

    await db.rolePermission.deleteMany({ where: { roleId } });
    if (permissionRecords.length > 0) {
      await db.rolePermission.createMany({
        data: permissionRecords.map((p) => ({ roleId, permissionId: p.id })),
      });
    }
  }

  const updated = await db.role.update({
    where: { id: roleId },
    data: updateData,
  });

  await audit(
    db as unknown as Tx,
    req.actor,
    'rbac.role.updated',
    roleId,
    `Updated permissions for role ${role.code}`,
  );

  res.json(updated);
});

// Delete custom role
rbacRouter.delete('/roles/:id', async (req, res) => {
  const roleId = id(req);
  const role = await db.role.findUnique({
    where: { id: roleId },
    include: { _count: { select: { users: true } } },
  });

  ensure(role, 'Role not found.', 404);
  ensure(!role.isSystem, 'System roles cannot be deleted.', 403);
  ensure(role._count.users === 0, 'Cannot delete role assigned to active users.', 400);

  await db.role.delete({ where: { id: roleId } });

  await audit(
    db as unknown as Tx,
    req.actor,
    'rbac.role.deleted',
    roleId,
    `Deleted custom role ${role.name} (${role.code})`,
  );

  res.json({ ok: true });
});

// ==================== PERMISSIONS CATALOG ====================

// List all granular permissions
rbacRouter.get('/permissions', async (_req, res) => {
  const permissions = await db.permission.findMany({
    orderBy: [{ resource: 'asc' }, { action: 'asc' }],
  });
  res.json(permissions);
});

// ==================== FACTORIES & DEPARTMENTS ====================

// List factories
rbacRouter.get('/factories', async (_req, res) => {
  const factories = await db.factory.findMany({
    include: {
      _count: {
        select: { departments: true, users: true },
      },
    },
    orderBy: { name: 'asc' },
  });

  res.json(
    factories.map((f) => ({
      id: f.id,
      code: f.code,
      name: f.name,
      location: f.location,
      active: f.active,
      departmentCount: f._count.departments,
      userCount: f._count.users,
    })),
  );
});

// Create factory
rbacRouter.post('/factories', async (req, res) => {
  const input = factorySchema.parse(req.body);
  const factory = await db.factory.create({ data: input });
  await audit(db as unknown as Tx, req.actor, 'rbac.factory.created', factory.id, factory.name);
  res.status(201).json(factory);
});

// List departments
rbacRouter.get('/departments', async (_req, res) => {
  const departments = await db.department.findMany({
    include: {
      factory: { select: { name: true } },
      _count: { select: { users: true } },
    },
    orderBy: { name: 'asc' },
  });

  res.json(
    departments.map((d) => ({
      id: d.id,
      code: d.code,
      name: d.name,
      factoryId: d.factoryId,
      factoryName: d.factory.name,
      active: d.active,
      userCount: d._count.users,
    })),
  );
});

// Create department
rbacRouter.post('/departments', async (req, res) => {
  const input = departmentSchema.parse(req.body);
  const department = await db.department.create({ data: input });
  await audit(db as unknown as Tx, req.actor, 'rbac.department.created', department.id, department.name);
  res.status(201).json(department);
});
