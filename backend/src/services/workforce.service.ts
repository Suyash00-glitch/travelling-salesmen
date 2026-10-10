import type { Tx } from '@loomos/db';
import { audit, businessDay, D, ensure, sum, type Actor } from '../lib/domain.js';

export async function recordAttendance(tx: Tx, input: { workerId: string; shiftId: string; date: string; hours: number; status: string }, actor: Actor) {
  const worker = await tx.worker.findUnique({ where: { id: input.workerId } });
  ensure(worker?.active, 'Worker is not available.', 404);

  const shift = await tx.shift.findUnique({ where: { id: input.shiftId } });
  ensure(shift, 'Shift not found.', 404);
  ensure(D(input.hours).lte(shift.hours), 'Attendance hours cannot exceed the shift duration.');
  ensure(input.status === 'PRESENT' || input.hours === 0, 'Absent workers must have zero hours.');
  ensure(new Date(input.date).getTime() <= Date.now(), 'Future attendance cannot be recorded.');

  const day = businessDay(new Date(`${input.date}T12:00:00+05:30`));
  const entries = await tx.productionEntry.findMany({ where: { job: { workerId: worker.id }, createdAt: { gte: day, lt: new Date(day.getTime() + 86400000) } } });
  const quantity = sum(entries.map((e) => e.quantity));
  const amount = input.status === 'PRESENT' ? worker.rate.mul(worker.wageType === 'HOURLY' ? D(input.hours) : quantity) : D(0);

  const attendance = await tx.attendance.create({
    data: {
      ...input,
      date: new Date(input.date),
      wage: {
        create: {
          workerId: worker.id,
          amount,
          calculation: worker.wageType === 'HOURLY' ? `${input.hours} hours × ${worker.rate} / hour` : `${quantity} metres × ${worker.rate} / metre; one worker-day snapshot`,
        },
      },
    },
  });
  await audit(tx, actor, 'workforce.attendance', worker.id, `${worker.name} · ${input.hours} hours recorded`);
  return attendance;
}
