import { db, type Tx } from '@loomos/db';
import { audit, D, ensure, sum, type Actor } from '../lib/domain.js';

export async function buyerPayment(tx: Tx, id: string, input: { amount: number; reference: string }, actor: Actor) {
  const invoice = await tx.invoice.findUnique({ where: { id }, include: { payments: true } });
  ensure(invoice, 'Invoice not found.', 404);
  ensure(invoice.status !== 'VOID', 'A void invoice cannot receive payments.');

  const paid = sum(invoice.payments.map((p) => p.amount)).plus(input.amount);
  ensure(paid.lte(invoice.total), 'Payment exceeds the outstanding balance.');

  const payment = await tx.buyerPayment.create({ data: { invoiceId: id, ...input } });
  await tx.invoice.update({ where: { id }, data: { status: paid.eq(invoice.total) ? 'PAID' : 'PARTIAL' } });
  await audit(tx, actor, 'finance.payment', id, `${D(input.amount).toFixed(2)} received against ${invoice.number}`);
  return payment;
}

export async function financialReport(month?: string) {
  const from = month ? new Date(`${month}-01T00:00:00+05:30`) : undefined;
  const until = from ? new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1) - 330 * 60000) : undefined;
  const end = month
    ? new Date(`${Number(month.slice(5)) === 12 ? Number(month.slice(0, 4)) + 1 : month.slice(0, 4)}-${String(Number(month.slice(5)) === 12 ? 1 : Number(month.slice(5)) + 1).padStart(2, '0')}-01T00:00:00+05:30`)
    : until;
  const createdAt = from ? { gte: from, lt: end } : undefined;

  const [invoices, payments, costs, expenses, bills, wages, supplierPayments, orders] = await Promise.all([
    db.invoice.findMany({ where: { status: { not: 'VOID' }, createdAt }, include: { payments: true, shipment: { include: { order: { include: { buyer: true } } } } } }),
    db.buyerPayment.findMany({ where: { createdAt } }),
    db.costAllocation.findMany({ where: { createdAt } }),
    db.operatingExpense.findMany({ where: { createdAt } }),
    db.supplierBill.findMany({ include: { payments: true, receipt: { include: { lot: { include: { supplier: true } } } } } }),
    db.wageEntry.findMany({ include: { worker: true, attendance: true } }),
    db.supplierPayment.findMany({ where: { createdAt } }),
    db.salesOrder.findMany({ include: { buyer: true, items: true, costs: true, shipments: { include: { invoice: true } } } }),
  ]);

  const billed = sum(invoices.map((i) => i.total));
  const received = sum(payments.map((p) => p.amount));
  const cost = sum(costs.map((c) => c.amount));
  const overhead = sum(expenses.map((e) => e.amount));

  return {
    billed,
    received,
    cost,
    expenses: overhead,
    outstanding: sum(invoices.map((i) => i.total.minus(sum(i.payments.map((p) => p.amount))))),
    estimatedProfit: billed.minus(cost).minus(overhead),
    cashMovement: received.minus(sum(supplierPayments.map((p) => p.amount))).minus(sum(wages.filter((w) => w.paidAt && (!from || w.paidAt >= from) && (!end || w.paidAt < end)).map((w) => w.amount))).minus(overhead),
    invoices: invoices.map((i) => ({ id: i.id, number: i.number, buyer: i.shipment.order.buyer.name, order: i.shipment.order.number, total: i.total, paid: sum(i.payments.map((p) => p.amount)), status: i.status, createdAt: i.createdAt })),
    bills: bills.map((b) => ({ id: b.id, supplier: b.receipt.lot.supplier.name, reference: b.receipt.reference, total: b.total, paid: sum(b.payments.map((p) => p.amount)), dueAt: b.dueAt })),
    wages: sum(wages.map((w) => w.amount)),
    costBreakdown: ['MATERIAL', 'LABOUR', 'MACHINE', 'OVERHEAD', 'REWORK'].map((category) => ({ category, amount: sum(costs.filter((c) => c.category === category).map((c) => c.amount)) })),
    orders: orders.map((o) => ({ id: o.id, number: o.number, buyer: o.buyer.name, estimatedRevenue: sum(o.items.map((i) => i.price.mul(i.quantity))), billed: sum(o.shipments.filter((s) => s.invoice && s.invoice.status !== 'VOID').map((s) => s.invoice!.total)), actualCost: sum(o.costs.map((c) => c.amount)), margin: sum(o.shipments.filter((s) => s.invoice && s.invoice.status !== 'VOID').map((s) => s.invoice!.total)).minus(sum(o.costs.map((c) => c.amount))) })),
  };
}
