import { z } from 'zod';

export const standardRoles = [
  'SUPER_ADMIN',
  'ADMIN',
  'OPERATIONS_MANAGER',
  'PRODUCTION_MANAGER',
  'INVENTORY_MANAGER',
  'PROCUREMENT_MANAGER',
  'SPINNING_OPERATOR',
  'WEAVING_OPERATOR',
  'DYEING_OPERATOR',
  'QUALITY_INSPECTOR',
  'DISPATCH_MANAGER',
  'SHIFT_SUPERVISOR',
  'MAINTENANCE_ENGINEER',
  'ACCOUNTS_MANAGER',
  'BUYER',
] as const;

export const roles = standardRoles;
export type Role = typeof roles[number];

export const permissionActions = ['view', 'create', 'update', 'approve', 'manage'] as const;
export type PermissionAction = typeof permissionActions[number];

export const permissionResources = [
  'orders',
  'inventory',
  'procurement',
  'production',
  'machines',
  'quality',
  'rolls',
  'dispatch',
  'workforce',
  'finance',
  'reports',
  'settings',
  'users',
  'roles',
  'dashboard',
  'attendance',
] as const;
export type PermissionResource = typeof permissionResources[number];

export interface PermissionDefinition {
  code: string;
  name: string;
  resource: PermissionResource;
  action: PermissionAction;
  description: string;
}

// ---------------------------------------------------------------------------
// PERMISSION MATRIX
// A permission is "resource:action". `manage` on a resource includes every other
// action on it. Administrators hold every permission. What each code allows is
// written down here, and every API write names exactly the code it needs, so this
// table is the whole story of who may do what.
// ---------------------------------------------------------------------------
export const permissionMeaning: Record<string, string> = {
  'orders:view': 'See customer orders (buyers see only their own)',
  'orders:create': 'Place an order (buyers for themselves, the office for walk-in customers)',
  'orders:approve': 'Accept or decline buyer requests, edit orders, plan production, register buyers',
  'inventory:view': 'See yarn stock, lots and material plans',
  'inventory:manage': 'Receive yarn, reserve it, correct stock, register suppliers',
  'procurement:view': 'See purchase orders',
  'procurement:create': 'Raise a purchase order when stock runs low',
  'procurement:manage': 'Raise and manage purchase orders and suppliers',
  'production:view': 'See the floor board and batches (operators see their own stage)',
  'production:update': 'Run a job you are assigned to: start, record output, pause, finish, report a problem',
  'production:approve': 'Assign machines and operators, move stopped work, send work back for rework, close problems',
  'production:create': 'Create stock or replacement batches and cancel batches',
  'production:manage': 'Everything on the production floor',
  'machines:view': 'See every machine and what it is doing',
  'machines:update': 'Report a breakdown',
  'machines:approve': 'Put a machine under maintenance and confirm it is repaired',
  'machines:manage': 'Add, edit, deactivate machines, maintenance and repairs',
  'quality:view': 'See inspection results',
  'quality:manage': 'Inspect rolls, repair at the rework bay, send rolls back to a stage',
  'rolls:view': 'See finished fabric rolls',
  'rolls:manage': 'Everything about finished rolls',
  'dispatch:view': 'See shipments (buyers see only their own)',
  'dispatch:manage': 'Load trucks, confirm dispatch, record delivery',
  'workforce:view': 'See workers and who is on shift',
  'attendance:manage': 'Check workers in and out, overtime, corrections, shift handovers',
  'finance:view': 'See invoices, payments and costs',
  'finance:manage': 'Record payments, expenses and claims',
  'reports:view': 'Factory reports',
  'settings:manage': 'Materials and prices, workers, factory setup',
  'users:manage': 'User accounts and approvals',
  'roles:manage': 'Custom roles',
  'dashboard:view': 'The home dashboard',
};

