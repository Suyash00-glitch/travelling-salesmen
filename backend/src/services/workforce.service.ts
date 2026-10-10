import { db, type Tx } from '@loomos/db';
import { audit, businessDay, D, ensure, sum, type Actor } from '../lib/domain.js';
import { notify, managers } from './notification.service.js';

// Shifts and attendance. The shift supervisor checks workers in and out; production can only
// start for workers who are checked in. A shift is identified by its start hour and length,
// so night shifts (e.g. 22:00 + 8 h) simply run past midnight.

const HOUR = 3600000;
const GRACE = 60 * 60000; // check-in allowed up to an hour before the shift starts

interface ShiftRow { id: string; name: string; startHour: number; hours: { toNumber(): number } }

// The most recent start of a shift at or before `now`, and its end.
export function shiftWindow(shift: ShiftRow, now = new Date()) {
  const start = new Date(businessDay(now).getTime() + shift.startHour * HOUR);
  if (start.getTime() > now.getTime() + GRACE) start.setTime(start.getTime() - 24 * HOUR);
  const end = new Date(start.getTime() + shift.hours.toNumber() * HOUR);
  return { start, end, date: businessDay(start) };
}

export function shiftState(shift: ShiftRow, now = new Date()) {
  const { start, end } = shiftWindow(shift, now);
  if (now < start) return 'UPCOMING';
  if (now > end) return 'COMPLETED';
  return 'CURRENT';
}

export async function currentShift(now = new Date()) {
  const shifts = await db.shift.findMany({ orderBy: { startHour: 'asc' } });
  return shifts.find((s) => shiftState(s, now) === 'CURRENT') ?? null;
}

// The open attendance record (checked in, not yet out) for a worker, if any.
export function openAttendance(tx: Tx, workerId: string) {
  return tx.attendance.findFirst({
    where: { workerId, checkInAt: { not: null }, checkOutAt: null },
    include: { shift: true },
    orderBy: { checkInAt: 'desc' },
  });
}

// The worker's open attendance, but only while that shift is still on (plus an hour of grace).
// A forgotten check-out from yesterday does not count as being present today.
export async function onShiftNow(tx: Tx, workerId: string, now = new Date()) {
  const open = await openAttendance(tx, workerId);
  if (!open) return null;
  const { end } = shiftWindow(open.shift, open.checkInAt ?? now);
  return now.getTime() <= end.getTime() + GRACE ? open : null;
}

export async function checkIn(tx: Tx, input: { workerId: string; shiftId: string }, actor: Actor) {
  const worker = await tx.worker.findUnique({ where: { id: input.workerId } });
  ensure(worker?.active, 'Worker is not available.', 404);
  const shift = await tx.shift.findUnique({ where: { id: input.shiftId } });
  ensure(shift, 'Shift not found.', 404);

  const now = new Date();
  const { start, end, date } = shiftWindow(shift, now);
  ensure(now >= new Date(start.getTime() - GRACE), `${shift.name} starts at ${shift.startHour}:00. Check-in opens an hour before.`);
  ensure(now <= end, `${shift.name} has already ended. Pick the current shift.`);

  const open = await openAttendance(tx, worker.id);
  ensure(!open, `${worker.name} is already checked in (${open?.shift.name}). Check them out first.`);
  // Coming back after a check-out on the same shift day reopens that record; hours add up.
  const existing = await tx.attendance.findUnique({ where: { workerId_date: { workerId: worker.id, date } } });
  const attendance = existing
    ? await tx.attendance.update({ where: { id: existing.id }, data: { shiftId: shift.id, status: 'PRESENT', checkInAt: now, checkOutAt: null, recordedBy: actor.name } })
    : await tx.attendance.create({ data: { workerId: worker.id, shiftId: shift.id, date, hours: 0, status: 'PRESENT', checkInAt: now, recordedBy: actor.name } });
  await audit(tx, actor, 'attendance.checkin', worker.id, `${worker.name} checked ${existing ? 'back ' : ''}in · ${shift.name}`);
  return attendance;
}

