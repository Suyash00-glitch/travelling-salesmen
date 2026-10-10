import bcrypt from 'bcryptjs';
import { db, type Tx } from '@loomos/db';
import { roles as standardRoles } from '@loomos/shared';
import { audit, ensure, type Actor } from '../lib/domain.js';
import { notify, admins } from './notification.service.js';

// Signup flow: register → PENDING (cannot sign in) → admin approves with a role, or rejects.

export async function signup(input: {
  name: string;
  email: string;
  password: string;
  requestedRole: string;
  phone: string;
  company: string;
  city: string;
  note: string;
}) {
  const email = input.email.toLowerCase();
  const existing = await db.user.findUnique({ where: { email } });
  ensure(!existing, 'An account with this email address already exists.', 409);

  const passwordHash = await bcrypt.hash(input.password, 12);

  return db.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        name: input.name,
        email,
        passwordHash,
        // No working role until an administrator chooses one.
        role: 'PENDING',
        requestedRole: input.requestedRole,
        approvalStatus: 'PENDING',
        active: false,
        phone: input.phone,
        company: input.company,
        city: input.city,
        note: input.note,
      },
    });

    await tx.auditLog.create({
      data: {
        actorId: user.id,
        actorName: user.name,
        action: 'user.signup',
        entityId: user.id,
        detail: `${user.email} registered and asked for the ${input.requestedRole.toLowerCase().replace(/_/g, ' ')} role`,
      },
    });
    await notify(tx, {
      roles: admins,
      title: `New signup: ${user.name}`,
      message: `${user.email} asked for ${input.requestedRole.toLowerCase().replace(/_/g, ' ')} access${input.company ? ` (${input.company})` : ''}.`,
      category: 'USER',
      link: '/settings',
    });
    return { id: user.id, pendingApproval: true };
  });
}

export async function approveUser(
  tx: Tx,
  userId: string,
  input: { role: string; buyerId?: string; departmentId?: string; workerId?: string },
  actor: Actor,
) {
  const user = await tx.user.findUnique({ where: { id: userId } });
  ensure(user, 'User not found.', 404);
  ensure(user.approvalStatus === 'PENDING', 'This request has already been handled.');

  const role = await tx.role.findUnique({ where: { code: input.role } });
  ensure(role || (standardRoles as readonly string[]).includes(input.role), 'Unknown role.');

  // Buyer accounts must be linked to a buyer company: an existing one, or one made from the signup details.
  let buyerId = input.buyerId ?? null;
  if (input.role === 'BUYER' && !buyerId) {
    ensure(user.company && user.city, 'Pick the buyer company this account belongs to.');
    const buyer = await tx.buyer.create({
      data: {
        name: user.company,
        email: user.email,
        city: user.city,
        initials: user.company.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase(),
      },
    });
    buyerId = buyer.id;
  }

  await tx.user.update({
    where: { id: userId },
    data: {
      role: input.role,
      active: true,
      approvalStatus: 'APPROVED',
      buyerId: input.role === 'BUYER' ? buyerId : null,
      departmentId: input.departmentId ?? null,
      workerId: input.workerId ?? null,
      factoryId: actor.factoryId ?? null,
      userRoles: role ? { create: [{ roleId: role.id }] } : undefined,
    },
  });

  await audit(tx, actor, 'user.approved', userId, `${user.email} approved as ${input.role.toLowerCase().replace(/_/g, ' ')}`);
  await notify(tx, {
    userIds: [userId],
    title: 'Welcome to LoomOS',
    message: `Your account was approved with the ${input.role.toLowerCase().replace(/_/g, ' ')} role.`,
    category: 'USER',
    link: '/',
  });
  await notify(tx, {
    roles: admins,
    title: `${user.name} was approved`,
    message: `Role: ${input.role.toLowerCase().replace(/_/g, ' ')} · by ${actor.name}`,
    category: 'USER',
    link: '/settings',
    skipUserId: actor.id,
  });
  return { id: userId };
}

export async function rejectUser(tx: Tx, userId: string, reason: string, actor: Actor) {
  const user = await tx.user.findUnique({ where: { id: userId } });
  ensure(user, 'User not found.', 404);
  ensure(user.approvalStatus === 'PENDING', 'This request has already been handled.');

  await tx.user.update({ where: { id: userId }, data: { approvalStatus: 'REJECTED', active: false, note: reason } });
  await audit(tx, actor, 'user.rejected', userId, `${user.email} signup declined: ${reason}`);
  await notify(tx, {
    roles: admins,
    title: `${user.name}'s signup was declined`,
    message: `${reason} · by ${actor.name}`,
    category: 'USER',
    link: '/settings',
    skipUserId: actor.id,
  });
  return { id: userId };
}
