import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './helpers.js';

test.describe('Operations, Finance, Reports & Settings', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test('views inventory page, checks KPIs and opens lot history modal', async ({ page }) => {
    await page.goto('/inventory');

    await expect(page.locator('.topbar .breadcrumb strong')).toHaveText('Inventory');
    await expect(page.locator('.page-heading h1')).toContainText('Good fabric starts here');

    // KPIs
    const kpis = page.locator('.kpi-grid .kpi');
    await expect(kpis).toHaveCount(4);
    await expect(kpis.nth(0)).toContainText('Available yarn');
    await expect(kpis.nth(1)).toContainText('Reserved for production');

    // Table with swatch
    await expect(page.locator('.material-swatch').first()).toBeVisible();

    // Click history button on first row
    const historyBtn = page.locator('table.data-table tbody tr button.icon-button').first();
    await historyBtn.click();

    const modal = page.locator('.dialog-content');
    await expect(modal).toBeVisible();
    await expect(modal).toContainText('Stock ledger');

    await page.keyboard.press('Escape');
    await expect(modal).not.toBeVisible();
  });

  test('views procurement page with connected suppliers and purchase orders', async ({ page }) => {
    await page.goto('/procurement');

    await expect(page.locator('.topbar .breadcrumb strong')).toHaveText('Procurement');
    await expect(page.locator('.page-heading h1')).toContainText('Always a thread ahead');

    // Suppliers grid
    const supplierCards = page.locator('.supplier-card');
    expect(await supplierCards.count()).toBeGreaterThan(0);

    // Purchase orders panel and table
    await expect(page.locator('.panel', { hasText: 'Purchase orders' })).toBeVisible();
    await expect(page.locator('table.data-table tbody tr').first()).toBeVisible();
  });

  test('views dispatch page with shipment cards and transport details', async ({ page }) => {
    await page.goto('/dispatch');

    await expect(page.locator('.topbar .breadcrumb strong')).toHaveText('Dispatch');
    await expect(page.locator('.page-heading h1')).toContainText('The final mile, done right.');

    // Shipment cards
    const shipmentCards = page.locator('.shipment-card');
    expect(await shipmentCards.count()).toBeGreaterThan(0);
    await expect(shipmentCards.first().locator('.shipment-route')).toBeVisible();
  });

  test('views workforce page with shift schedule and worker details modal', async ({ page }) => {
    await page.goto('/workforce');

    await expect(page.locator('.topbar .breadcrumb strong')).toHaveText('Workers & shifts');
    await expect(page.locator('.page-heading h1')).toContainText('The people behind every metre');

    // Summary strip
    await expect(page.locator('.summary-strip')).toContainText('Team members');
    await expect(page.locator('.summary-strip')).toContainText('Present today');

    // Shift cards
    const shiftCards = page.locator('.shift-cards > div');
    expect(await shiftCards.count()).toBeGreaterThan(0);

    // Click on worker row to view attendance ledger modal
    const firstWorkerRow = page.locator('table.data-table tbody tr').first();
    await firstWorkerRow.click();

    const modal = page.locator('.dialog-content');
    await expect(modal).toBeVisible();
    await expect(modal).toContainText('Attendance & wage history');

    await page.keyboard.press('Escape');
    await expect(modal).not.toBeVisible();
  });

  test('views finance page with KPIs, cost chart, and invoice tabs', async ({ page }) => {
    await page.goto('/finance');

    await expect(page.locator('.topbar .breadcrumb strong')).toHaveText('Finance');
    await expect(page.locator('.page-heading h1')).toContainText('Know what every metre means');

    // KPIs
    const kpis = page.locator('.kpi-grid .kpi');
    await expect(kpis).toHaveCount(4);
    await expect(kpis.nth(0)).toContainText('Revenue billed');
    await expect(kpis.nth(1)).toContainText('Payments received');

    // Cost chart panel
    await expect(page.locator('.panel', { hasText: 'Where the cost goes' })).toBeVisible();
    await expect(page.locator('.panel', { hasText: 'The bigger picture' })).toBeVisible();

    // Tabs
    const tabs = page.locator('.tabs button');
    await expect(tabs.filter({ hasText: 'Buyer invoices' })).toBeVisible();
    await expect(tabs.filter({ hasText: 'Supplier bills' })).toBeVisible();
    await expect(tabs.filter({ hasText: 'Order profitability' })).toBeVisible();

    // Switch tab
    await tabs.filter({ hasText: 'Supplier bills' }).click();
    await expect(page.locator('table.data-table th', { hasText: 'Receipt reference' })).toBeVisible();
  });

  test('views reports page with operational brief and output vs capacity', async ({ page }) => {
    await page.goto('/reports');

    await expect(page.locator('.topbar .breadcrumb strong')).toHaveText('Reports');
    await expect(page.locator('.report-intro')).toContainText('THE OPERATIONS BRIEF');

    // Machine output report table
    await expect(page.locator('.panel', { hasText: 'Machine output report' })).toBeVisible();
    await expect(page.locator('table.data-table tbody tr').first()).toBeVisible();
  });

  test('views settings page with team access, recipes, and audit trail', async ({ page }) => {
    await page.goto('/settings');

    await expect(page.locator('.topbar .breadcrumb strong')).toHaveText('Settings');
    await expect(page.locator('.settings-summary')).toContainText('Everest Textile Mills');

    // Switch to Fabric recipes tab
    const tabs = page.locator('.settings-tabs button');
    await tabs.filter({ hasText: 'Fabric recipes' }).click();
    await expect(page.locator('table.data-table th', { hasText: 'Fabric recipe' })).toBeVisible();

    // Switch to Audit trail tab
    await tabs.filter({ hasText: 'Audit trail' }).click();
    await expect(page.locator('table.data-table th', { hasText: 'Recorded' })).toBeVisible();
  });
});
