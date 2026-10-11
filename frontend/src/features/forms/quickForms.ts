import { billCategories, expenseCategories, factoryToday, roleNames, roleDuties, type Lookups, type OrderSummary, type Role } from '@loomos/shared';
import type { FormSpec } from '../../components/shared/ActionForm';
import { label } from '../../lib/utils';

// Every "add something" form in one place. Pages and the top-bar New menu use the same forms,
// so a buyer, a machine or a bill is created the same way wherever you start.

const billCategoryLabels: Record<string, string> = { YARN: 'Yarn', DYES_CHEMICALS: 'Dyes & chemicals', SPARES: 'Spare parts', POWER: 'Power', TRANSPORT: 'Transport', SERVICES: 'Services', OTHER: 'Other' };
export const billCategoryLabel = (c: string) => billCategoryLabels[c] ?? label(c);

export function buyerForm(): FormSpec {
  return {
    title: 'Add a buyer',
    description: 'A customer company. Their staff can then sign up for the buyer portal.',
    path: '/buyers',
    fields: [
      { name: 'name', label: 'Company name' },
      { name: 'email', label: 'Email', type: 'email' },
      { name: 'city', label: 'City' },
    ],
    submit: 'Add buyer',
  };
}

export function supplierForm(): FormSpec {
  return {
    title: 'Add a supplier',
    description: 'Yarn mills, dye houses, power, spares or transport: anyone who sends the mill a bill.',
    path: '/suppliers',
    fields: [
      { name: 'name', label: 'Supplier name' },
      { name: 'email', label: 'Email', type: 'email' },
      { name: 'city', label: 'City' },
    ],
    submit: 'Add supplier',
  };
}

export function workerForm(lookups: Lookups | undefined): FormSpec {
  return {
    title: 'Add a worker',
    description: 'Someone on the floor or in the office. The shift supervisor checks them in.',
    path: '/workers',
    fields: [
      { name: 'name', label: 'Full name' },
      { name: 'designation', label: 'Job', hint: 'e.g. Loom operator' },
      { name: 'departmentId', label: 'Department', type: 'select', required: false, options: (lookups?.departments ?? []).map((d) => ({ value: d.id, label: d.name })), hint: 'Operators can only run machines of their own department' },
      { name: 'wageType', label: 'Paid by', type: 'select', value: 'HOURLY', options: [{ value: 'HOURLY', label: 'The hour' }, { value: 'PIECE', label: 'Metres produced' }] },
      { name: 'rate', label: 'Rate (₹ per hour or per metre)', type: 'number', min: 0.01, value: 90 },
    ],
    submit: 'Add worker',
  };
}

export function shiftForm(shift?: { id: string; name: string; startHour: number; hours: string | number }): FormSpec {
  return {
    title: shift ? `Edit ${shift.name}` : 'Add a shift',
    description: 'A shift is a start time and a length. A night shift can run past midnight.',
    path: shift ? `/shifts/${shift.id}/update` : '/shifts',
    fields: [
      { name: 'name', label: 'Name', value: shift?.name ?? '', hint: 'e.g. General shift' },
      { name: 'startHour', label: 'Starts at (hour, 0–23)', type: 'number', min: 0, max: 23, step: '1', value: shift?.startHour ?? 9 },
      { name: 'hours', label: 'Length (hours)', type: 'number', min: 1, max: 16, value: Number(shift?.hours ?? 8) },
    ],
    submit: shift ? 'Save shift' : 'Add shift',
  };
}

export function retireShiftForm(shift: { id: string; name: string }): FormSpec {
  return {
    title: `Retire ${shift.name}`,
    description: 'The shift is no longer offered for check-in. Its history stays.',
    path: `/shifts/${shift.id}/update`,
    fields: [],
    transform: () => ({ active: false }),
    submit: 'Retire shift',
  };
}

export function machineForm(lookups: Lookups | undefined, machine?: { id: string; code: string; name: string; type: string; location: string; capacityPerHour: string; departmentId?: string | null }): FormSpec {
  return {
    title: machine ? `Edit ${machine.code}` : 'Add a machine',
    path: machine ? `/machines/${machine.id}/update` : '/machines',
    fields: [
      { name: 'code', label: 'Machine code', value: machine?.code ?? '', hint: 'e.g. LM-03' },
      { name: 'name', label: 'Name', value: machine?.name ?? '' },
      { name: 'type', label: 'Stage', type: 'select', value: machine?.type ?? '', options: ['SPINNING', 'WEAVING', 'DYEING'].map((t) => ({ value: t, label: label(t) })) },
      { name: 'location', label: 'Where on the floor', value: machine?.location ?? '' },
      { name: 'capacityPerHour', label: 'Capacity (m / hour)', type: 'number', min: 0.001, value: machine ? Number(machine.capacityPerHour) : 100 },
      { name: 'hourlyCost', label: 'Running cost (₹ / hour)', type: 'number', min: 0, value: 150 },
      { name: 'departmentId', label: 'Department', type: 'select', required: false, value: machine?.departmentId ?? '', options: (lookups?.departments ?? []).map((d) => ({ value: d.id, label: d.name })) },
    ],
    submit: machine ? 'Save changes' : 'Add machine',
  };
}

