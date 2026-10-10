import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './helpers.js';

test.describe('Quality Control & Roll Passport Traceability', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test('views quality control dashboard with KPIs, tabs, and rolls table', async ({ page }) => {
    await page.goto('/quality');

    await expect(page.locator('.topbar .breadcrumb strong')).toHaveText('Quality control');
    await expect(page.locator('.page-heading h1')).toContainText('Quality in every thread');

    // 4 KPI cards
    const kpis = page.locator('.kpi-grid .kpi');
    await expect(kpis).toHaveCount(4);
    await expect(kpis.nth(0)).toContainText('Awaiting inspection');
    await expect(kpis.nth(1)).toContainText('Quality approved');
    await expect(kpis.nth(2)).toContainText('Needs rework');
    await expect(kpis.nth(3)).toContainText('Available to ship');

    // Tabs
    const tabs = page.locator('.tabs button');
    await expect(tabs.filter({ hasText: 'All rolls' })).toBeVisible();

    // Table rows
    const rows = page.locator('table.data-table tbody tr');
    expect(await rows.count()).toBeGreaterThan(0);
  });

  test('navigates to Roll Passport and verifies fabric passport details & QR code', async ({ page }) => {
    await page.goto('/quality');

    // Click the roll link in the first row
    const rollLink = page.locator('table.data-table button.roll-link').first();
    await rollLink.click();

    // Verify Roll Passport page
    await expect(page).toHaveURL(/\/rolls\/[a-zA-Z0-9_-]+/);
    await expect(page.locator('.passport-layout')).toBeVisible();

    // Left passport card
    const passportCard = page.locator('.passport-card');
    await expect(passportCard).toBeVisible();
    await expect(passportCard.locator('.passport-fabric')).toBeVisible();
    await expect(passportCard.locator('img')).toBeVisible(); // QR code img

    // Right journey panels
    await expect(page.locator('.panel', { hasText: 'From yarn to finished fabric' })).toBeVisible();
    await expect(page.locator('.panel', { hasText: 'Quality history' })).toBeVisible();

    // Back link returns to quality
    await page.locator('.back-link').click();
    await expect(page).toHaveURL(/\/quality$/);
  });

  test('views finished goods rolls page', async ({ page }) => {
    await page.goto('/rolls');

    await expect(page.locator('.topbar .breadcrumb strong')).toHaveText('Finished rolls');
    await expect(page.locator('.page-heading h1')).toContainText('Every roll has a story');
    await expect(page.locator('table.data-table tbody tr').first()).toBeVisible();
  });
});
