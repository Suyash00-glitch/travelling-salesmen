import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './helpers.js';

test.describe('Orders & Order Details Journey', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test('views orders list with summary metrics, filter tabs, and search', async ({ page }) => {
    await page.goto('/orders');

    // Breadcrumb and header
    await expect(page.locator('.topbar .breadcrumb strong')).toHaveText('Orders');
    await expect(page.locator('.page-heading h1')).toContainText('Orders');

    // Summary strip
    const summaryStrip = page.locator('.summary-strip');
    await expect(summaryStrip).toBeVisible();
    await expect(summaryStrip).toContainText('Total orders');
    await expect(summaryStrip).toContainText('In production');
    await expect(summaryStrip).toContainText('Ready / partial');
    await expect(summaryStrip).toContainText('Completed');

    // Tabs
    const tabs = page.locator('.tabs button');
    await expect(tabs.filter({ hasText: 'All orders' })).toBeVisible();
    await expect(tabs.filter({ hasText: 'In production' })).toBeVisible();
    await expect(tabs.filter({ hasText: 'Ready to ship' })).toBeVisible();
    await expect(tabs.filter({ hasText: 'Completed' })).toBeVisible();

    // Table rows
    const rows = page.locator('table.data-table tbody tr');
    expect(await rows.count()).toBeGreaterThan(0);

    // Search filter
    const searchInput = page.locator('.search-box input');
    await searchInput.fill('Arvind');
    await expect(page.locator('table.data-table')).toContainText('Arvind');
  });

  test('opens order details and validates production stages, materials and timeline', async ({ page }) => {
    await page.goto('/orders');

    // Click the first order in the table
    const firstRow = page.locator('table.data-table tbody tr').first();
    await firstRow.click();

    // Now on order details page
    await expect(page).toHaveURL(/\/orders\/[a-zA-Z0-9_-]+/);
    await expect(page.locator('.back-link')).toBeVisible();

    // Verify summary metrics on detail page
    const summaryStrip = page.locator('.summary-strip');
    await expect(summaryStrip).toBeVisible();
    await expect(summaryStrip).toContainText('Ordered');
    await expect(summaryStrip).toContainText('Produced');
    await expect(summaryStrip).toContainText('Quality approved');
    await expect(summaryStrip).toContainText('Dispatched');

    // The production journey panel
    const journeyPanel = page.locator('.panel', { hasText: 'The production journey' });
    await expect(journeyPanel).toBeVisible();
    await expect(journeyPanel.locator('.stage-node').first()).toBeVisible();

    // Order details and timeline panels
    await expect(page.locator('.panel', { hasText: 'Order details' })).toBeVisible();
    await expect(page.locator('.panel', { hasText: 'Order timeline' })).toBeVisible();

    // Back link returns to orders
    await page.locator('.back-link').click();
    await expect(page).toHaveURL(/\/orders$/);
  });

  test('opens and cancels the new order creation modal', async ({ page }) => {
    await page.goto('/orders');

    const newOrderBtn = page.getByRole('button', { name: /New order/i });
    await expect(newOrderBtn).toBeVisible();
    await newOrderBtn.click();

    const modal = page.locator('.dialog-content');
    await expect(modal).toBeVisible();
    await expect(modal).toContainText('New customer order');
    await expect(modal).toContainText('Prices are fixed per material');

    // Close/Cancel modal
    await modal.getByRole('button', { name: /Cancel/i }).click();
    await expect(modal).not.toBeVisible();
  });
});
