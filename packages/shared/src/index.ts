import { z } from 'zod';

export const standardRoles = [
  'SUPER_ADMIN',
  'ADMIN',
  'PRODUCTION_MANAGER',
  'INVENTORY_MANAGER',
  'PROCUREMENT_MANAGER',
  'SPINNING_OPERATOR',
  'WEAVING_OPERATOR',
  'DYEING_OPERATOR',
  'OPERATOR', // backwards-compatible alias for weaving/floor operator
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
] as const;
export type PermissionResource = typeof permissionResources[number];

export interface PermissionDefinition {
  code: string;
  name: string;
  resource: PermissionResource;
  action: PermissionAction;
  description: string;
}

export const ROLE_PERMISSIONS_TEMPLATE: Record<Role, string[]> = {
  SUPER_ADMIN: [
    'orders:manage', 'inventory:manage', 'procurement:manage', 'production:manage',
    'machines:manage', 'quality:manage', 'rolls:manage', 'dispatch:manage',
    'workforce:manage', 'finance:manage', 'reports:manage', 'settings:manage',
    'users:manage', 'roles:manage', 'dashboard:view'
  ],
  ADMIN: [
    'orders:manage', 'inventory:manage', 'procurement:manage', 'production:manage',
    'machines:manage', 'quality:manage', 'rolls:manage', 'dispatch:manage',
    'workforce:manage', 'finance:manage', 'reports:manage', 'settings:manage',
    'users:manage', 'roles:manage', 'dashboard:view'
  ],
  PRODUCTION_MANAGER: [
    'orders:view', 'orders:update', 'orders:approve', 'inventory:view', 'production:manage',
    'machines:view', 'machines:update', 'quality:view', 'rolls:view',
    'workforce:view', 'workforce:update', 'reports:view', 'dashboard:view'
  ],
  INVENTORY_MANAGER: [
    'orders:view', 'inventory:manage', 'procurement:view', 'procurement:create',
    'rolls:view', 'dashboard:view'
  ],
  PROCUREMENT_MANAGER: [
    'procurement:manage', 'inventory:view', 'inventory:update', 'orders:view',
    'finance:view', 'dashboard:view'
  ],
  SPINNING_OPERATOR: [
    'production:view', 'production:update', 'machines:view', 'machines:update',
    'dashboard:view'
  ],
  WEAVING_OPERATOR: [
    'production:view', 'production:update', 'machines:view', 'machines:update',
    'dashboard:view'
  ],
  DYEING_OPERATOR: [
    'production:view', 'production:update', 'machines:view', 'machines:update',
    'dashboard:view'
  ],
  OPERATOR: [
    'production:view', 'production:update', 'machines:view', 'machines:update',
    'dashboard:view'
  ],
  QUALITY_INSPECTOR: [
    'quality:manage', 'rolls:manage', 'production:view', 'dashboard:view'
  ],
  DISPATCH_MANAGER: [
    'dispatch:manage', 'rolls:view', 'orders:view', 'dashboard:view'
  ],
  SHIFT_SUPERVISOR: [
    'workforce:manage', 'production:view', 'production:update', 'machines:view',
    'attendance:manage', 'dashboard:view'
  ],
  MAINTENANCE_ENGINEER: [
    'machines:manage', 'production:view', 'dashboard:view'
  ],
  ACCOUNTS_MANAGER: [
    'finance:manage', 'orders:view', 'procurement:view', 'workforce:view',
    'reports:manage', 'dashboard:view'
  ],
  BUYER: [
    'orders:view', 'orders:create', 'orders:update', 'rolls:view', 'dispatch:view'
  ],
};

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
  READY: 'Ready to Accept',
  IN_PROGRESS: 'In Progress',
  PAUSED: 'Paused',
  BLOCKED: 'Blocked',
  COMPLETED: 'Completed',
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

