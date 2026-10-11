import { Router } from 'express';
import { db } from '@loomos/db';
import * as contracts from '@loomos/shared';
import { authorize } from '../middleware/auth.js';
import { code, audit } from '../lib/domain.js';
import { page, write } from '../lib/route-helpers.js';

export const procurementRouter = Router();

// List purchase orders
procurementRouter.get('/purchases', authorize('procurement'), async (req, res) => {
  const pos = await db.purchaseOrder.findMany({
    include: { supplier: true, receipts: true },
    orderBy: { createdAt: 'desc' },
  });
  res.json(page(req, pos));
});

// Create new purchase order
write(procurementRouter, '/purchases', ['procurement:create', 'procurement:manage'], contracts.purchaseSchema, async (tx, input, actor) => {
  const po = await tx.purchaseOrder.create({
    data: {
      ...input,
      number: code('PO'),
      expectedAt: new Date(input.expectedAt),
    },
  });
  await audit(tx, actor, 'procurement.created', po.id, `${po.number} · ${po.quantity} kg ordered`);
  return po;
});

// Create buyers
write(procurementRouter, '/buyers', 'orders:approve', contracts.partySchema, async (tx, input, actor) => {
  const buyer = await tx.buyer.create({
    data: {
      ...input,
      initials: input.name
        .split(' ')
        .slice(0, 2)
        .map((n) => n[0])
        .join(''),
    },
  });
  await audit(tx, actor, 'buyers.created', buyer.id, input.name);
  return buyer;
});

// Create suppliers
write(procurementRouter, '/suppliers', ['procurement:manage', 'inventory:manage'], contracts.partySchema, async (tx, input, actor) => {
  const supplier = await tx.supplier.create({
    data: input,
  });
  await audit(tx, actor, 'suppliers.created', supplier.id, input.name);
  return supplier;
});
