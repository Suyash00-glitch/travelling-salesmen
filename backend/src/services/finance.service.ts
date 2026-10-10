import { db, Prisma, type Tx } from '@loomos/db';
import { audit, code, D, ensure, sum, type Actor } from '../lib/domain.js';

// Accounts: buyer payments, supplier bills, expenses and claims. All numbers come from the database.

const DAY = 86400000;

// Money still owed on an invoice after payments and approved claim credits.
const outstandingOf = (i: { total: Prisma.Decimal; adjustment: Prisma.Decimal; payments: { amount: Prisma.Decimal }[] }) =>
  Prisma.Decimal.max(i.total.minus(i.adjustment).minus(sum(i.payments.map((p) => p.amount))), 0);

export async function buyerPayment(tx: Tx, id: string, input: { amount: number; reference: string }, actor: Actor) {
  const invoice = await tx.invoice.findUnique({ where: { id }, include: { payments: true } });
  ensure(invoice, 'Invoice not found.', 404);
  ensure(invoice.status !== 'VOID', 'A void invoice cannot receive payments.');
  ensure(!(await tx.buyerPayment.findUnique({ where: { reference: input.reference } })), 'A payment with this reference has already been recorded.');

  const due = outstandingOf(invoice);
  ensure(D(input.amount).lte(due), `Payment exceeds the outstanding balance of ₹${due.toFixed(2)}.`);

  const payment = await tx.buyerPayment.create({ data: { invoiceId: id, ...input } });
  await tx.invoice.update({ where: { id }, data: { status: D(input.amount).eq(due) ? 'PAID' : 'PARTIAL' } });
  await audit(tx, actor, 'finance.payment', id, `${D(input.amount).toFixed(2)} received against ${invoice.number}`);
  return payment;
}

export async function createClaim(
  tx: Tx,
  input: { party: string; buyerId?: string; supplierId?: string; orderId?: string; invoiceId?: string; amount: number; reason: string },
  actor: Actor,
) {
  if (input.invoiceId) ensure(await tx.invoice.findUnique({ where: { id: input.invoiceId } }), 'Invoice not found.', 404);
  if (input.orderId) ensure(await tx.salesOrder.findUnique({ where: { id: input.orderId } }), 'Order not found.', 404);
  const claim = await tx.claim.create({
    data: {
      number: code('CLM'),
      party: input.party,
      buyerId: input.party === 'BUYER' ? input.buyerId : null,
      supplierId: input.party === 'SUPPLIER' ? input.supplierId : null,
      orderId: input.orderId || null,
      invoiceId: input.invoiceId || null,
      amount: input.amount,
      reason: input.reason,
      createdBy: actor.name,
    },
  });
  await audit(tx, actor, 'finance.claim', claim.id, `${claim.number} · ₹${input.amount} · ${input.reason}`);
  return claim;
}

// Approving a buyer claim against an invoice credits that invoice, so less is owed.
export async function decideClaim(tx: Tx, id: string, input: { decision: string; note: string }, actor: Actor) {
  const claim = await tx.claim.findUnique({ where: { id }, include: { invoice: { include: { payments: true } } } });
  ensure(claim, 'Claim not found.', 404);
  ensure(claim.status === 'PENDING' || (claim.status === 'APPROVED' && input.decision === 'RESOLVED'), 'This claim has already been decided.');

  if (input.decision === 'APPROVED' && claim.status === 'PENDING' && claim.party === 'BUYER' && claim.invoice) {
    const room = outstandingOf(claim.invoice);
    ensure(claim.amount.lte(room.plus(claim.invoice.adjustment)), 'The claim is larger than the invoice balance. Record a refund instead.');
    const updated = await tx.invoice.update({ where: { id: claim.invoice.id }, data: { adjustment: { increment: claim.amount } }, include: { payments: true } });
    if (outstandingOf(updated).lte(0)) await tx.invoice.update({ where: { id: updated.id }, data: { status: 'PAID' } });
  }

  const result = await tx.claim.update({
    where: { id },
    data: { status: input.decision, note: input.note, decidedBy: actor.name, decidedAt: new Date() },
  });
  await audit(tx, actor, `finance.claim.${input.decision.toLowerCase()}`, id, `${claim.number} ${input.decision.toLowerCase()}${input.note ? `: ${input.note}` : ''}`);
  return result;
}