export const permissions = {
  orders: ['SUPER_ADMIN', 'ADMIN', 'PRODUCTION_MANAGER', 'INVENTORY_MANAGER', 'PROCUREMENT_MANAGER', 'DISPATCH_MANAGER', 'ACCOUNTS_MANAGER', 'BUYER'],
  inventory: ['SUPER_ADMIN', 'ADMIN', 'INVENTORY_MANAGER', 'PRODUCTION_MANAGER', 'PROCUREMENT_MANAGER'],
  procurement: ['SUPER_ADMIN', 'ADMIN', 'PROCUREMENT_MANAGER', 'INVENTORY_MANAGER', 'ACCOUNTS_MANAGER'],
  production: ['SUPER_ADMIN', 'ADMIN', 'PRODUCTION_MANAGER', 'SHIFT_SUPERVISOR', 'SPINNING_OPERATOR', 'WEAVING_OPERATOR', 'DYEING_OPERATOR', 'OPERATOR'],
  machines: ['SUPER_ADMIN', 'ADMIN', 'PRODUCTION_MANAGER', 'MAINTENANCE_ENGINEER', 'SHIFT_SUPERVISOR', 'SPINNING_OPERATOR', 'WEAVING_OPERATOR', 'DYEING_OPERATOR', 'OPERATOR'],
  quality: ['SUPER_ADMIN', 'ADMIN', 'QUALITY_INSPECTOR', 'PRODUCTION_MANAGER'],
  rolls: ['SUPER_ADMIN', 'ADMIN', 'QUALITY_INSPECTOR', 'DISPATCH_MANAGER', 'PRODUCTION_MANAGER'],
  dispatch: ['SUPER_ADMIN', 'ADMIN', 'DISPATCH_MANAGER'],
  workforce: ['SUPER_ADMIN', 'ADMIN', 'SHIFT_SUPERVISOR', 'PRODUCTION_MANAGER', 'ACCOUNTS_MANAGER'],
  finance: ['SUPER_ADMIN', 'ADMIN', 'ACCOUNTS_MANAGER'],
  reports: ['SUPER_ADMIN', 'ADMIN', 'PRODUCTION_MANAGER', 'ACCOUNTS_MANAGER'],
  settings: ['SUPER_ADMIN', 'ADMIN'],
  dashboard: ['SUPER_ADMIN', 'ADMIN', 'PRODUCTION_MANAGER', 'INVENTORY_MANAGER', 'PROCUREMENT_MANAGER', 'SPINNING_OPERATOR', 'WEAVING_OPERATOR', 'DYEING_OPERATOR', 'OPERATOR', 'QUALITY_INSPECTOR', 'DISPATCH_MANAGER', 'SHIFT_SUPERVISOR', 'MAINTENANCE_ENGINEER', 'ACCOUNTS_MANAGER'],
} satisfies Record<string, readonly Role[]>;

export type Area = keyof typeof permissions;

export function can(role: Role | string, area: Area): boolean {
  if (role === 'SUPER_ADMIN' || role === 'ADMIN') return true;
  const list = permissions[area] as readonly string[] | undefined;
  return list ? list.includes(role) : false;
}

const positive = z.coerce.number().positive().max(100000000).multipleOf(0.001);
const money = z.coerce.number().positive().max(100000000).multipleOf(0.01);
const text = z.string().trim().min(1).max(200);

export const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1).max(128) });
export const signupSchema = z.object({
  name: text,
  email: z.string().email(),
  password: z.string().min(10).max(128),
  role: z.string(),
  company: text.optional(),
  city: text.optional(),
}).refine((v) => v.role !== 'BUYER' || (Boolean(v.company) && Boolean(v.city)), {
  message: 'Company name and city are required for buyer accounts.',
});
export const orderSchema = z.object({ buyerId: text, deadline: z.string().date(), priority: z.enum(['NORMAL', 'HIGH', 'URGENT']).default('NORMAL'), instructions: z.string().max(2000).default(''), items: z.array(z.object({ recipeId: text, fabric: text, color: text, quantity: positive, price: money })).min(1).max(20) });
export const receiptSchema = z.object({ supplierId: text, purchaseId: z.string().optional(), reference: text, material: text, color: text, specification: text, quantity: positive, costPerKg: money, location: text, threshold: z.coerce.number().min(0).default(100) });
export const reservationSchema = z.object({ productionId: text, lotId: text, quantity: positive });
export const assignmentSchema = z.object({ machineId: text, workerId: text, shiftId: text });
export const outputSchema = z.object({ quantity: positive, waste: z.coerce.number().min(0).max(10000).default(0), hours: positive, lotId: z.string().optional(), consumedKg: z.coerce.number().min(0).max(100000).default(0), rollLengths: z.array(positive).max(100).default([]) });
export const inspectionSchema = z.object({ result: z.enum(['PASSED', 'REWORK', 'REJECTED']), defects: z.array(text).max(20).default([]), notes: z.string().max(2000).default('') }).refine(v => v.result === 'PASSED' || v.defects.length > 0, { message: 'Record at least one defect for a failed inspection.', path: ['defects'] });
export const shipmentSchema = z.object({ orderId: text, rollIds: z.array(text).min(1).max(100), transport: text, driverName: z.string().trim().max(120).default(''), driverPhone: z.string().trim().max(30).default('') });
export const paymentSchema = z.object({ amount: money, reference: text });
export const attendanceSchema = z.object({ workerId: text, shiftId: text, date: z.string().date(), hours: z.coerce.number().min(0).max(16), status: z.enum(['PRESENT', 'ABSENT', 'LEAVE']).default('PRESENT') });
export const purchaseSchema = z.object({ supplierId: text, material: text, color: text, specification: text, quantity: positive, costPerKg: money, expectedAt: z.string().date() });
export const workerSchema = z.object({ name: text, designation: text, wageType: z.enum(['HOURLY', 'PIECE']), rate: money, departmentId: z.string().optional() });
export const partySchema = z.object({ name: text, email: z.string().email(), city: text });
export const expenseSchema = z.object({ category: text, description: text, amount: money });
export const recipeSchema = z.object({ name: text, material: text, specification: text, kgPerMetre: positive, wastePercent: z.coerce.number().min(0).max(100), overheadPerMetre: z.coerce.number().min(0).max(10000), route: z.array(z.enum(['SPINNING', 'WEAVING', 'DYEING'])).min(1).max(3) }).refine(v => new Set(v.route).size === v.route.length, { message: 'Stages must be unique.' });

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