// What every standard role may do. Standard roles are fixed here in code; custom roles
// created in Settings carry their own permission list.
export const ROLE_PERMISSIONS_TEMPLATE: Record<Role, string[]> = {
  SUPER_ADMIN: ['*'],
  ADMIN: ['*'],
  // Runs the office: accepts orders, watches the whole mill, no floor actions.
  OPERATIONS_MANAGER: [
    'orders:view', 'orders:create', 'orders:approve', 'inventory:view', 'procurement:view', 'production:view',
    'machines:view', 'quality:view', 'rolls:view', 'dispatch:view', 'workforce:view', 'reports:view', 'dashboard:view',
  ],
  // Plans and controls production: batches, assignments, rework, problems.
  PRODUCTION_MANAGER: [
    'orders:view', 'orders:approve', 'inventory:view', 'production:manage', 'machines:view', 'machines:update',
    'quality:view', 'rolls:view', 'workforce:view', 'reports:view', 'dashboard:view',
  ],
  // The store: yarn in, yarn reserved, finished rolls on the shelf.
  INVENTORY_MANAGER: ['orders:view', 'inventory:manage', 'procurement:view', 'procurement:create', 'rolls:view', 'dispatch:view', 'dashboard:view'],
  PROCUREMENT_MANAGER: ['procurement:manage', 'inventory:view', 'orders:view', 'dashboard:view'],
  // Operators run only the jobs assigned to them, in their own stage.
  SPINNING_OPERATOR: ['production:view', 'production:update', 'machines:view', 'machines:update', 'dashboard:view'],
  WEAVING_OPERATOR: ['production:view', 'production:update', 'machines:view', 'machines:update', 'dashboard:view'],
  DYEING_OPERATOR: ['production:view', 'production:update', 'machines:view', 'machines:update', 'dashboard:view'],
  QUALITY_INSPECTOR: ['quality:manage', 'rolls:manage', 'production:view', 'dashboard:view'],
  DISPATCH_MANAGER: ['dispatch:manage', 'rolls:view', 'orders:view', 'dashboard:view'],
  // Shift-related work only: attendance, overtime, handovers between shifts, reporting breakdowns.
  SHIFT_SUPERVISOR: ['attendance:manage', 'workforce:view', 'production:view', 'machines:view', 'machines:update', 'dashboard:view'],
  MAINTENANCE_ENGINEER: ['machines:manage', 'production:view', 'dashboard:view'],
  ACCOUNTS_MANAGER: ['finance:manage', 'orders:view', 'procurement:view', 'workforce:view', 'reports:view', 'dashboard:view'],
  BUYER: ['orders:view', 'orders:create', 'rolls:view', 'dispatch:view'],
};

export const isStandardRole = (code: string): code is Role => code in ROLE_PERMISSIONS_TEMPLATE;

// Plain names and one-line duties for every standard role (shown when creating users).
export const roleNames: Record<Role, string> = {
  SUPER_ADMIN: 'Super Administrator',
  ADMIN: 'Administrator',
  OPERATIONS_MANAGER: 'Operations Manager',
  PRODUCTION_MANAGER: 'Production Manager',
  INVENTORY_MANAGER: 'Inventory Manager',
  PROCUREMENT_MANAGER: 'Procurement Manager',
  SPINNING_OPERATOR: 'Spinning Operator',
  WEAVING_OPERATOR: 'Weaving Operator',
  DYEING_OPERATOR: 'Dyeing Operator',
  QUALITY_INSPECTOR: 'Quality Inspector',
  DISPATCH_MANAGER: 'Dispatch Manager',
  SHIFT_SUPERVISOR: 'Shift Supervisor',
  MAINTENANCE_ENGINEER: 'Maintenance Engineer',
  ACCOUNTS_MANAGER: 'Accounts Manager',
  BUYER: 'Buyer',
};
export const roleDuties: Record<Role, string> = {
  SUPER_ADMIN: 'Everything: users, prices, machines, accounts',
  ADMIN: 'Everything: users, prices, machines, accounts',
  OPERATIONS_MANAGER: 'Accepts orders and watches the whole mill',
  PRODUCTION_MANAGER: 'Plans batches, assigns machines and operators, decides rework',
  INVENTORY_MANAGER: 'Receives, reserves and corrects yarn stock',
  PROCUREMENT_MANAGER: 'Raises purchase orders and manages suppliers',
  SPINNING_OPERATOR: 'Runs spinning jobs assigned to them',
  WEAVING_OPERATOR: 'Runs weaving jobs assigned to them',
  DYEING_OPERATOR: 'Runs dyeing jobs assigned to them',
  QUALITY_INSPECTOR: 'Inspects rolls and sends failures back',
  DISPATCH_MANAGER: 'Loads trucks, confirms dispatch and delivery',
  SHIFT_SUPERVISOR: 'Checks workers in and out, hands over shifts, reports breakdowns',
  MAINTENANCE_ENGINEER: 'Maintains machines and confirms repairs',
  ACCOUNTS_MANAGER: 'Invoices, payments, bills, wages and claims',
  BUYER: 'Places orders and tracks their own deliveries',
};
// Roles whose person works on the floor and must be linked to a worker record.
export const floorRoles: Role[] = ['SPINNING_OPERATOR', 'WEAVING_OPERATOR', 'DYEING_OPERATOR', 'SHIFT_SUPERVISOR'];

