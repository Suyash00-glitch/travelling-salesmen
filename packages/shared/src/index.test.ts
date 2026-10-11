import { describe, it, expect } from 'vitest';
import {
  can,
  roles,
  permissionResources,
  hasPermission,
  loginSchema,
  orderSchema,
  receiptSchema,
  reservationSchema,
  assignmentSchema,
  outputSchema,
  inspectionSchema,
  shipmentSchema,
  recipeSchema,
  userSchema,
  roleSchema,
  factorySchema,
  departmentSchema,
  type Area,
} from './index.js';

describe('Shared Package - Roles & Permissions', () => {
  it('defines all system roles including distinct spinning, weaving, and dyeing operators', () => {
    expect(roles).toEqual([
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
    ]);
  });

  it('allows ADMIN and SUPER_ADMIN access to every area including settings', () => {
    const areas = permissionResources.filter((r) => r !== 'users' && r !== 'roles') as Area[];
    for (const area of areas) {
      expect(can('ADMIN', area)).toBe(true);
      expect(can('SUPER_ADMIN', area)).toBe(true);
    }
  });

  it('strictly restricts BUYER to orders and not operational areas', () => {
    expect(can('BUYER', 'orders')).toBe(true);
    expect(can('BUYER', 'inventory')).toBe(false);
    expect(can('BUYER', 'procurement')).toBe(false);
    expect(can('BUYER', 'production')).toBe(false);
    expect(can('BUYER', 'machines')).toBe(false);
    expect(can('BUYER', 'finance')).toBe(false);
    expect(can('BUYER', 'settings')).toBe(false);
  });

  it('lets stage operators see production and machines but nothing else', () => {
    expect(can('SPINNING_OPERATOR', 'production')).toBe(true);
    expect(can('SPINNING_OPERATOR', 'machines')).toBe(true);
    expect(can('WEAVING_OPERATOR', 'production')).toBe(true);
    expect(can('DYEING_OPERATOR', 'production')).toBe(true);
    expect(can('SPINNING_OPERATOR', 'finance')).toBe(false);
    expect(can('SPINNING_OPERATOR', 'settings')).toBe(false);
    expect(can('SPINNING_OPERATOR', 'procurement')).toBe(false);
  });

  it('allows QUALITY_INSPECTOR access to quality and rolls', () => {
    expect(can('QUALITY_INSPECTOR', 'quality')).toBe(true);
    expect(can('QUALITY_INSPECTOR', 'rolls')).toBe(true);
    expect(can('QUALITY_INSPECTOR', 'finance')).toBe(false);
    expect(can('QUALITY_INSPECTOR', 'dispatch')).toBe(false);
  });

  it('allows DISPATCH_MANAGER access to dispatch, rolls, and orders', () => {
    expect(can('DISPATCH_MANAGER', 'dispatch')).toBe(true);
    expect(can('DISPATCH_MANAGER', 'rolls')).toBe(true);
    expect(can('DISPATCH_MANAGER', 'orders')).toBe(true);
    expect(can('DISPATCH_MANAGER', 'settings')).toBe(false);
  });
});

describe('Shared Package - Granular RBAC & Permission Matrix', () => {
  it('gives SUPER_ADMIN full access across all resources and actions', () => {
    const superAdminUser = { role: 'SUPER_ADMIN' };
    expect(hasPermission(superAdminUser, 'users', 'manage')).toBe(true);
    expect(hasPermission(superAdminUser, 'roles', 'manage')).toBe(true);
    expect(hasPermission(superAdminUser, 'orders', 'approve')).toBe(true);
    expect(hasPermission(superAdminUser, 'finance', 'manage')).toBe(true);
  });

  it('correctly evaluates operator granular permissions', () => {
    const spinningOp = { role: 'SPINNING_OPERATOR' };
    expect(hasPermission(spinningOp, 'production', 'view')).toBe(true);
    expect(hasPermission(spinningOp, 'production', 'update')).toBe(true);
    expect(hasPermission(spinningOp, 'machines', 'view')).toBe(true);
    expect(hasPermission(spinningOp, 'machines', 'update')).toBe(true);
    expect(hasPermission(spinningOp, 'orders', 'create')).toBe(false);
    expect(hasPermission(spinningOp, 'users', 'manage')).toBe(false);
  });

  it('evaluates multi-role union of permissions', () => {
    const multiRoleUser = {
      role: 'WEAVING_OPERATOR',
      roles: ['WEAVING_OPERATOR', 'QUALITY_INSPECTOR'],
    };
    // From WEAVING_OPERATOR
    expect(hasPermission(multiRoleUser, 'production', 'update')).toBe(true);
    // From QUALITY_INSPECTOR
    expect(hasPermission(multiRoleUser, 'quality', 'manage')).toBe(true);
    expect(hasPermission(multiRoleUser, 'rolls', 'manage')).toBe(true);
    // Denied to both
    expect(hasPermission(multiRoleUser, 'finance', 'manage')).toBe(false);
  });

  it('supports custom permissions assigned directly to user', () => {
    const customUser = {
      role: 'CUSTOM_CLERK',
      permissions: ['orders:view', 'inventory:view'],
    };
    expect(hasPermission(customUser, 'orders', 'view')).toBe(true);
    expect(hasPermission(customUser, 'inventory', 'view')).toBe(true);
    expect(hasPermission(customUser, 'orders', 'create')).toBe(false);
  });
});