export type OrderInput = z.infer<typeof orderSchema>;
export type ReceiptInput = z.infer<typeof receiptSchema>;
export type OutputInput = z.infer<typeof outputSchema>;
export interface PageResponse<T> { data: T[]; total: number; page: number; pageSize: number }
export interface OrderSummary { id: string; number: string; buyer: { id: string; name: string; initials: string; city: string }; status: string; priority: string; deadline: string; createdAt: string; instructions: string; quantity: string; value?: string; produced: string; approved: string; dispatched: string; progress: number; stage: string; risk: { level: string; reasons: string[] }; items: OrderItem[] }
export interface OrderItem { id: string; fabric: string; color: string; quantity: string; price: string; recipeId: string; recipe: { name: string; specification: string }; production: ProductionSummary | null }
export interface ProductionSummary { id: string; number: string; status: string; target: string; jobs: JobSummary[] }
export interface JobSummary { id: string; stage: string; sequence: number; status: string; target: string; output: string; machineId: string | null; workerId: string | null; shiftId: string | null; machine?: MachineSummary | null; worker?: { name: string } | null; production?: { number: string; item: { fabric: string; color: string; order: { id: string; number: string; buyer: { name: string } } } } }
export interface MachineSummary { id: string; code: string; name: string; type: string; location: string; status: string; capacityPerHour: string; reportedAt: string; todayOutput: string; jobs: JobSummary[]; downtime: { id: string; reason: string; startedAt: string; endedAt: string | null }[] }
export interface YarnSummary { id: string; code: string; material: string; color: string; specification: string; location: string; onHand: string; reserved: string; available: string; costPerKg: string; threshold: string; supplier: { id: string; name: string }; createdAt: string }
export interface RollSummary { id: string; code: string; length: string; quality: string; location: string; cost?: string; activeShipmentId: string | null; createdAt: string; production: { id: string; number: string; item: { fabric: string; color: string; order: { id: string; number: string; buyer: { name: string } } } } }
export interface Lookup { id: string; name: string; [key: string]: unknown }
export interface Lookups { buyers: Lookup[]; suppliers: Lookup[]; recipes: (Lookup & { material: string; specification: string; kgPerMetre: string; wastePercent: string; route: string[]; overheadPerMetre: string })[]; workers: Lookup[]; shifts: Lookup[]; machines: Lookup[] }
export interface Notice { id: string; title: string; description: string; severity: 'warning' | 'danger' | 'success'; href: string }
export interface Dashboard { activeOrders: number; dueSoon: number; delayed: number; availableYarn: string; todayOutput: string; previousOutput: string; pendingQuality: number; passed: number; rejected: number; finishedRolls: number; pendingDispatch: number; running: number; idle: number; breakdown: number; totalMachines: number; series: { date: string; label: string; output: number; target: number }[]; orders: OrderSummary[]; machines: MachineSummary[]; alerts: Notice[]; activity: { id: string; action: string; detail: string; actorName: string; createdAt: string }[]; finance?: { billed: string; received: string; cost: string; outstanding: string }; date: string }

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