export interface CurrentUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  roles?: string[];
  permissions?: string[];
  buyerId: string | null;
  workerId: string | null;
  factoryId?: string | null;
  factoryName?: string;
  departmentId?: string | null;
  departmentCode?: string;
  departmentName?: string;
  active?: boolean;
}

// Stage operators may only see and update jobs for their own production stage.
const operatorStages: Record<string, string> = {
  SPINNING_OPERATOR: 'SPINNING',
  WEAVING_OPERATOR: 'WEAVING',
  DYEING_OPERATOR: 'DYEING',
};

export function stageForRole(role: string): string | null {
  return operatorStages[role] ?? null;
}

// Plain-language names for job statuses shown on the floor.
export const jobStatusLabels: Record<string, string> = {
  PLANNED: 'Pending',
  READY: 'Needs machine & operator',
  ASSIGNED: 'Assigned',
  IN_PROGRESS: 'Running',
  PAUSED: 'Paused',
  BLOCKED: 'Blocked',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

export function hasPermission(
  user: { role?: string; roles?: string[]; permissions?: string[] } | null | undefined,
  resource: PermissionResource | string,
  action: PermissionAction | string = 'view'
): boolean {
  if (!user) return false;
  const userRoles = [user.role, ...(user.roles ?? [])].filter(Boolean) as string[];
  if (userRoles.includes('SUPER_ADMIN') || userRoles.includes('ADMIN')) return true;

  const targetCode = `${resource}:${action}`;
  const manageCode = `${resource}:manage`;
  const perms = user.permissions ?? [];

  if (perms.includes(targetCode) || perms.includes(manageCode) || perms.includes('*')) {
    return true;
  }

  // Fallback check against role templates
  for (const r of userRoles) {
    const templatePerms = ROLE_PERMISSIONS_TEMPLATE[r as Role] ?? [];
    if (templatePerms.includes(targetCode) || templatePerms.includes(manageCode)) {
      return true;
    }
  }

  return false;
}

// Areas of the app a role can be given access to (sidebar sections and route guards).
export type Area = Exclude<PermissionResource, 'users' | 'roles'>;

// Can this role (or user) see an area at all? The same rule runs on the server and in the browser.
export function can(roleOrUser: string | { role?: string; roles?: string[]; permissions?: string[] }, area: Area): boolean {
  const user = typeof roleOrUser === 'string' ? { role: roleOrUser } : roleOrUser;
  return hasPermission(user, area, 'view');
}

const positive = z.coerce.number().positive().max(100000000).multipleOf(0.001);
const money = z.coerce.number().positive().max(100000000).multipleOf(0.01);
const text = z.string().trim().min(1).max(200);

export const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1).max(128) });
// Roles a new user may ask for when signing up. Admin roles can only be given by an administrator.
export const signupRoles = [
  'PRODUCTION_MANAGER',
  'INVENTORY_MANAGER',
  'PROCUREMENT_MANAGER',
  'SPINNING_OPERATOR',
  'WEAVING_OPERATOR',
  'DYEING_OPERATOR',
  'QUALITY_INSPECTOR',
  'DISPATCH_MANAGER',
  'SHIFT_SUPERVISOR',
  'MAINTENANCE_ENGINEER',
  'ACCOUNTS_MANAGER',
  'BUYER',
] as const;