describe('Shared Package - Zod Validation Schemas', () => {
  describe('loginSchema', () => {
    it('validates a standard user email and password', () => {
      const valid = loginSchema.safeParse({ email: 'owner@loomos.demo', password: 'password123' });
      expect(valid.success).toBe(true);
    });

    it('rejects invalid email formats', () => {
      const invalid = loginSchema.safeParse({ email: 'not-an-email', password: 'password123' });
      expect(invalid.success).toBe(false);
    });

    it('rejects empty password', () => {
      const invalid = loginSchema.safeParse({ email: 'test@example.com', password: '' });
      expect(invalid.success).toBe(false);
    });
  });

  describe('orderSchema', () => {
    const nextWeek = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);

    it('validates valid order payload with line items', () => {
      const valid = orderSchema.safeParse({
        buyerId: 'buyer-1',
        deadline: nextWeek,
        priority: 'HIGH',
        instructions: 'Handle with care',
        items: [{ recipeId: 'recipe-1', color: 'Navy', quantity: 1200 }],
      });
      expect(valid.success).toBe(true);
    });

    it('ignores any price sent by the client', () => {
      const parsed = orderSchema.parse({
        buyerId: 'buyer-1',
        deadline: nextWeek,
        items: [{ recipeId: 'recipe-1', color: 'Navy', quantity: 10, price: 0 }],
      });
      expect(parsed.items[0]).not.toHaveProperty('price');
    });

    it('rejects delivery dates that are today or in the past', () => {
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
      for (const deadline of [today, '2020-01-01']) {
        const res = orderSchema.safeParse({ buyerId: 'b', deadline, items: [{ recipeId: 'r', color: 'Navy', quantity: 10 }] });
        expect(res.success).toBe(false);
      }
    });

    it('rejects orders with empty line items', () => {
      const invalid = orderSchema.safeParse({
        buyerId: 'buyer-1',
        deadline: nextWeek,
        priority: 'NORMAL',
        items: [],
      });
      expect(invalid.success).toBe(false);
    });

    it('rejects zero or negative quantities', () => {
      const invalid = orderSchema.safeParse({
        buyerId: 'buyer-1',
        deadline: nextWeek,
        priority: 'NORMAL',
        items: [{ recipeId: 'recipe-1', color: 'Navy', quantity: 0 }],
      });
      expect(invalid.success).toBe(false);
    });
  });

  describe('receiptSchema', () => {
    it('parses valid yarn receipt with threshold default', () => {
      const res = receiptSchema.parse({
        supplierId: 'supp-1',
        reference: 'GRN-101',
        material: 'Cotton yarn',
        color: 'Natural',
        specification: '40s combed',
        quantity: 500,
        costPerKg: 280,
        location: 'Warehouse A',
      });
      expect(res.threshold).toBe(100);
      expect(res.quantity).toBe(500);
    });

    it('rejects non-positive quantity in receipt', () => {
      const invalid = receiptSchema.safeParse({
        supplierId: 'supp-1',
        reference: 'GRN-101',
        material: 'Cotton yarn',
        color: 'Natural',
        specification: '40s combed',
        quantity: -10,
        costPerKg: 280,
        location: 'Warehouse A',
      });
      expect(invalid.success).toBe(false);
    });
  });

  describe('inspectionSchema', () => {
    it('passes for PASSED inspection without defects', () => {
      const res = inspectionSchema.safeParse({
        result: 'PASSED',
        defects: [],
        notes: 'Roll passed all quality thresholds',
      });
      expect(res.success).toBe(true);
    });

    it('fails for REWORK inspection when defects array is empty', () => {
      const res = inspectionSchema.safeParse({
        result: 'REWORK',
        defects: [],
        notes: 'Needs rework',
      });
      expect(res.success).toBe(false);
    });

    it('passes for REWORK inspection when at least one defect is listed', () => {
      const res = inspectionSchema.safeParse({
        result: 'REWORK',
        defects: ['Uneven weave density'],
        notes: 'Send back to repair',
      });
      expect(res.success).toBe(true);
    });
  });

  describe('recipeSchema', () => {
    it('passes for unique production stages in route', () => {
      const res = recipeSchema.safeParse({
        name: 'Cotton Twill',
        material: 'Cotton yarn',
        specification: '30s carded',
        kgPerMetre: 0.22,
        wastePercent: 3,
        overheadPerMetre: 10,
        pricePerMetre: 180,
        route: ['WEAVING', 'DYEING'],
      });
      expect(res.success).toBe(true);
    });

    it('fails if stages in route are duplicate', () => {
      const res = recipeSchema.safeParse({
        name: 'Cotton Twill',
        material: 'Cotton yarn',
        specification: '30s carded',
        kgPerMetre: 0.22,
        wastePercent: 3,
        overheadPerMetre: 10,
        pricePerMetre: 180,
        route: ['WEAVING', 'WEAVING'],
      });
      expect(res.success).toBe(false);
    });
  });

  describe('userSchema', () => {
    it('rejects BUYER role if buyerId is missing', () => {
      const res = userSchema.safeParse({
        name: 'Buyer User',
        email: 'buyer@example.test',
        password: 'securePassword123!',
        role: 'BUYER',
      });
      expect(res.success).toBe(false);
    });

    it('allows BUYER role when buyerId is present', () => {
      const res = userSchema.safeParse({
        name: 'Buyer User',
        email: 'buyer@example.test',
        password: 'securePassword123!',
        role: 'BUYER',
        buyerId: 'buyer-123',
      });
      expect(res.success).toBe(true);
    });

    it('validates user creation with factory, department, and multiple roles', () => {
      const res = userSchema.safeParse({
        name: 'Floor Operator',
        email: 'operator@example.test',
        password: 'securePassword123!',
        role: 'WEAVING_OPERATOR',
        roles: ['WEAVING_OPERATOR', 'QUALITY_INSPECTOR'],
        factoryId: 'fac-1',
        departmentId: 'dept-1',
        active: true,
      });
      expect(res.success).toBe(true);
    });
  });

  describe('roleSchema', () => {
    it('validates custom role definition with permissions', () => {
      const res = roleSchema.safeParse({
        code: 'SPINNING_LEAD',
        name: 'Spinning Team Lead',
        description: 'Lead operator for spinning frames',
        permissions: ['production:view', 'production:update', 'machines:manage'],
      });
      expect(res.success).toBe(true);
    });

    it('rejects role codes with lowercase or invalid characters', () => {
      const res = roleSchema.safeParse({
        code: 'spinning_lead',
        name: 'Spinning Team Lead',
        permissions: [],
      });
      expect(res.success).toBe(false);
    });
  });

  describe('factorySchema & departmentSchema', () => {
    it('validates factory creation', () => {
      const res = factorySchema.safeParse({
        code: 'ETM-02',
        name: 'Everest Unit II',
        location: 'Surat, Gujarat',
        active: true,
      });
      expect(res.success).toBe(true);
    });

    it('validates department creation with factoryId link', () => {
      const res = departmentSchema.safeParse({
        code: 'WEAV-02',
        name: 'Weaving Unit II',
        factoryId: 'fac-1',
        active: true,
      });
      expect(res.success).toBe(true);
    });
  });

  describe('reservationSchema', () => {
    it('validates a valid yarn reservation', () => {
      const res = reservationSchema.safeParse({
        productionId: 'prod-1',
        lotId: 'lot-1',
        quantity: 120.5,
      });
      expect(res.success).toBe(true);
    });

    it('rejects reservation with non-positive quantity', () => {
      const res = reservationSchema.safeParse({
        productionId: 'prod-1',
        lotId: 'lot-1',
        quantity: 0,
      });
      expect(res.success).toBe(false);
    });
  });

  describe('assignmentSchema', () => {
    it('requires both a machine and a worker', () => {
      expect(assignmentSchema.safeParse({ machineId: 'm-1', workerId: 'w-1' }).success).toBe(true);
      expect(assignmentSchema.safeParse({ machineId: 'm-1' }).success).toBe(false);
      expect(assignmentSchema.safeParse({ workerId: 'w-1' }).success).toBe(false);
    });
  });

  describe('outputSchema', () => {
    it('validates production output with waste and roll lengths', () => {
      const res = outputSchema.safeParse({
        quantity: 200,
        waste: 4,
        hours: 2.5,
        rollLengths: [100, 100],
      });
      expect(res.success).toBe(true);
    });
  });

  describe('shipmentSchema', () => {
    it('rejects empty rollIds list', () => {
      const res = shipmentSchema.safeParse({
        orderId: 'order-1',
        rollIds: [],
        transport: 'Blue Dart',
      });
      expect(res.success).toBe(false);
    });

    it('accepts shipment with at least one roll', () => {
      const res = shipmentSchema.safeParse({
        orderId: 'order-1',
        rollIds: ['roll-1'],
        transport: 'Blue Dart',
      });
      expect(res.success).toBe(true);
    });
  });
});
