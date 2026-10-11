import { db, type Tx } from '@loomos/db';
import { factoryToday, type ShiftInput } from '@loomos/shared';
import { audit, businessDay, calendarDate, D, dayStart, ensure, sum, type Actor } from '../lib/domain.js';
import { notify, managers } from './notification.service.js';

// Shifts and attendance. The shift supervisor checks workers in and out; production can only
// start for workers who are checked in. A shift is identified by its start hour and length,
// so night shifts (e.g. 22:00 + 8 h) simply run past midnight.

const HOUR = 3600000;
const DAY = 24 * HOUR;
const GRACE = 60 * 60000; // check-in allowed up to an hour before the shift starts

interface ShiftRow { id: string; name: string; startHour: number; hours: { toNumber(): number } }

// The most recent start of a shift at or before `now`, and its end. `date` is the calendar day
// the shift started on (attendance is filed under it).
export function shiftWindow(shift: ShiftRow, now = new Date()) {
  const start = new Date(businessDay(now).getTime() + shift.startHour * HOUR);
  if (start.getTime() > now.getTime() + GRACE) start.setTime(start.getTime() - DAY);
  const end = new Date(start.getTime() + shift.hours.toNumber() * HOUR);
  return { start, end, date: calendarDate(start) };
}

export function shiftState(shift: ShiftRow, now = new Date()) {
  const { start, end } = shiftWindow(shift, now);
  if (now < start) return 'UPCOMING';
  if (now > end) return 'COMPLETED';
  return 'CURRENT';
}