export const signupSchema = z.object({
  name: text,
  email: z.string().trim().email(),
  password: z.string().min(10, 'Password must be at least 10 characters.').max(128),
  requestedRole: z.enum(signupRoles),
  phone: z.string().trim().max(30).default(''),
  company: z.string().trim().max(200).default(''),
  city: z.string().trim().max(100).default(''),
  note: z.string().trim().max(500).default(''),
}).refine((v) => v.requestedRole !== 'BUYER' || (Boolean(v.company) && Boolean(v.city)), {
  message: 'Company name and city are required for buyer accounts.',
  path: ['company'],
});

// The administrator decides the final role when approving a signup.
export const approveUserSchema = z.object({
  role: z.string().min(2),
  buyerId: z.string().optional(),
  departmentId: z.string().optional(),
  workerId: z.string().optional(),
});
export const rejectUserSchema = z.object({ reason: z.string().trim().min(3).max(500) });
// Today's date in the factory's time zone (yyyy-mm-dd).
export const factoryToday = (now = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);

// Delivery dates must be after today (factory time).
const futureDate = z.string().date().refine((d) => d > factoryToday(), { message: 'Delivery date must be after today.' });

// Buyers and staff only choose the material, colour and quantity. The price is fixed per material.
export const orderSchema = z.object({
  buyerId: text,
  deadline: futureDate,
  priority: z.enum(['NORMAL', 'HIGH', 'URGENT']).default('NORMAL'),
  instructions: z.string().max(2000).default(''),
  items: z.array(z.object({ recipeId: text, color: text, quantity: positive })).min(1).max(20),
});
const blankToUndefined = z.string().trim().optional().transform((v) => v || undefined);
// Yarn at the gate: how much, what type and colour, and (optionally) which order it is for.
export const receiptSchema = z.object({ supplierId: text, purchaseId: blankToUndefined, orderId: blankToUndefined, reference: text, material: text, color: text, specification: text, quantity: positive, costPerKg: money, location: text, threshold: z.coerce.number().min(0).default(100) });
export const reservationSchema = z.object({ productionId: text, lotId: text, quantity: positive });
// Machine and operator are both required. The shift comes from the operator's check-in.
export const assignmentSchema = z.object({ machineId: text, workerId: text, reason: z.string().trim().max(500).default('') });
// Finishing a stage: the final output of this run (0 if everything was already recorded), then hand over.
export const completeSchema = z.object({
  quantity: z.coerce.number().min(0).max(100000000).default(0),
  hours: z.coerce.number().min(0).max(24).default(0),
  waste: z.coerce.number().min(0).max(10000).default(0),
  lotId: z.string().optional().or(z.literal('').transform(() => undefined)),
  consumedKg: z.coerce.number().min(0).max(100000).default(0),
  rollLengths: z.array(positive).max(100).default([]),
});
// Shift handover: the next shift's operator takes over a running or paused job on the same machine.
export const handoverSchema = z.object({ workerId: text, reason: z.string().trim().max(500).default('') });
export const outputSchema = z.object({ quantity: positive, waste: z.coerce.number().min(0).max(10000).default(0), hours: positive, lotId: z.string().optional(), consumedKg: z.coerce.number().min(0).max(100000).default(0), rollLengths: z.array(positive).max(100).default([]) });
export const inspectionSchema = z.object({ result: z.enum(['PASSED', 'REWORK', 'REJECTED']), defects: z.array(text).max(20).default([]), notes: z.string().max(2000).default('') }).refine(v => v.result === 'PASSED' || v.defects.length > 0, { message: 'Record at least one defect for a failed inspection.', path: ['defects'] });
export const shipmentSchema = z.object({ orderId: text, rollIds: z.array(text).min(1).max(100), transport: text, driverName: z.string().trim().max(120).default(''), driverPhone: z.string().trim().max(30).default(''), expectedAt: z.string().date().optional().or(z.literal('').transform(() => undefined)) });
export const deliverSchema = z.object({ receivedBy: z.string().trim().max(120).default(''), note: z.string().trim().max(500).default('') });
export const paymentSchema = z.object({ amount: money, reference: text });
export const checkInSchema = z.object({ workerId: text, shiftId: text });
export const attendanceCorrectionSchema = z.object({
  hours: z.coerce.number().min(0).max(16),
  status: z.enum(['PRESENT', 'ABSENT', 'LEAVE']),
  reason: z.string().trim().min(3).max(500),
});
export const overtimeSchema = z.object({ extraHours: z.coerce.number().min(0.5).max(8), reason: z.string().trim().min(3).max(500) });
export const purchaseSchema = z.object({ supplierId: text, material: text, color: text, specification: text, quantity: positive, costPerKg: money, expectedAt: z.string().date() });
export const workerSchema = z.object({ name: text, designation: text, wageType: z.enum(['HOURLY', 'PIECE']), rate: money, departmentId: z.string().optional() });
export const partySchema = z.object({ name: text, email: z.string().email(), city: text });
export const expenseCategories = ['Utilities', 'Rent', 'Transport', 'Maintenance', 'Salaries', 'Office', 'Other'] as const;
export const expenseSchema = z.object({ category: text, description: text, amount: money });

