import { createHash, randomUUID } from 'node:crypto';
import { db, Prisma, type Tx } from '@loomos/db';
import type { CurrentUser } from '@loomos/shared';

export class DomainError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function ensure(condition: unknown, message: string, status = 409): asserts condition {
  if (!condition) throw new DomainError(status, message);
}

export const D = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value);
export const sum = (values: Prisma.Decimal.Value[]) =>
  values.reduce<Prisma.Decimal>((a, b) => a.plus(b), D(0));
export const code = (prefix: string) =>
  `${prefix}-${randomUUID().slice(0, 8).toUpperCase()}`;

export type Actor = CurrentUser;

export async function audit(
  tx: Tx,
  actor: Actor,
  action: string,
  entityId: string,
  detail: string,
) {
  return tx.auditLog.create({
    data: { actorId: actor.id, actorName: actor.name, action, entityId, detail },
  });
}

export async function mutate<T>(
  actor: Actor,
  key: string,
  fingerprint: string,
  work: (tx: Tx) => Promise<T>,
): Promise<T> {
  if (key && key.length >= 8 && key.length <= 150) {
    const id = createHash('sha256').update(`${actor.id}:${key}`).digest('hex');
    const prior = await db.idempotencyRecord.findUnique({ where: { id } });
    if (prior) {
      ensure(
        prior.fingerprint === fingerprint,
        'Idempotency key was already used for a different request.',
      );
      return prior.result as T;
    }
    const result = await db.$transaction(work);
    const json = JSON.parse(JSON.stringify(result)) as Prisma.InputJsonValue;
    await db.idempotencyRecord
      .create({ data: { id, fingerprint, result: json } })
      .catch(() => {});
    return result;
  }
  return db.$transaction(work);
}

const istDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' });

// Midnight of the factory-time day that `date` falls on.
export function businessDay(date = new Date()) {
  return new Date(`${istDay.format(date)}T00:00:00+05:30`);
}

// A calendar day in the factory's time zone, stored as UTC midnight of that date
// (what Postgres DATE columns hold). Attendance uses this, so the day never shifts.
export function calendarDate(date = new Date()) {
  return new Date(`${istDay.format(date)}T00:00:00Z`);
}

// The factory-time start of a calendar day stored by calendarDate().
export const dayStart = (calendar: Date) => new Date(`${calendar.toISOString().slice(0, 10)}T00:00:00+05:30`);
