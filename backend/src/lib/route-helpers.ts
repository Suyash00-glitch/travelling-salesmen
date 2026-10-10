import { createHash } from 'node:crypto';
import type { Request, Router } from 'express';
import { z } from 'zod';
import type { Tx } from '@loomos/db';
import type { Area } from '@loomos/shared';
import { authorize } from '../middleware/auth.js';
import { mutate, type Actor } from './domain.js';

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

export function write<S extends z.ZodTypeAny>(
  router: Router,
  path: string,
  area: Area,
  schema: S,
  fn: (tx: Tx, input: z.infer<S>, actor: Actor, req: Request) => Promise<unknown>,
): void {
  router.post(path, authorize(area), async (req, res) => {
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

    res.json(result);
  });
}