// Bills the mill has to pay. Yarn receipts create their own; everything else is entered here.
export const billCategories = ['YARN', 'DYES_CHEMICALS', 'SPARES', 'POWER', 'TRANSPORT', 'SERVICES', 'OTHER'] as const;
export const billSchema = z.object({
  supplierId: text,
  number: text,
  category: z.enum(billCategories),
  description: z.string().trim().max(500).default(''),
  amount: money,
  billDate: z.string().date().refine((d) => d <= factoryToday(), { message: 'The bill date cannot be in the future.' }),
  dueDate: z.string().date().optional().or(z.literal('').transform(() => undefined)),
});

// Shifts: a start hour and a length. Night shifts simply run past midnight.
export const shiftSchema = z.object({
  name: text,
  startHour: z.coerce.number().int().min(0).max(23),
  hours: z.coerce.number().min(1).max(16),
});
export const shiftUpdateSchema = shiftSchema.partial().extend({ active: z.coerce.boolean().optional() });

// Defects an inspector can tick. "Other" needs a note.
export const defectChoices = ['Holes', 'Colour mismatch', 'Uneven weaving', 'Stains', 'Broken picks', 'Weft bar', 'Slubs', 'Other'] as const;
export const claimSchema = z.object({
  party: z.enum(['BUYER', 'SUPPLIER']),
  buyerId: z.string().optional(),
  supplierId: z.string().optional(),
  orderId: z.string().optional(),
  invoiceId: z.string().optional(),
  amount: money,
  reason: z.string().trim().min(3).max(1000),
}).refine((v) => (v.party === 'BUYER' ? Boolean(v.buyerId) : Boolean(v.supplierId)), { message: 'Choose the buyer or supplier the claim is about.', path: ['buyerId'] });
export const claimDecisionSchema = z.object({ decision: z.enum(['APPROVED', 'REJECTED', 'RESOLVED']), note: z.string().trim().max(500).default('') });
export const machineSchema = z.object({
  code: z.string().trim().min(2).max(20),
  name: text,
  type: z.enum(['SPINNING', 'WEAVING', 'DYEING']),
  location: text,
  capacityPerHour: positive,
  hourlyCost: z.coerce.number().min(0).max(100000),
  departmentId: z.string().optional().or(z.literal('').transform(() => undefined)),
});
export const machineUpdateSchema = machineSchema.partial();
export const recipePriceSchema = z.object({ pricePerMetre: money });
export const recipeSchema = z.object({ name: text, material: text, specification: text, kgPerMetre: positive, wastePercent: z.coerce.number().min(0).max(100), overheadPerMetre: z.coerce.number().min(0).max(10000), pricePerMetre: money, route: z.array(z.enum(['SPINNING', 'WEAVING', 'DYEING'])).min(1).max(3) }).refine(v => new Set(v.route).size === v.route.length, { message: 'Stages must be unique.' });

export const userSchema = z.object({
  name: text,
  email: z.string().email(),
  password: z.string().min(10).max(128),
  role: z.string(),
  roles: z.array(z.string()).optional(),
  buyerId: z.string().optional(),
  workerId: z.string().optional(),
  factoryId: z.string().optional(),
  departmentId: z.string().optional(),
  active: z.boolean().default(true),
}).refine(v => v.role !== 'BUYER' || !!v.buyerId, { message: 'Buyers must be linked to a buyer account.' });

