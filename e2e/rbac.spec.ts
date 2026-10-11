import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './helpers.js';

test.describe('Super Admin RBAC & Access Management', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test('views settings page with complete super admin RBAC control panel', async ({ page }) => {
    await page.goto('/settings');

    // Breadcrumb and headers
    await expect(page.locator('.topbar .breadcrumb strong')).toHaveText('Settings');
    await expect(page.locator('.page-heading h1')).toContainText('Workspace settings');
    await expect(page.locator('.settings-summary')).toContainText('Everest Textile Mills');

    // Check all 6 tabs
    const tabs = page.locator('.settings-tabs button');
    await expect(tabs.filter({ hasText: 'Team access' })).toBeVisible();
    await expect(tabs.filter({ hasText: 'Roles & permissions' })).toBeVisible();
    await expect(tabs.filter({ hasText: 'Facilities & depts' })).toBeVisible();
    await expect(tabs.filter({ hasText: 'Fabric recipes' })).toBeVisible();
    await expect(tabs.filter({ hasText: 'Buyers' })).toBeVisible();
    await expect(tabs.filter({ hasText: 'Audit trail' })).toBeVisible();
  });

  test('manages users with search, role filters, and create user modal', async ({ page }) => {
    await page.goto('/settings');

    // Default tab is Team access
    await expect(page.locator('.panel', { hasText: 'User & Account Administration' })).toBeVisible();

    // Verify user count and users list
    const userRows = page.locator('table.data-table tbody tr');
    expect(await userRows.count()).toBeGreaterThan(0);

    // Search filter
    const searchInput = page.locator('input[placeholder="Search users by name, email or role…"]');
    await expect(searchInput).toBeVisible();
    await searchInput.fill('Aditya');
    await expect(page.locator('table.data-table tbody')).toContainText('Aditya Mehta');
    await searchInput.fill('');

    // Open create user modal
    const registerBtn = page.getByRole('button', { name: /Create user/i });
    await expect(registerBtn).toBeVisible();
    await registerBtn.click();

    const modal = page.locator('.dialog-content');
    await expect(modal).toBeVisible();
    await expect(modal).toContainText('Create User Account');
    await expect(modal.locator('input[type="email"]')).toBeVisible();

    // Close modal
    await page.keyboard.press('Escape');
    await expect(modal).not.toBeVisible();
  });

  test('inspects roles and permission matrix grid', async ({ page }) => {
    await page.goto('/settings');

    // Switch to Roles & permissions tab
    const tabs = page.locator('.settings-tabs button');
    await tabs.filter({ hasText: 'Roles & permissions' }).click();

    await expect(page.locator('.panel', { hasText: 'Role & Permission Templates' })).toBeVisible();

    // Verify role rows exist (including spinning, weaving, dyeing operators)
    await expect(page.locator('table.data-table strong', { hasText: 'Super Administrator' })).toBeVisible();
    await expect(page.locator('table.data-table strong', { hasText: 'Spinning Operator' })).toBeVisible();
    await expect(page.locator('table.data-table strong', { hasText: 'Weaving Operator' })).toBeVisible();
    await expect(page.locator('table.data-table strong', { hasText: 'Dyeing Operator' })).toBeVisible();

    // Custom role modal
    const customRoleBtn = page.getByRole('button', { name: /Create custom role/i });
    await expect(customRoleBtn).toBeVisible();
    await customRoleBtn.click();

    const modal = page.locator('.dialog-content');
    await expect(modal).toBeVisible();
    await expect(modal).toContainText('Create Custom Role');

    await page.keyboard.press('Escape');
    await expect(modal).not.toBeVisible();
  });

  test('views facilities, departments, and scoped user statistics', async ({ page }) => {
    await page.goto('/settings');

    // Switch to Facilities & depts tab
    const tabs = page.locator('.settings-tabs button');
    await tabs.filter({ hasText: 'Facilities & depts' }).click();

    // Verify facility cards and department tables
    await expect(page.locator('.panel', { hasText: 'Manufacturing Facilities' })).toBeVisible();
    await expect(page.locator('.panel', { hasText: 'Departments & Stages' })).toBeVisible();

    // Check default factory ETM-01 is present
    await expect(page.locator('text=ETM-01')).toBeVisible();

    // Check departments are listed
    await expect(page.locator('td', { hasText: 'Spinning Department' })).toBeVisible();
    await expect(page.locator('td', { hasText: 'Weaving Shed' })).toBeVisible();
    await expect(page.locator('td', { hasText: 'Dyeing & Processing' })).toBeVisible();
  });

  test('views immutable audit trail with category filtering', async ({ page }) => {
    await page.goto('/settings');

    // Switch to Audit trail tab
    const tabs = page.locator('.settings-tabs button');
    await tabs.filter({ hasText: 'Audit trail' }).click();

    await expect(page.locator('.panel', { hasText: 'Immutable Audit Trail' })).toBeVisible();
    await expect(page.locator('table.data-table th', { hasText: 'Recorded' })).toBeVisible();
    await expect(page.locator('table.data-table th', { hasText: 'Actor' })).toBeVisible();
    await expect(page.locator('table.data-table th', { hasText: 'Action' })).toBeVisible();

    // Filter by category (the demo data always has production events)
    await expect(page.getByRole('button', { name: 'RBAC & Access' })).toBeVisible();
    await page.getByRole('button', { name: 'Production' }).click();

    // Check audit rows exist
    const rows = page.locator('table.data-table tbody tr');
    expect(await rows.count()).toBeGreaterThan(0);
  });
});

test.describe('Guided Operator Role Experience', () => {
  test('spinning operator sees stage-scoped console in production', async ({ page }) => {
    await page.goto('/');

    // Sign out if currently logged in
    const logoutBtn = page.getByLabel('Sign out');
    if (await logoutBtn.isVisible().catch(() => false)) {
      await logoutBtn.click();
      await page.waitForLoadState('domcontentloaded');
    }

    // Login as Spinning Operator
    const emailInput = page.locator('input[type="email"]');
    await expect(emailInput).toBeVisible();
    await emailInput.fill('spinning@loomos.demo');

    const passwordInput = page.locator('input[placeholder="Enter your password"]');
    await passwordInput.fill('LoomDemo2026!');
    await page.getByRole('button', { name: /Sign in to workspace/i }).click();

    await expect(page.locator('.workspace-main')).toBeVisible({ timeout: 10000 });

    // Navigate to production
    await page.goto('/production');
    await expect(page.locator('.page-heading h1')).toContainText('Production floor');

    // Operators see only their own stage.
    await expect(page.locator('.page-heading .eyebrow')).toContainText('SPINNING TEAM');
    await expect(page.locator('.kanban-column')).toHaveCount(1);
    await expect(page.locator('.kanban-column h2')).toHaveText('Spinning');
  });
});
