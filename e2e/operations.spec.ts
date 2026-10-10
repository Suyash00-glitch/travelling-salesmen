import { test, expect } from '@playwright/test';
import { loginAs, loginAsAdmin } from './helpers.js';

test.describe('Factory operations', () => {
  test('supervisor sees the current shift and checks a worker out and in', async ({ page }) => {
    await loginAs(page, 'supervisor@loomos.demo');
    await expect(page.locator('.page-heading .eyebrow')).toContainText('SHIFT SUPERVISOR');
    await page.goto('/workforce');
    await expect(page.locator('.kpi', { hasText: 'Current shift' })).not.toContainText('None');
    const row = page.locator('.record', { hasText: 'Mohan Lal' });
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: 'Check out' }).click();
    await expect(page.locator('.record', { hasText: 'Mohan Lal' })).toHaveCount(0, { timeout: 15000 });

    await page.getByRole('button', { name: 'Check in' }).first().click();
    const form = page.locator('.dialog-content');
    await form.locator('select[name="workerId"]').selectOption({ label: 'Mohan Lal' });
    await form.getByRole('button', { name: 'Check in' }).click();
    await expect(page.locator('.record', { hasText: 'Mohan Lal' })).toBeVisible({ timeout: 15000 });
  });

  test('production manager cannot check workers in', async ({ page }) => {
    await loginAs(page, 'production@loomos.demo');
    await page.goto('/workforce');
    await expect(page.locator('.page-heading h1')).toContainText('Workers & shifts');
    await expect(page.getByRole('button', { name: 'Check in' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Check out' })).toHaveCount(0);
  });

  test('shift supervisor sees the floor but can only hand work over, never assign or start it', async ({ page }) => {
    await loginAs(page, 'supervisor@loomos.demo');
    await page.goto('/production');
    await expect(page.locator('.page-heading p')).toContainText('Hand over');
    await expect(page.getByRole('button', { name: 'New batch' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Assign machine/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Start production/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Finish/ })).toHaveCount(0);
    const running = page.locator('.job-card', { hasText: 'Running' }).first();
    await expect(running.getByRole('button', { name: 'Hand over' })).toBeVisible();
  });

  test('machine floor: maintenance repairs a broken machine, the supervisor reports a breakdown', async ({ page }) => {
    // The supervisor can report a breakdown but cannot confirm a repair.
    await loginAs(page, 'supervisor@loomos.demo');
    await page.goto('/machines');
    await expect(page.locator('.page-heading h1')).toContainText('Machines');
    await page.locator('.job-card', { hasText: 'LM-02' }).click();
    await expect(page.locator('.dialog-content')).toContainText('Breakdown');
    await expect(page.locator('.dialog-content').getByRole('button', { name: /Repaired/ })).toHaveCount(0);
    await expect(page.locator('.dialog-content')).toContainText('Maintenance will confirm');
    await page.keyboard.press('Escape');

    await loginAs(page, 'maintenance@loomos.demo');
    await page.goto('/machines');
    await page.locator('.job-card', { hasText: 'LM-02' }).click();
    const modal = page.locator('.dialog-content');
    await expect(modal).toContainText('Breakdown');
    await modal.getByRole('button', { name: /Repaired/ }).click();
    const form = page.locator('.dialog-content').last();
    await form.locator('textarea[name="reason"]').fill('Warp beam replaced');
    await form.getByRole('button', { name: 'Mark as repaired' }).click();
    await expect(page.locator('.job-card', { hasText: 'LM-02' })).toContainText('Idle', { timeout: 15000 });
    await page.keyboard.press('Escape');

    await loginAs(page, 'supervisor@loomos.demo');
    await page.goto('/machines');
    await page.locator('.job-card', { hasText: 'LM-02' }).click();
    await page.locator('.dialog-content').getByRole('button', { name: 'Report breakdown' }).click();
    await page.locator('.dialog-content').last().locator('textarea[name="reason"]').fill('Belt snapped');
    await page.locator('.dialog-content').last().getByRole('button', { name: 'Report breakdown' }).click();
    await expect(page.locator('.job-card', { hasText: 'LM-02' })).toContainText('Breakdown', { timeout: 15000 });
  });

  test('inventory shows stock by material and lot ledger', async ({ page }) => {
    await loginAs(page, 'inventory@loomos.demo');
    await page.goto('/inventory');
    await expect(page.locator('.panel', { hasText: 'Stock by material' })).toContainText('Used in production');
    await expect(page.locator('.panel', { hasText: 'Yarn lots' }).locator('tbody tr').first()).toBeVisible();
  });

  test('dispatch: separate tabs, confirm a loaded truck, mark it delivered', async ({ page }) => {
    await loginAs(page, 'dispatch@loomos.demo');
    await page.goto('/dispatch');
    await expect(page.locator('.kpi', { hasText: 'Ready to dispatch' })).toBeVisible();
    await page.getByRole('button', { name: /On the road/ }).click();
    const row = page.locator('tbody tr').first();
    // Deliver a truck if one is on the road (a previous run may already have delivered it).
    if (await row.isVisible().catch(() => false)) {
      await expect(row).toContainText('In transit');
      await row.getByRole('button', { name: 'Delivered' }).click();
      await page.locator('.dialog-content').getByRole('button', { name: 'Mark delivered' }).click();
      await expect(page.locator('.dialog-content')).not.toBeVisible();
    }
    await page.getByRole('button', { name: /^Delivered/ }).click();
    await expect(page.locator('tbody tr').first()).toContainText('Delivered', { timeout: 15000 });
  });

  test('accounts: invoices with outstanding amounts, record a payment, open claims', async ({ page }) => {
    await loginAs(page, 'accounts@loomos.demo');
    await page.goto('/finance');
    await expect(page.locator('.kpi', { hasText: 'Outstanding' })).toBeVisible();
    await expect(page.locator('.kpi', { hasText: 'Overdue' })).toBeVisible();
    const row = page.locator('tbody tr', { hasText: 'Record payment' }).first();
    await row.getByRole('button', { name: 'Record payment' }).click();
    const form = page.locator('.dialog-content');
    await form.locator('input[name="amount"]').fill('1000');
    await form.locator('input[name="reference"]').fill(`E2E-${Date.now()}`);
    await form.getByRole('button', { name: 'Record payment' }).click();
    await expect(form).not.toBeVisible();
    await page.getByRole('button', { name: 'Claims' }).click();
    await expect(page.getByRole('button', { name: 'New claim' })).toBeVisible();
  });

  test('quality and finished rolls', async ({ page }) => {
    await loginAs(page, 'quality@loomos.demo');
    await page.goto('/quality');
    await expect(page.locator('.page-heading h1')).toContainText('Quality inspection');
    await expect(page.locator('.kpi', { hasText: 'Awaiting inspection' })).toBeVisible();
    await expect(page.locator('tbody tr').first()).toBeVisible();
    await page.goto('/rolls');
    await expect(page.locator('.page-heading h1')).toContainText('Finished fabric rolls');
  });

  test('admin: settings show material prices and reports open', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/settings');
    await page.getByRole('button', { name: 'Fabric recipes' }).click();
    await expect(page.locator('table.data-table th', { hasText: 'Price / m' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Set price' }).first()).toBeVisible();
    await page.goto('/reports');
    await expect(page.locator('.page-heading h1')).toContainText('Factory reports');
    await expect(page.getByText('Daily production output')).toBeVisible();
  });
});