export async function currentShift(now = new Date()) {
  const shifts = await db.shift.findMany({ where: { active: true }, orderBy: { startHour: 'asc' } });
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
  ensure(shift?.active, 'Shift not found.', 404);

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
  const wage = await wageFor(tx, attendance.worker, hours.plus(attendance.overtimeHours), attendance.date);

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
  const wage = await wageFor(tx, attendance.worker, input.status === 'PRESENT' ? hours.plus(attendance.overtimeHours) : D(0), attendance.date);
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

// Hourly workers are paid for hours (overtime included); piece-rate workers for the metres
// they produced during that shift day.
async function wageFor(tx: Tx, worker: { id: string; rate: { mul(v: unknown): unknown }; wageType: string }, hours: { toNumber(): number }, day: Date) {
  const from = dayStart(day);
  const entries = await tx.productionEntry.findMany({
    where: { job: { workerId: worker.id }, createdAt: { gte: from, lt: new Date(from.getTime() + DAY + 8 * HOUR) } },
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
  const shifts = await db.shift.findMany({ where: { active: true }, orderBy: { startHour: 'asc' } });
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

// ==================== SHIFT SET-UP (administrators) ====================

export async function createShift(tx: Tx, input: ShiftInput, actor: Actor) {
  ensure(!(await tx.shift.findFirst({ where: { name: { equals: input.name, mode: 'insensitive' }, active: true } })), 'A shift with this name already exists.');
  const shift = await tx.shift.create({ data: input });
  await audit(tx, actor, 'shift.created', shift.id, `${shift.name} · ${String(shift.startHour).padStart(2, '0')}:00 for ${input.hours} h`);
  return shift;
}

export async function updateShift(tx: Tx, id: string, input: Partial<ShiftInput> & { active?: boolean }, actor: Actor) {
  const shift = await tx.shift.findUnique({ where: { id } });
  ensure(shift, 'Shift not found.', 404);
  if (input.active === false || input.startHour !== undefined || input.hours !== undefined) {
    const open = await tx.attendance.count({ where: { shiftId: id, checkInAt: { not: null }, checkOutAt: null } });
    ensure(!open, `${open} worker(s) are checked in on ${shift.name}. Check them out before changing the shift.`);
  }
  const updated = await tx.shift.update({ where: { id }, data: input });
  await audit(tx, actor, 'shift.updated', id, `${updated.name} · ${String(updated.startHour).padStart(2, '0')}:00 for ${updated.hours.toString()} h${updated.active ? '' : ' · retired'}`);
  return updated;
}

// ==================== SHIFT REPORT ====================

const dayFormat = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short' });
const dayLabel = (d: Date) => dayFormat.format(d);
const eventKinds = ['production.', 'machine.', 'attendance.', 'quality.', 'shipment.', 'dispatch.', 'inventory.received'];

// What happened in every shift of one day: who worked, what was made where, breakdowns,
// inspections, wages and a timeline. Plus metres per shift for the seven days up to that day.
export async function shiftReport(ymd = factoryToday(), now = new Date()) {
  const dayIst = new Date(`${ymd}T00:00:00+05:30`);
  const shifts = await db.shift.findMany({ orderBy: { startHour: 'asc' } });
  const windowOf = (s: (typeof shifts)[number], day: Date) => {
    const start = new Date(day.getTime() + s.startHour * HOUR);
    return { start, end: new Date(start.getTime() + s.hours.toNumber() * HOUR) };
  };
  const windows = shifts.map((s) => ({ shift: s, ...windowOf(s, dayIst) }));
  const from = new Date(Math.min(dayIst.getTime(), ...windows.map((w) => w.start.getTime())));
  const to = new Date(Math.max(dayIst.getTime() + DAY, ...windows.map((w) => w.end.getTime())));
  const range = { gte: from, lt: to };

  const [attendance, entries, started, finished, breakdowns, inspections, logs] = await Promise.all([
    db.attendance.findMany({ where: { date: new Date(`${ymd}T00:00:00Z`) }, include: { worker: true, wage: true }, orderBy: { checkInAt: 'asc' } }),
    db.productionEntry.findMany({ where: { createdAt: range }, include: { job: { select: { stage: true, machine: { select: { code: true } } } } } }),
    db.jobCard.findMany({ where: { startedAt: range }, select: { startedAt: true } }),
    db.jobCard.findMany({ where: { endedAt: range, status: 'COMPLETED' }, select: { endedAt: true } }),
    db.downtimeEvent.findMany({ where: { startedAt: range, kind: 'BREAKDOWN' }, include: { machine: { select: { code: true } } } }),
    db.qualityInspection.findMany({ where: { createdAt: range }, select: { result: true, createdAt: true } }),
    db.auditLog.findMany({ where: { createdAt: range, OR: eventKinds.map((k) => ({ action: { startsWith: k } })) }, orderBy: { createdAt: 'asc' } }),
  ]);
  const inside = (at: Date | null, w: { start: Date; end: Date }) => Boolean(at && at >= w.start && at < w.end);

  const report = windows
    .filter((w) => w.shift.active || attendance.some((a) => a.shiftId === w.shift.id))
    .map((w) => {
      const people = attendance.filter((a) => a.shiftId === w.shift.id);
      const made = entries.filter((e) => inside(e.createdAt, w));
      const machines = new Map<string, { code: string; stage: string; output: number; hours: number }>();
      for (const e of made) {
        const key = e.job.machine?.code ?? 'Floor';
        const row = machines.get(key) ?? { code: key, stage: e.job.stage, output: 0, hours: 0 };
        row.output += e.quantity.toNumber();
        row.hours += e.hours.toNumber();
        machines.set(key, row);
      }
      const checks = inspections.filter((i) => inside(i.createdAt, w));
      const state: 'UPCOMING' | 'CURRENT' | 'COMPLETED' = now < w.start ? 'UPCOMING' : now >= w.end ? 'COMPLETED' : 'CURRENT';
      return {
        id: w.shift.id,
        name: w.shift.name,
        start: w.start.toISOString(),
        end: w.end.toISOString(),
        state,
        present: people.filter((a) => a.status === 'PRESENT').map((a) => ({
          worker: a.worker.name,
          designation: a.worker.designation,
          checkInAt: a.checkInAt?.toISOString() ?? null,
          checkOutAt: a.checkOutAt?.toISOString() ?? null,
          hours: a.hours.toNumber(),
          overtime: a.overtimeHours.toNumber(),
          status: a.status,
        })),
        absent: people.filter((a) => a.status !== 'PRESENT').length,
        output: sum(made.map((e) => e.quantity)).toNumber(),
        waste: sum(made.map((e) => e.waste)).toNumber(),
        byStage: ['SPINNING', 'WEAVING', 'DYEING'].map((stage) => ({ stage, output: sum(made.filter((e) => e.job.stage === stage).map((e) => e.quantity)).toNumber() })),
        byMachine: [...machines.values()].sort((a, b) => a.code.localeCompare(b.code)),
        started: started.filter((j) => inside(j.startedAt, w)).length,
        finished: finished.filter((j) => inside(j.endedAt, w)).length,
        breakdowns: breakdowns.filter((b) => inside(b.startedAt, w)).map((b) => ({ machine: b.machine.code, reason: b.reason, at: b.startedAt.toISOString(), resolved: Boolean(b.endedAt) })),
        inspections: {
          passed: checks.filter((i) => i.result === 'PASSED').length,
          rework: checks.filter((i) => i.result === 'REWORK').length,
          rejected: checks.filter((i) => i.result === 'REJECTED').length,
        },
        wages: sum(people.map((a) => a.wage?.amount ?? D(0))).toNumber(),
        events: logs.filter((l) => inside(l.createdAt, w)).slice(-40).reverse().map((l) => ({ at: l.createdAt.toISOString(), text: l.detail, who: l.actorName, kind: l.action.split('.')[0] })),
      };
    });

  // Seven days of output, split by shift.
  const active = shifts.filter((s) => s.active);
  const firstDay = new Date(dayIst.getTime() - 6 * DAY);
  const weekEntries = await db.productionEntry.findMany({
    where: { createdAt: { gte: firstDay, lt: to } },
    select: { quantity: true, createdAt: true },
  });
  const week = Array.from({ length: 7 }, (_, i) => {
    const day = new Date(firstDay.getTime() + i * DAY);
    const row: Record<string, string | number> = { date: day.toISOString(), label: dayLabel(day) };
    for (const s of active) {
      const w = windowOf(s, day);
      row[s.name] = sum(weekEntries.filter((e) => inside(e.createdAt, w)).map((e) => e.quantity)).toNumber();
    }
    return row;
  });

  return { date: ymd, shifts: report, week, shiftNames: active.map((s) => s.name) };
}