export const updateUserSchema = z.object({
  name: text.optional(),
  role: z.string().optional(),
  roles: z.array(z.string()).optional(),
  active: z.boolean().optional(),
  buyerId: z.string().nullable().optional(),
  workerId: z.string().nullable().optional(),
  factoryId: z.string().nullable().optional(),
  departmentId: z.string().nullable().optional(),
  password: z.string().min(10).max(128).optional(),
});

export const roleSchema = z.object({
  code: z.string().min(2).max(50).regex(/^[A-Z0-9_]+$/, 'Code must be uppercase alphanumeric with underscores'),
  name: text,
  description: z.string().max(500).default(''),
  permissions: z.array(z.string()).default([]),
});

export const updateRoleSchema = z.object({
  name: text.optional(),
  description: z.string().max(500).optional(),
  permissions: z.array(z.string()).optional(),
});

export const factorySchema = z.object({
  code: z.string().min(2).max(20),
  name: text,
  location: text,
  active: z.boolean().default(true),
});

export const departmentSchema = z.object({
  code: z.string().min(2).max(20),
  name: text,
  factoryId: z.string(),
  active: z.boolean().default(true),
});

// ==================== PRODUCTION BATCHES, REWORK & ISSUES ====================

export const productionStages = ['SPINNING', 'WEAVING', 'DYEING'] as const;
// Departments a batch can currently be in (used by filters and charts).
export const departments = ['SPINNING', 'WEAVING', 'DYEING', 'QUALITY', 'DISPATCH', 'FINISHED'] as const;

// Why a batch exists. ORDER batches come from customer orders; the rest are standalone.
export const productionPurposes = ['STOCK', 'INTERNAL', 'REPLACEMENT', 'URGENT'] as const;

export const defectTypes = [
  'SPINNING_DEFECT',
  'WEAVING_DEFECT',
  'DYEING_DEFECT',
  'QUALITY_FAILURE',
  'MACHINE_FAULT',
  'WRONG_QUANTITY',
  'DAMAGED_MATERIAL',
] as const;

export const issueTypes = [
  'MACHINE_BREAKDOWN',
  'WORKER_UNAVAILABLE',
  'MATERIAL_SHORTAGE',
  'WRONG_QUANTITY',
  'QUALITY_FAILURE',
  'DELAY',
  'INTERRUPTION',
  'OTHER',
] as const;

// Simple status groups used by the production filters.
export const batchStatusGroups = ['PENDING', 'ONGOING', 'COMPLETED', 'FAILED', 'REWORK'] as const;

const optionalId = z.string().trim().optional().transform((v) => v || undefined);

export const standaloneBatchSchema = z.object({
  recipeId: text,
  color: text,
  quantity: positive,
  purpose: z.enum(productionPurposes),
  priority: z.enum(['NORMAL', 'HIGH', 'URGENT']).default('NORMAL'),
  dueDate: z.string().date().optional().or(z.literal('').transform(() => undefined)),
  notes: z.string().trim().max(1000).default(''),
  // Optional: leave out a stage to skip it (for example, greige fabric that needs no dyeing).
  stages: z.array(z.enum(productionStages)).min(1).max(3).optional(),
  spinningMachineId: optionalId,
  weavingMachineId: optionalId,
  dyeingMachineId: optionalId,
  workerId: optionalId,
});

export const reworkRequestSchema = z.object({
  defectType: z.enum(defectTypes),
  reason: z.string().trim().min(3).max(1000),
  returnStage: z.enum(productionStages),
  quantity: z.coerce.number().min(0).max(100000000).default(0),
  rollIds: z.array(z.string()).max(100).default([]),
  machineId: optionalId,
  workerId: optionalId,
});

export const issueSchema = z.object({
  type: z.enum(issueTypes),
  description: z.string().trim().min(3).max(1000),
  jobId: optionalId,
  // Stop the running stage until the problem is fixed.
  holdJob: z.coerce.boolean().default(false),
});

export const resolveIssueSchema = z.object({ resolution: z.string().trim().min(3).max(1000) });


export const replacementSchema = z.object({
  quantity: positive,
  reason: z.string().trim().min(3).max(1000),
});

