import { Router } from 'express';
import { db } from '@loomos/db';
import * as contracts from '@loomos/shared';
import { authorize } from '../middleware/auth.js';
import { audit } from '../lib/domain.js';
import { page, write, id, empty } from '../lib/route-helpers.js';
import { checkIn, checkOut, addOvertime, correctAttendance, shiftBoard } from '../services/workforce.service.js';

export const workforceRouter = Router();

// List workers with recent attendance and current job assignments
workforceRouter.get('/workers', authorize('workforce'), async (req, res) => {
  const showPay = contracts.can(req.actor, 'finance');
  const workers = await db.worker.findMany({
    include: {
      department: { select: { name: true } },
      attendance: { include: { shift: true, wage: true }, orderBy: { date: 'desc' }, take: 14 },
      assignments: { where: { endedAt: null }, include: { job: { include: { machine: true, production: { select: { number: true } } } } } },
    },
    orderBy: { name: 'asc' },
  });
  res.json(
    page(
      req,
      workers.map((w) => ({
        ...w,
        rate: showPay ? w.rate : undefined,
        attendance: w.attendance.map((a) => ({ ...a, wage: showPay ? a.wage : undefined })),
      })),
    ),
  );
});

// The current shift, who is checked in, and the state of every shift
workforceRouter.get('/shifts/board', authorize('workforce'), async (_req, res) => {
  res.json(await shiftBoard());
});

// Register worker profile
write(workforceRouter, '/workers', 'settings:manage', contracts.workerSchema, async (tx, input, actor) => {
  const worker = await tx.worker.create({
    data: {
      ...input,
      departmentId: input.departmentId || null,
      initials: input.name.split(' ').slice(0, 2).map((s) => s[0]).join(''),
    },
  });
  await audit(tx, actor, 'workforce.created', worker.id, worker.name);
  return worker;
});

// Attendance is the shift supervisor's job (and administrators').
write(workforceRouter, '/attendance/check-in', 'attendance:manage', contracts.checkInSchema, (tx, input, actor) =>
  checkIn(tx, input, actor),
);

write(workforceRouter, '/attendance/:id/check-out', 'attendance:manage', empty, (tx, _input, actor, req) =>
  checkOut(tx, id(req), actor),
);

write(workforceRouter, '/attendance/:id/overtime', 'attendance:manage', contracts.overtimeSchema, (tx, input, actor, req) =>
  addOvertime(tx, id(req), input, actor),
);

write(workforceRouter, '/attendance/:id/correct', 'attendance:manage', contracts.attendanceCorrectionSchema, (tx, input, actor, req) =>
  correctAttendance(tx, id(req), input, actor),
);