export function materialForm(): FormSpec {
  return {
    title: 'Add a fabric',
    description: 'A fabric buyers can order, the yarn it needs, and its fixed price.',
    path: '/recipes',
    fields: [
      { name: 'name', label: 'Fabric name', hint: 'e.g. Cotton poplin' },
      { name: 'pricePerMetre', label: 'Selling price per metre (₹)', type: 'number', min: 0.01 },
      { name: 'material', label: 'Yarn type', hint: 'e.g. Cotton yarn' },
      { name: 'specification', label: 'Yarn count / specification', hint: 'e.g. 40s combed' },
      { name: 'kgPerMetre', label: 'Yarn kg per metre', type: 'number', min: 0.001, value: 0.2 },
      { name: 'wastePercent', label: 'Planned waste (%)', type: 'number', min: 0, max: 100, value: 3 },
      { name: 'overheadPerMetre', label: 'Overhead per metre (₹)', type: 'number', min: 0, value: 8 },
      {
        name: 'route',
        label: 'Stages',
        type: 'select',
        value: 'SPINNING,WEAVING,DYEING',
        options: [
          { value: 'SPINNING,WEAVING,DYEING', label: 'Spinning → Weaving → Dyeing' },
          { value: 'WEAVING,DYEING', label: 'Weaving → Dyeing' },
          { value: 'SPINNING,WEAVING', label: 'Spinning → Weaving' },
          { value: 'WEAVING', label: 'Weaving only' },
        ],
      },
    ],
    transform: (d) => ({ ...d, route: String(d.route).split(',') }),
    submit: 'Add fabric',
  };
}

// Yarn at the gate: how much, what type and colour, and which order it is for.
export function receiptForm(lookups: Lookups | undefined, orders: OrderSummary[] = []): FormSpec {
  const recipes = lookups?.recipes ?? [];
  return {
    title: 'Receive yarn',
    description: 'Creates a yarn lot in the store and the supplier’s bill in accounts.',
    path: '/inventory/receipts',
    fields: [
      { name: 'supplierId', label: 'Supplier', type: 'select', options: (lookups?.suppliers ?? []).map((s) => ({ value: s.id, label: s.name })) },
      { name: 'reference', label: 'Gate pass / challan number', value: `GRN-${Date.now().toString().slice(-6)}` },
      { name: 'material', label: 'Yarn type', type: 'select', options: [...new Set(recipes.map((r) => r.material))].map((v) => ({ value: v, label: v })) },
      { name: 'specification', label: 'Yarn count / specification', type: 'select', options: [...new Set(recipes.map((r) => r.specification))].map((v) => ({ value: v, label: v })) },
      { name: 'color', label: 'Colour', value: 'Natural' },
      { name: 'quantity', label: 'Quantity received (kg)', type: 'number', min: 0.001 },
      { name: 'costPerKg', label: 'Price per kg (₹)', type: 'number', min: 0.01 },
      {
        name: 'orderId',
        label: 'For which order? (optional)',
        type: 'select',
        required: false,
        options: orders.filter((o) => !['COMPLETED', 'CANCELLED'].includes(o.status)).map((o) => ({ value: o.id, label: `${o.number} · ${o.buyer.name} · ${o.items.map((i) => i.fabric).join(', ')}` })),
        hint: 'That order’s batches use this yarn first',
      },
      { name: 'location', label: 'Store location', value: 'Warehouse A · Rack 1' },
      { name: 'threshold', label: 'Warn me below (kg)', type: 'number', min: 0, value: 300, hint: 'Reorder level for this yarn' },
    ],
    submit: 'Receive yarn',
  };
}