export type OrderInput = z.infer<typeof orderSchema>;
export type BillInput = z.infer<typeof billSchema>;
export type ShiftInput = z.infer<typeof shiftSchema>;
export type StandaloneBatchInput = z.infer<typeof standaloneBatchSchema>;
export type ReworkRequestInput = z.infer<typeof reworkRequestSchema>;
export type IssueInput = z.infer<typeof issueSchema>;
export type ReceiptInput = z.infer<typeof receiptSchema>;
export type OutputInput = z.infer<typeof outputSchema>;
export type CompleteInput = z.infer<typeof completeSchema>;
export interface PageResponse<T> { data: T[]; total: number; page: number; pageSize: number }
export interface OrderSummary { id: string; number: string; yarn?: { status: 'ENOUGH' | 'SHORT' | 'IN_HAND'; neededKg: string; shortKg: string; material: string } | null; buyer: { id: string; name: string; initials: string; city: string }; status: string; priority: string; deadline: string; createdAt: string; instructions: string; quantity: string; value?: string; produced: string; approved: string; dispatched: string; progress: number; stage: string; risk: { level: string; reasons: string[] }; items: OrderItem[] }
export interface OrderItem { id: string; fabric: string; color: string; quantity: string; price: string; recipeId: string; recipe: { name: string; specification: string }; production: ProductionSummary | null }
export interface ProductionSummary { id: string; number: string; status: string; target: string; jobs: JobSummary[] }
export interface JobSummary { id: string; stage: string; sequence: number; status: string; target: string; output: string; machineId: string | null; workerId: string | null; shiftId: string | null; machine?: MachineSummary | null; worker?: { name: string } | null; production?: BatchRef }
export interface MachineSummary { id: string; code: string; name: string; type: string; location: string; status: string; capacityPerHour: string; reportedAt: string; todayOutput: string; jobs: JobSummary[]; downtime: { id: string; reason: string; startedAt: string; endedAt: string | null }[] }
export interface YarnSummary { id: string; code: string; material: string; color: string; specification: string; location: string; onHand: string; reserved: string; available: string; costPerKg: string; threshold: string; supplier: { id: string; name: string }; createdAt: string }
export interface RollSummary { id: string; code: string; length: string; quality: string; location: string; cost?: string; activeShipmentId: string | null; createdAt: string; production: BatchRef }
export interface Lookup { id: string; name: string; [key: string]: unknown }
export interface Lookups { buyers: Lookup[]; suppliers: Lookup[]; recipes: (Lookup & { material: string; specification: string; kgPerMetre: string; wastePercent: string; route: string[]; overheadPerMetre?: string; pricePerMetre: string })[]; workers: (Lookup & { departmentId?: string | null })[]; shifts: Lookup[]; machines: (Lookup & { departmentId?: string | null })[]; departments?: (Lookup & { code: string; factoryId: string })[]; factories?: Lookup[]; roles?: (Lookup & { code: string })[] }
// Short description of a production batch. `order` is null for standalone (stock / internal) batches.
export interface BatchRef { id: string; number: string; fabric: string; color: string; recipeId: string; purpose: string; order: { id: string; number: string; buyer: { id: string; name: string } } | null }

export interface ShiftReportShift {
  id: string;
  name: string;
  start: string;
  end: string;
  state: 'UPCOMING' | 'CURRENT' | 'COMPLETED';
  present: { worker: string; designation: string; checkInAt: string | null; checkOutAt: string | null; hours: number; overtime: number; status: string }[];
  absent: number;
  output: number;
  waste: number;
  byStage: { stage: string; output: number }[];
  byMachine: { code: string; stage: string; output: number; hours: number }[];
  started: number;
  finished: number;
  breakdowns: { machine: string; reason: string; at: string; resolved: boolean }[];
  inspections: { passed: number; rework: number; rejected: number };
  wages: number;
  events: { at: string; text: string; who: string; kind: string }[];
}
export interface ShiftReport { date: string; shifts: ShiftReportShift[]; week: Record<string, string | number>[]; shiftNames: string[] }
// One month of money: sales against bills, wages and expenses.
export interface MonthMoney { month: string; label: string; sales: number; received: number; yarnBills: number; otherBills: number; wages: number; expenses: number; spend: number; profit: number; cash: number }
export interface Alert { id: string; title: string; description: string; severity: 'warning' | 'danger' | 'success'; href: string }
export interface Dashboard { activeOrders: number; dueSoon: number; delayed: number; availableYarn: string; todayOutput: string; previousOutput: string; pendingQuality: number; passed: number; rejected: number; finishedRolls: number; pendingDispatch: number; running: number; idle: number; breakdown: number; totalMachines: number; series: { date: string; label: string; output: number; target: number }[]; orders: OrderSummary[]; machines: MachineSummary[]; alerts: Alert[]; activity: { id: string; action: string; detail: string; actorName: string; createdAt: string }[]; finance?: { billed: string; received: string; cost: string; outstanding: string; overdue: string; overdueCount: number; expenses: string; pendingClaims: number; pendingInvoices: number; billsDue: string; billsDueCount: number; pnl: MonthMoney; trend: MonthMoney[]; spendBreakdown: { key: string; name: string; value: number }[] }; date: string }

