import { createHash } from 'node:crypto';
import type { Request, Router } from 'express';
import { z } from 'zod';
import type { Tx } from '@loomos/db';
import { hasPermission } from '@loomos/shared';
import { DomainError, mutate, type Actor } from './domain.js';
import { publish } from './events.js';

export const empty = z.object({});
export const reason = z.object({ reason: z.string().trim().min(3).max(1000) });

export function id(req: Request): string {
  return String(req.params.id);
}

export function page<T>(req: Request, data: T[]): { data: T[]; total: number; page: number; pageSize: number } {
  const pageNum = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 50));
  return {
    data: data.slice((pageNum - 1) * pageSize, pageNum * pageSize),
    total: data.length,
    page: pageNum,
    pageSize,
  };
}

// A permission code such as "production:update". The user needs any one of the listed codes.
export type Permission = `${string}:${string}`;

export const requireAny = (permissions: Permission[]) => (actor: Actor) => {
  const allowed = permissions.some((code) => {
    const [resource, action] = code.split(':');
    return hasPermission(actor, resource, action);
  });
  if (!allowed) throw new DomainError(403, 'Your role is not allowed to do this.');
};

// Every change to the factory goes through here: exact permission check, validated input,
// idempotency, one transaction, then a "something changed" event for open screens.
export function write<S extends z.ZodTypeAny>(
  router: Router,
  path: string,
  permission: Permission | Permission[],
  schema: S,
  fn: (tx: Tx, input: z.infer<S>, actor: Actor, req: Request) => Promise<unknown>,
): void {
  const permissions = Array.isArray(permission) ? permission : [permission];
  const check = requireAny(permissions);
  router.post(path, async (req, res) => {
    check(req.actor);

    const input = schema.parse(req.body);
    const fingerprint = createHash('sha256')
      .update(`${req.path}:${JSON.stringify(input)}`)
      .digest('hex');

    const result = await mutate(
      req.actor,
      req.header('Idempotency-Key') ?? '',
      fingerprint,
      (tx) => fn(tx, input, req.actor, req),
    );

    new Set(permissions.map((p) => p.split(':')[0])).forEach((area) => publish(area));
    res.json(result);
  });
}
