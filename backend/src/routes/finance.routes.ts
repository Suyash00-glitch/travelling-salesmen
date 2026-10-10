import { Router } from 'express';
import { z } from 'zod';
import * as contracts from '@loomos/shared';
import { authorize } from '../middleware/auth.js';
import { ensure, audit, sum } from '../lib/domain.js';
import { id, write, empty } from '../lib/route-helpers.js';
import { financialReport, buyerPayment, createClaim, decideClaim } from '../services/finance.service.js';

export const financeRouter = Router();

// Financial report breakdown
financeRouter.get('/reports/finance', authorize('finance'), async (req, res) => {
  const month = req.query.month
    ? z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).parse(req.query.month)
    : undefined;
  res.json(await financialReport(month));
});

// Pay wage entry
write(financeRouter, '/wages/:id/pay', 'finance:manage', empty, async (tx, _input, actor, req) => {
  const wage = await tx.wageEntry.findUnique({ where: { id: id(req) } });
  ensure(wage && !wage.paidAt, 'Wage is missing or already paid.');
  const result = await tx.wageEntry.update({
    where: { id: id(req) },
    data: { paidAt: new Date() },
  });
  await audit(tx, actor, 'finance.wage', wage.id, `${wage.amount} wage paid`);
  return result;
});

// Record buyer invoice payment
write(financeRouter, '/invoices/:id/payments', 'finance:manage', contracts.paymentSchema, (tx, input, actor, req) =>
  buyerPayment(tx, id(req), input, actor),
);

// Record supplier bill payment
write(financeRouter, '/bills/:id/payments', 'finance:manage', contracts.paymentSchema, async (tx, input, actor, req) => {
  const bill = await tx.supplierBill.findUnique({
    where: { id: id(req) },
    include: { payments: true },
  });
  ensure(bill, 'Bill not found.', 404);
  ensure(
    sum(bill.payments.map((p) => p.amount)).plus(input.amount).lte(bill.total),
    'Payment exceeds the outstanding bill.',
  );
  const payment = await tx.supplierPayment.create({
    data: { billId: bill.id, ...input },
  });
  await audit(tx, actor, 'finance.supplier_payment', bill.id, `${input.amount} paid to supplier`);
  return payment;
});

// Claims: money owed to or by a buyer or supplier
write(financeRouter, '/claims', 'finance:manage', contracts.claimSchema, (tx, input, actor) => createClaim(tx, input, actor));
write(financeRouter, '/claims/:id/decide', 'finance:manage', contracts.claimDecisionSchema, (tx, input, actor, req) =>
  decideClaim(tx, id(req), input, actor),
);

// Record operating expense
write(financeRouter, '/expenses', 'finance:manage', contracts.expenseSchema, async (tx, input, actor) => {
  const expense = await tx.operatingExpense.create({ data: { ...input, recordedBy: actor.name } });
  await audit(tx, actor, 'finance.expense', expense.id, input.description);
  return expense;
});