export interface RoleDetail {
  id: string;
  code: string;
  name: string;
  description: string;
  isSystem: boolean;
  permissions: string[];
  userCount: number;
}

export interface UserManagementItem {
  id: string;
  name: string;
  email: string;
  role: string;
  roles: string[];
  active: boolean;
  approvalStatus: string;
  requestedRole: string | null;
  phone: string;
  company: string;
  city: string;
  note: string;
  buyerId: string | null;
  buyerName?: string;
  workerId: string | null;
  workerName?: string;
  factoryId: string | null;
  factoryName?: string;
  departmentId: string | null;
  departmentName?: string;
  createdAt: string;
}

export interface FactoryItem {
  id: string;
  code: string;
  name: string;
  location: string;
  active: boolean;
  departmentCount: number;
  userCount: number;
}

export interface DepartmentItem {
  id: string;
  code: string;
  name: string;
  factoryId: string;
  factoryName: string;
  active: boolean;
  userCount: number;
}

export interface BatchSummary extends BatchRef {
  status: string;
  priority: string;
  target: string;
  produced: string;
  department: string;
  statusGroup: string;
  dueDate: string | null;
  createdAt: string;
  notes: string;
  openReworks: number;
  openIssues: number;
  machines: string[];
  jobs: { id: string; stage: string; sequence: number; status: string; target: string; output: string; machineId: string | null; machineCode: string | null; workerId: string | null; workerName: string | null }[];
}

export interface ReworkItem {
  id: string;
  defectType: string;
  reason: string;
  fromStage: string;
  returnStage: string | null;
  quantity: string;
  rollCodes: string[];
  status: string;
  outcome: string;
  raisedBy: string;
  resolvedBy: string;
  machine: { code: string } | null;
  worker: { name: string } | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  production: { id: string; number: string; fabric: string } | null;
}

export interface IssueItem {
  id: string;
  type: string;
  description: string;
  stage: string | null;
  status: string;
  resolution: string;
  reportedBy: string;
  resolvedBy: string;
  createdAt: string;
  resolvedAt: string | null;
}

export interface BatchDetail extends BatchSummary {
  replaces: { id: string; number: string } | null;
  replacements: { id: string; number: string; status: string }[];
  rolls: { id: string; code: string; length: string; quality: string; activeShipmentId: string | null }[];
  reworks: ReworkItem[];
  issues: IssueItem[];
  history: { id: string; action: string; detail: string; actorName: string; createdAt: string }[];
}

export interface AppNotification { id: string; title: string; message: string; category: string; link: string; read: boolean; createdAt: string }

export interface Analytics {
  from: string;
  to: string;
  dailyOutput: { date: string; label: string; SPINNING: number; WEAVING: number; DYEING: number }[];
  departmentOutput: { stage: string; output: number; waste: number }[];
  machineUtilization: { code: string; type: string; status: string; runHours: number; utilization: number }[];
  machineStatus: { status: string; count: number }[];
  productionStatus: { status: string; count: number }[];
  delays: { delayed: number; onTime: number; late: { id: string; number: string; daysLate: number; department: string }[] };
  rework: { byType: { type: string; count: number; quantity: number }[]; byStage: { stage: string; count: number }[]; open: number; completed: number };
  quality: { passed: number; rework: number; rejected: number; passRate: number; daily: { date: string; label: string; passed: number; failed: number }[] };
  customers: { buyer: string; ordered: number; produced: number; dispatched: number }[];
}
