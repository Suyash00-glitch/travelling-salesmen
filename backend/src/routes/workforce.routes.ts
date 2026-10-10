import { Router } from 'express';
import { db } from '@loomos/db';
import * as contracts from '@loomos/shared';
import { authorize } from '../middleware/auth.js';
import { audit } from '../lib/domain.js';
import { page, write } from '../lib/route-helpers.js';
import { recordAttendance } from '../services/workforce.service.js';

export const workforceRouter = Router();

// List workers with attendance and current job assignments
workforceRouter.get('/workers', authorize('workforce'), async (req, res) => {
  const workers = await db.worker.findMany({
    include: {
      attendance: {
        include: { shift: true, wage: true },
        orderBy: { date: 'desc' },
        take: 30,
      },
      assignments: {
        where: { endedAt: null },
        include: { job: { include: { machine: true } } },
      },
    },
    orderBy: { name: 'asc' },
  });

  res.json(
    page(
      req,
      workers.map((w) => ({
        ...w,
        rate: contracts.can(req.actor.role, 'finance') ? w.rate : undefined,
        attendance: w.attendance.map((a) => ({
          ...a,
          wage: contracts.can(req.actor.role, 'finance') ? a.wage : undefined,
        })),
      })),
    ),
  );
});

// Register worker profile
write(workforceRouter, '/workers', 'settings', contracts.workerSchema, async (tx, input, actor) => {
  const worker = await tx.worker.create({
    data: {
      ...input,
      initials: input.name
        .split(' ')
        .slice(0, 2)
        .map((s) => s[0])
        .join(''),
    },
  });
  await audit(tx, actor, 'workforce.created', worker.id, worker.name);
  return worker;
});

// Log shift attendance
write(workforceRouter, '/attendance', 'workforce', contracts.attendanceSchema, (tx, input, actor) =>
  recordAttendance(tx, input, actor),
);
