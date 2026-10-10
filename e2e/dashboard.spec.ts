import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './helpers.js';

test.describe('Dashboard Overview Page', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test('displays all dashboard header elements, KPIs, and overview ribbon', async ({ page }) => {
    await page.goto('/');

    // Topbar verification
    await expect(page.locator('.topbar .breadcrumb strong')).toHaveText('Overview');
    await expect(page.locator('.live-indicator')).toBeVisible();
    await expect(page.locator('.global-search')).toBeVisible();

    // Page Heading & Date button
    await expect(page.locator('.page-heading h1')).toContainText('Good');
    const dateInput = page.locator('label.date-button input[type="date"]');
    await expect(dateInput).toBeVisible();

    // Export button
    await expect(page.getByRole('button', { name: /Export/i })).toBeVisible();

    // Overview ribbon
    const ribbon = page.locator('.overview-ribbon');
    await expect(ribbon).toBeVisible();
    await expect(ribbon).toContainText(/THE FLOOR IS MOVING/i);
    await expect(ribbon.getByRole('button', { name: /View factory floor/i })).toBeVisible();

    // 4 KPI cards
    const kpis = page.locator('.kpi-grid .kpi');
    await expect(kpis).toHaveCount(4);
    await expect(kpis.nth(0)).toContainText('Active orders');
    await expect(kpis.nth(1)).toContainText('Reported production');
    await expect(kpis.nth(2)).toContainText('Machines running');
    await expect(kpis.nth(3)).toContainText('Awaiting inspection');
  });

  test('renders production overview chart and needs-attention alerts', async ({ page }) => {
    await page.goto('/');

    // Production chart panel
    const chartPanel = page.locator('.production-chart-panel');
    await expect(chartPanel).toBeVisible();
    await expect(chartPanel).toContainText('Production overview');
    await expect(chartPanel.locator('.chart-legend')).toContainText('Reported output');
    await expect(chartPanel.locator('.chart-legend')).toContainText('Shift capacity');

    // Chart SVG container
    await expect(chartPanel.locator('.recharts-responsive-container')).toBeVisible();

    // Needs attention panel
    const attentionPanel = page.locator('.attention-panel');
    await expect(attentionPanel).toBeVisible();
    await expect(attentionPanel).toContainText('Needs your attention');
    await expect(attentionPanel.locator('.alert-card').first()).toBeVisible();
  });

  test('displays orders table, machine floor mini-grid, and recent activity', async ({ page }) => {
    await page.goto('/');

    // Orders table
    const ordersPanel = page.locator('.dashboard-bottom .panel').first();
    await expect(ordersPanel).toContainText('Orders in focus');
    await expect(ordersPanel.locator('table.data-table')).toBeVisible();
    await expect(ordersPanel.locator('tbody tr').first()).toBeVisible();

    // Machine floor mini-grid
    const machinePanel = page.locator('.dashboard-bottom .panel').nth(1);
    await expect(machinePanel).toContainText('The factory floor');
    const miniMachines = machinePanel.locator('.mini-machine');
    expect(await miniMachines.count()).toBeGreaterThan(0);

    // Floor legend
    await expect(machinePanel.locator('.floor-legend')).toContainText('Running');
    await expect(machinePanel.locator('.floor-legend')).toContainText('Idle');
    await expect(machinePanel.locator('.floor-legend')).toContainText('Breakdown');

    // Recent activity strip
    const activityStrip = page.locator('.activity-strip');
    await expect(activityStrip).toBeVisible();
    const activityItems = activityStrip.locator('> div');
    expect(await activityItems.count()).toBeGreaterThan(0);
  });
});