export async function financialReport(month?: string) {
  const from = month ? new Date(`${month}-01T00:00:00+05:30`) : undefined;
  const end = from ? new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1) - 330 * 60000) : undefined;
  const createdAt = from ? { gte: from, lt: end } : undefined;
  const now = new Date();

  const [invoices, payments, costs, expenses, bills, wages, supplierPayments, orders, claims] = await Promise.all([
    db.invoice.findMany({ where: { status: { not: 'VOID' }, createdAt }, include: { payments: true, shipment: { include: { order: { include: { buyer: true } } } } } }),
    db.buyerPayment.findMany({ where: { createdAt }, include: { invoice: { include: { shipment: { include: { order: { include: { buyer: true } } } } } } }, orderBy: { createdAt: 'desc' } }),
    db.costAllocation.findMany({ where: { createdAt } }),
    db.operatingExpense.findMany({ where: { createdAt }, orderBy: { createdAt: 'desc' } }),
    db.supplierBill.findMany({ include: { payments: true, receipt: { include: { lot: { include: { supplier: true } } } } } }),
    db.wageEntry.findMany({ include: { worker: true, attendance: true } }),
    db.supplierPayment.findMany({ where: { createdAt } }),
    db.salesOrder.findMany({ include: { buyer: true, items: true, costs: true, shipments: { include: { invoice: true } } } }),
    db.claim.findMany({ include: { buyer: true, supplier: true, invoice: { select: { number: true } }, order: { select: { number: true } } }, orderBy: { createdAt: 'desc' } }),
  ]);

  const billed = sum(invoices.map((i) => i.total));
  const received = sum(payments.map((p) => p.amount));
  const cost = sum(costs.map((c) => c.amount));
  const overhead = sum(expenses.map((e) => e.amount));
  const openInvoices = invoices.filter((i) => outstandingOf(i).gt(0));
  const overdue = openInvoices.filter((i) => (i.dueAt ?? new Date(i.createdAt.getTime() + 30 * DAY)) < now);

  return {
    billed,
    received,
    cost,
    expenses: overhead,
    outstanding: sum(openInvoices.map(outstandingOf)),
    overdue: sum(overdue.map(outstandingOf)),
    overdueCount: overdue.length,
    pendingInvoices: openInvoices.length,
    pendingClaims: claims.filter((c) => c.status === 'PENDING').length,
    pendingClaimAmount: sum(claims.filter((c) => c.status === 'PENDING').map((c) => c.amount)),
    estimatedProfit: billed.minus(cost).minus(overhead),
    cashMovement: received.minus(sum(supplierPayments.map((p) => p.amount))).minus(sum(wages.filter((w) => w.paidAt && (!from || w.paidAt >= from) && (!end || w.paidAt < end)).map((w) => w.amount))).minus(overhead),
    invoices: invoices.map((i) => ({
      id: i.id, number: i.number, buyer: i.shipment.order.buyer.name, buyerId: i.shipment.order.buyerId, order: i.shipment.order.number, challan: i.shipment.number,
      total: i.total, adjustment: i.adjustment, paid: sum(i.payments.map((p) => p.amount)), outstanding: outstandingOf(i),
      status: i.status, createdAt: i.createdAt, dueAt: i.dueAt, overdue: outstandingOf(i).gt(0) && (i.dueAt ?? new Date(i.createdAt.getTime() + 30 * DAY)) < now,
    })),
    payments: payments.map((p) => ({ id: p.id, reference: p.reference, amount: p.amount, createdAt: p.createdAt, invoice: p.invoice.number, buyer: p.invoice.shipment.order.buyer.name, order: p.invoice.shipment.order.number })),
    bills: bills.map((b) => ({ id: b.id, supplier: b.receipt.lot.supplier.name, reference: b.receipt.reference, total: b.total, paid: sum(b.payments.map((p) => p.amount)), dueAt: b.dueAt })),
    expenseList: expenses,
    claims: claims.map((c) => ({ id: c.id, number: c.number, party: c.party, who: c.buyer?.name ?? c.supplier?.name ?? '—', order: c.order?.number ?? '', invoice: c.invoice?.number ?? '', amount: c.amount, reason: c.reason, status: c.status, note: c.note, createdAt: c.createdAt, createdBy: c.createdBy })),
    wages: sum(wages.map((w) => w.amount)),
    wageList: wages.map((w) => ({ id: w.id, worker: w.worker.name, amount: w.amount, calculation: w.calculation, paidAt: w.paidAt, date: w.attendance.date })),
    costBreakdown: ['MATERIAL', 'LABOUR', 'MACHINE', 'OVERHEAD', 'REWORK'].map((category) => ({ category, amount: sum(costs.filter((c) => c.category === category).map((c) => c.amount)) })),
    orders: orders.map((o) => ({ id: o.id, number: o.number, buyer: o.buyer.name, estimatedRevenue: sum(o.items.map((i) => i.price.mul(i.quantity))), billed: sum(o.shipments.filter((s) => s.invoice && s.invoice.status !== 'VOID').map((s) => s.invoice!.total)), actualCost: sum(o.costs.map((c) => c.amount)), margin: sum(o.shipments.filter((s) => s.invoice && s.invoice.status !== 'VOID').map((s) => s.invoice!.total)).minus(sum(o.costs.map((c) => c.amount))) })),
  };
}
