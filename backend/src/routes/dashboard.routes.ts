import { Router } from 'express';
import { z } from 'zod';
import { db } from '@loomos/db';
import * as contracts from '@loomos/shared';
import { authorize } from '../middleware/auth.js';
import { dashboard, workInbox } from '../operations.js';
import { subscribe } from '../lib/events.js';

export const dashboardRouter = Router();

dashboardRouter.get('/lookups', async (req, res) => {
  if (req.actor.role === 'BUYER') {
    // Buyers need fabric choices to place an order, but never costing details.
    res.json({
      buyers: [],
      suppliers: [],
      recipes: await db.recipe.findMany({
        select: { id: true, name: true, material: true, specification: true, route: true },
      }),
      workers: [],
      shifts: [],
      machines: [],
    });
    return;
  }

  const [buyers, suppliers, recipes, workers, shifts, machines, factories, departments, roles] = await Promise.all([
    db.buyer.findMany(),
    db.supplier.findMany(),
    db.recipe.findMany(),
    db.worker.findMany({ where: { active: true }, select: { id: true, name: true, designation: true } }),
    db.shift.findMany(),
    db.machine.findMany({
      select: { id: true, name: true, code: true, type: true, status: true },
    }),
    db.factory.findMany({ where: { active: true }, select: { id: true, name: true, code: true } }),
    db.department.findMany({ where: { active: true }, select: { id: true, name: true, code: true, factoryId: true } }),
    db.role.findMany({ select: { id: true, name: true, code: true, isSystem: true } }),
  ]);

  res.json({
    buyers,
    suppliers,
    recipes: recipes.map((r) => ({
      ...r,
      overheadPerMetre: contracts.can(req.actor.role, 'finance')
        ? r.overheadPerMetre
        : undefined,
    })),
    workers,
    shifts,
    machines,
    factories,
    departments,
    roles,
  });
});

dashboardRouter.get('/dashboard', authorize('dashboard'), async (req, res) => {
  const date = req.query.date ? z.string().date().parse(req.query.date) : undefined;
  res.json(await dashboard(req.actor, date));
});

// Team inbox first (work handed to you), then factory alerts
dashboardRouter.get('/notifications', authorize('dashboard'), async (req, res) => {
  const [work, { alerts }] = await Promise.all([workInbox(req.actor), dashboard(req.actor)]);
  res.json([...work, ...alerts]);
});

// Live update stream: the browser refreshes its data whenever anything changes
dashboardRouter.get('/events', (_req, res) => {
  subscribe(res);
});