export function purchaseForm(lookups: Lookups | undefined): FormSpec {
  const recipes = lookups?.recipes ?? [];
  return {
    title: 'New purchase order',
    description: 'Order yarn from a supplier. Receive it against this order when it arrives.',
    path: '/purchases',
    fields: [
      { name: 'supplierId', label: 'Supplier', type: 'select', options: (lookups?.suppliers ?? []).map((s) => ({ value: s.id, label: s.name })) },
      { name: 'material', label: 'Yarn type', type: 'select', options: [...new Set(recipes.map((r) => r.material))].map((v) => ({ value: v, label: v })) },
      { name: 'specification', label: 'Yarn count / specification', type: 'select', options: [...new Set(recipes.map((r) => r.specification))].map((v) => ({ value: v, label: v })) },
      { name: 'color', label: 'Colour', value: 'Natural' },
      { name: 'quantity', label: 'Quantity (kg)', type: 'number', min: 0.001 },
      { name: 'costPerKg', label: 'Price per kg (₹)', type: 'number', min: 0.01 },
      { name: 'expectedAt', label: 'Expected on', type: 'date', value: factoryToday() },
    ],
    submit: 'Create purchase order',
  };
}

export function billForm(lookups: Lookups | undefined): FormSpec {
  return {
    title: 'Add a bill',
    description: 'Any bill the mill has to pay: dyes, spare parts, power, transport. Yarn bills are created when yarn is received.',
    path: '/bills',
    fields: [
      { name: 'supplierId', label: 'Supplier', type: 'select', options: (lookups?.suppliers ?? []).map((s) => ({ value: s.id, label: s.name })), hint: 'Not listed? Add the supplier first.' },
      { name: 'number', label: 'Bill number', hint: 'As printed on the supplier’s bill' },
      { name: 'category', label: 'What is it for?', type: 'select', value: 'DYES_CHEMICALS', options: billCategories.map((c) => ({ value: c, label: billCategoryLabel(c) })) },
      { name: 'amount', label: 'Amount (₹)', type: 'number', min: 0.01 },
      { name: 'billDate', label: 'Bill date', type: 'date', value: factoryToday() },
      { name: 'dueDate', label: 'Pay by', type: 'date', required: false, hint: 'Leave empty for 30 days' },
      { name: 'description', label: 'Description', type: 'textarea', required: false, span: true },
    ],
    submit: 'Save bill',
  };
}

export function expenseForm(): FormSpec {
  return {
    title: 'Record an expense',
    description: 'Day-to-day spending that has no supplier bill: rent, office, small cash payments.',
    path: '/expenses',
    fields: [
      { name: 'category', label: 'Category', type: 'select', options: expenseCategories.map((s) => ({ value: s, label: s })) },
      { name: 'amount', label: 'Amount (₹)', type: 'number', min: 0.01 },
      { name: 'description', label: 'Description', type: 'textarea', span: true },
    ],
    submit: 'Save expense',
  };
}

// The super admin's "add a user" form. Floor roles get a worker record and buyers a company,
// either an existing one or a new one made on the spot, so the login works straight away.
export function userForm(lookups: Lookups | undefined, roles: Role[]): FormSpec {
  return {
    title: 'Add a user',
    description: 'They sign in with this email and password. Give them the role for the job they do.',
    path: '/rbac/users',
    fields: [
      { name: 'name', label: 'Full name' },
      { name: 'email', label: 'Email', type: 'email' },
      { name: 'password', label: 'First password', type: 'password', hint: 'At least 10 characters. They can change it later.' },
      { name: 'role', label: 'Role', type: 'select', options: roles.map((r) => ({ value: r, label: `${roleNames[r]} · ${roleDuties[r]}` })), span: true },
      { name: 'departmentId', label: 'Department', type: 'select', required: false, options: (lookups?.departments ?? []).map((d) => ({ value: d.id, label: d.name })) },
      {
        name: 'workerId',
        label: 'Worker record (floor staff)',
        type: 'select',
        required: false,
        options: [{ value: 'NEW', label: '＋ Create a new worker for this person' }, ...(lookups?.workers ?? []).map((w) => ({ value: w.id, label: w.name }))],
        hint: 'Operators and supervisors need one to run or hand over jobs',
      },
      {
        name: 'buyerId',
        label: 'Buyer company (buyer logins)',
        type: 'select',
        required: false,
        options: [{ value: 'NEW', label: '＋ Create a new buyer company' }, ...(lookups?.buyers ?? []).map((b) => ({ value: b.id, label: b.name }))],
      },
    ],
    transform: (d) => ({ ...Object.fromEntries(Object.entries(d).filter(([, v]) => v !== '')), roles: [d.role], active: true }),
    submit: 'Create user',
  };
}