// Checking out closes the record, works out the hours and the day's wage.
export async function checkOut(tx: Tx, attendanceId: string, actor: Actor) {
  const attendance = await tx.attendance.findUnique({ where: { id: attendanceId }, include: { worker: true, shift: true } });
  ensure(attendance, 'Attendance record not found.', 404);
  ensure(attendance.checkInAt && !attendance.checkOutAt, `${attendance.worker.name} is not checked in.`);

  const now = new Date();
  const session = Math.round(((now.getTime() - attendance.checkInAt.getTime()) / HOUR) * 4) / 4;
  const hours = D(Math.min(16, Math.max(0, session) + attendance.hours.toNumber()));
  const wage = await wageFor(tx, attendance.worker, hours, attendance.date);

  // Nobody can be running a machine after they have left: the job is paused and the machine freed.
  // The supervisor hands it over to the next shift, or the manager reassigns it.
  const running = await tx.jobCard.findMany({ where: { workerId: attendance.workerId, status: 'IN_PROGRESS' }, include: { production: true } });
  for (const job of running) {
    await tx.jobCard.update({ where: { id: job.id }, data: { status: 'PAUSED' } });
    if (job.machineId) await tx.machine.updateMany({ where: { id: job.machineId, status: 'RUNNING' }, data: { status: 'IDLE', reportedAt: new Date() } });
    await tx.workerAssignment.updateMany({ where: { jobId: job.id, endedAt: null }, data: { endedAt: now } });
    await tx.machineAssignment.updateMany({ where: { jobId: job.id, endedAt: null }, data: { endedAt: now } });
    await audit(tx, actor, 'production.pause', job.productionId, `${job.production.number} · ${job.stage.toLowerCase()} paused: ${attendance.worker.name} checked out`);
    await notify(tx, {
      roles: managers,
      title: `${job.production.number} paused: operator checked out`,
      message: `${attendance.worker.name} left the ${job.stage.toLowerCase()} job. Hand it over to the next shift or reassign it.`,
      category: 'PRODUCTION',
      link: '/production',
      skipUserId: actor.id,
    });
  }

  const updated = await tx.attendance.update({
    where: { id: attendanceId },
    data: {
      checkOutAt: now,
      hours,
      wage: { upsert: { create: wage, update: wage } },
    },
  });
  await audit(tx, actor, 'attendance.checkout', attendance.workerId, `${attendance.worker.name} checked out · ${hours.toString()} h`);
  return updated;
}

// Approved extra hours on an open shift (overtime or a shift extension).
export async function addOvertime(tx: Tx, attendanceId: string, input: { extraHours: number; reason: string }, actor: Actor) {
  const attendance = await tx.attendance.findUnique({ where: { id: attendanceId }, include: { worker: true } });
  ensure(attendance, 'Attendance record not found.', 404);
  ensure(attendance.status === 'PRESENT', 'Overtime can only be added for a present worker.');
  const updated = await tx.attendance.update({
    where: { id: attendanceId },
    data: { overtimeHours: { increment: input.extraHours }, note: `${attendance.note} Overtime ${input.extraHours} h: ${input.reason}.`.trim() },
  });
  await audit(tx, actor, 'attendance.overtime', attendance.workerId, `${attendance.worker.name} +${input.extraHours} h overtime: ${input.reason}`);
  return updated;
}

// A supervisor fixes a wrong record (forgotten check-out, wrong status). Always audited.
export async function correctAttendance(tx: Tx, attendanceId: string, input: { hours: number; status: string; reason: string }, actor: Actor) {
  const attendance = await tx.attendance.findUnique({ where: { id: attendanceId }, include: { worker: true } });
  ensure(attendance, 'Attendance record not found.', 404);
  ensure(input.status === 'PRESENT' || input.hours === 0, 'Absent workers must have zero hours.');
  const hours = D(input.hours);
  const wage = await wageFor(tx, attendance.worker, hours, attendance.date);
  const updated = await tx.attendance.update({
    where: { id: attendanceId },
    data: {
      hours,
      status: input.status,
      checkOutAt: attendance.checkOutAt ?? (attendance.checkInAt ? new Date() : null),
      note: `${attendance.note} Corrected by ${actor.name}: ${input.reason}.`.trim(),
      wage: { upsert: { create: wage, update: wage } },
    },
  });
  await audit(tx, actor, 'attendance.corrected', attendance.workerId, `${attendance.worker.name} · ${input.status.toLowerCase()} ${input.hours} h · ${input.reason}`);
  return updated;
}

async function wageFor(tx: Tx, worker: { id: string; rate: { mul(v: unknown): unknown }; wageType: string }, hours: { toNumber(): number }, day: Date) {
  const entries = await tx.productionEntry.findMany({
    where: { job: { workerId: worker.id }, createdAt: { gte: day, lt: new Date(day.getTime() + 24 * HOUR) } },
  });
  const metres = sum(entries.map((e) => e.quantity));
  const amount = (worker.wageType === 'HOURLY' ? worker.rate.mul(hours) : worker.rate.mul(metres)) as never;
  return {
    workerId: worker.id,
    amount,
    calculation: worker.wageType === 'HOURLY' ? `${hours.toString()} hours × rate` : `${metres.toString()} metres × rate`,
  };
}

// Who is scheduled and present on the current shift, for the supervisor dashboard.
export async function shiftBoard(now = new Date()) {
  const shifts = await db.shift.findMany({ orderBy: { startHour: 'asc' } });
  const shift = shifts.find((s) => shiftState(s, now) === 'CURRENT') ?? null;
  const open = await db.attendance.findMany({
    where: { checkInAt: { not: null }, checkOutAt: null },
    include: { worker: { select: { id: true, name: true, designation: true } }, shift: { select: { id: true, name: true } } },
  });
  return {
    current: shift ? { id: shift.id, name: shift.name, ...shiftWindow(shift, now) } : null,
    shifts: shifts.map((s) => ({ id: s.id, name: s.name, startHour: s.startHour, hours: s.hours.toString(), state: shiftState(s, now) })),
    checkedIn: open.map((a) => ({ attendanceId: a.id, worker: a.worker, shift: a.shift, since: a.checkInAt })),
  };
}
