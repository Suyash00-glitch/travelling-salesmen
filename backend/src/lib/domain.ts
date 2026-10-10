import { createHash, randomUUID } from 'node:crypto';
import { db, Prisma, type Tx } from '@loomos/db';
import type { CurrentUser } from '@loomos/shared';
export class DomainError extends Error { constructor(public status:number,message:string) {super(message);} }
export function ensure(condition:unknown,message:string,status=409): asserts condition {if(!condition) throw new DomainError(status,message);}
export const D = (value:Prisma.Decimal.Value) => new Prisma.Decimal(value);
export const sum = (values:Prisma.Decimal.Value[]) => values.reduce<Prisma.Decimal>((a,b)=>a.plus(b),D(0));
export const code = (prefix:string) => `${prefix}-${randomUUID().slice(0,8).toUpperCase()}`;
export type Actor = CurrentUser;
let publish: (buyerId?:string)=>void = ()=>{};
export function setPublisher(fn:typeof publish) { publish=fn; }
export async function audit(tx:Tx,actor:Actor,action:string,entityId:string,detail:string) {return tx.auditLog.create({data:{actorId:actor.id,actorName:actor.name,action,entityId,detail}});}
export async function mutate<T>(actor:Actor,key:string,fingerprint:string,work:(tx:Tx)=>Promise<T>):Promise<T> {
  ensure(key.length>=8 && key.length<=150,'A valid Idempotency-Key is required.',400);
  const id = createHash('sha256').update(`${actor.id}:${key}`).digest('hex');
  const result = await db.$transaction(async tx=>{
    // One factory-wide mutation lock is intentionally simple. Reads stay concurrent.
    // Every business write uses this lock, making multi-row stock/dispatch checks atomic.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(743191)`;
    const prior = await tx.idempotencyRecord.findUnique({where:{id}});
    if(prior) {ensure(prior.fingerprint===fingerprint,'Idempotency key was already used for a different request.');return prior.result as T;}
    const value=await work(tx);
    const json = JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
    await tx.idempotencyRecord.create({data:{id,fingerprint,result:json}});
    return value;
  },{maxWait:15000,timeout:30000});
  publish(); // Only after COMMIT; clients refetch authoritative, role-scoped endpoints.
  return result;
}
export function businessDay(date=new Date()) {return new Date(`${new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(date)}T00:00:00+05:30`);}
