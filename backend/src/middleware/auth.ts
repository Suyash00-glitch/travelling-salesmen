import type { Request, Response, NextFunction } from 'express';
import { can, hasPermission, type Area, type CurrentUser, type PermissionResource, type PermissionAction } from '@loomos/shared';
import { sessionUser } from '../modules/auth/auth.service.js';
import { DomainError } from '../lib/domain.js';
import { env } from '../config/env.js';

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
    if (req.headers.origin && req.headers.origin !== env.origin) {
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

export const requirePermission = (resource: PermissionResource | string, action: PermissionAction | string = 'view') =>
  (req: Request, _res: Response, next: NextFunction) => {
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
