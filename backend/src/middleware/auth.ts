import { randomBytes, createHash } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { db } from '@loomos/db';
import type { Request, Response, NextFunction } from 'express';
import {
  can,
  hasPermission,
  type Area,
  type CurrentUser,
  type PermissionResource,
  type PermissionAction,
  type Role,
} from '@loomos/shared';
import { DomainError, ensure } from '../lib/domain.js';
import { env } from '../config/env.js';

export const hashToken = (value: string) =>
  createHash('sha256').update(value).digest('hex');

export async function sessionUser(token?: string) {
  if (!token) return null;

  const session = await db.session.findUnique({
    where: { id: hashToken(token) },
    include: {
      user: {
        include: {
          factory: true,
          department: true,
          userRoles: {
            include: {
              role: {
                include: {
                  permissions: {
                    include: {
                      permission: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  if (!session || session.expiresAt < new Date() || !session.user.active) {
    return null;
  }

  const u = session.user;

  // Aggregate all assigned roles (primary role + joined userRoles)
  const assignedRolesSet = new Set<string>();
  if (u.role) assignedRolesSet.add(u.role);
  for (const ur of u.userRoles) {
    if (ur.role.code) assignedRolesSet.add(ur.role.code);
  }
  const rolesList = Array.from(assignedRolesSet);

  // Aggregate all granular permission codes across all assigned roles
  const permissionsSet = new Set<string>();
  for (const ur of u.userRoles) {
    for (const rp of ur.role.permissions) {
      if (rp.permission?.code) {
        permissionsSet.add(rp.permission.code);
      }
    }
  }

  const user: CurrentUser = {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role as Role,
    roles: rolesList,
    permissions: Array.from(permissionsSet),
    buyerId: u.buyerId,
    workerId: u.workerId,
    factoryId: u.factoryId,
    factoryName: u.factory?.name,
    departmentId: u.departmentId,
    departmentCode: u.department?.code,
    departmentName: u.department?.name,
    active: u.active,
  };

  return { user, csrf: session.csrf };
}

const dummyHash = bcrypt.hashSync('invalid-login-timing-placeholder', 12);

export async function login(email: string, password: string) {
  const user = await db.user.findUnique({ where: { email: email.toLowerCase() } });
  const valid = await bcrypt.compare(password, user?.passwordHash ?? dummyHash);

  ensure(valid && user?.active, 'Email or password is incorrect.', 401);

  const token = randomBytes(32).toString('hex');
  const csrf = randomBytes(32).toString('hex');

  await db.session.create({
    data: {
      id: hashToken(token),
      userId: user.id,
      csrf,
      expiresAt: new Date(Date.now() + 8 * 3600000),
    },
  });

  return { token, csrf };
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      actor: CurrentUser;
      csrf: string;
    }
  }
}

export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  const session = await sessionUser(req.cookies.loomos_session as string | undefined);
  if (!session) throw new DomainError(401, 'Sign in to continue.');

  req.actor = session.user;
  req.csrf = session.csrf;

  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    if (req.headers['x-csrf-token'] !== session.csrf) {
      throw new DomainError(403, 'Session verification failed. Reload and try again.');
    }
    if (req.headers.origin && !env.allowedOrigins.includes(req.headers.origin) && env.production) {
      throw new DomainError(403, 'Untrusted request origin.');
    }
  }

  next();
}

export const authorize = (area: Area) => (req: Request, _res: Response, next: NextFunction) => {
  const userRoles = [req.actor.role, ...(req.actor.roles ?? [])];
  const isAllowed = userRoles.some((r) => can(r, area)) || hasPermission(req.actor, area, 'view');

  if (!isAllowed) {
    throw new DomainError(403, 'Your role does not have access to this area.');
  }

  next();
};

export const requirePermission = (
  resource: PermissionResource | string,
  action: PermissionAction | string = 'view',
) => (req: Request, _res: Response, next: NextFunction) => {
  if (!hasPermission(req.actor, resource, action)) {
    throw new DomainError(403, `Permission denied: Requires ${resource}:${action}`);
  }
  next();
};

export const requireSuperAdmin = (req: Request, _res: Response, next: NextFunction) => {
  const userRoles = [req.actor.role, ...(req.actor.roles ?? [])];
  if (!userRoles.includes('SUPER_ADMIN') && !userRoles.includes('ADMIN')) {
    throw new DomainError(403, 'Restricted to Super Administrators.');
  }
  next();
};
