import { Router } from 'express';
import * as contracts from '@loomos/shared';
import { authorize } from '../middleware/auth.js';
import { id, write, reason } from '../lib/route-helpers.js';
import {
  machineSummaries,
  machineHistory,
  createMachine,
  updateMachine,
  setMachineActive,
  reportBreakdown,
  startMaintenance,
  recordRepair,
} from '../services/machine.service.js';

export const machinesRouter = Router();

machinesRouter.get('/', authorize('machines'), async (_req, res) => {
  res.json(await machineSummaries());
});

// Output, downtime and who ran the machine when
machinesRouter.get('/:id/history', authorize('machines'), async (req, res) => {
  res.json(await machineHistory(id(req)));
});

// Adding, editing and retiring machines: maintenance and administrators.
write(machinesRouter, '/', ['machines:create', 'settings:manage'], contracts.machineSchema, (tx, input, actor) => createMachine(tx, input, actor));

write(machinesRouter, '/:id/update', ['machines:manage', 'settings:manage'], contracts.machineUpdateSchema, (tx, input, actor, req) =>
  updateMachine(tx, id(req), input, actor),
);

write(machinesRouter, '/:id/deactivate', ['machines:manage', 'settings:manage'], reason, (tx, input, actor, req) =>
  setMachineActive(tx, id(req), false, input.reason, actor),
);

write(machinesRouter, '/:id/activate', ['machines:manage', 'settings:manage'], reason, (tx, input, actor, req) =>
  setMachineActive(tx, id(req), true, input.reason, actor),
);

// Anyone on the floor can report a breakdown (operators only for their own stage's machines).
write(machinesRouter, '/:id/breakdown', 'machines:update', reason, (tx, input, actor, req) =>
  reportBreakdown(tx, id(req), input.reason, actor),
);

// Maintenance decides when a machine is out of service and when it is fit to run again.
write(machinesRouter, '/:id/maintenance', 'machines:approve', reason, (tx, input, actor, req) =>
  startMaintenance(tx, id(req), input.reason, actor),
);

write(machinesRouter, '/:id/recover', 'machines:approve', reason, (tx, input, actor, req) =>
  recordRepair(tx, id(req), input.reason, actor),
);
