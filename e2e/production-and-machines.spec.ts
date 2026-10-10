import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './helpers.js';

test.describe('Production & Machine Floor Management', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test('views production kanban board with columns and job cards', async ({ page }) => {
    await page.goto('/production');

    // Breadcrumb and title
    await expect(page.locator('.topbar .breadcrumb strong')).toHaveText('Production');
    await expect(page.locator('.page-heading h1')).toContainText('Production board');

    // View switcher (Board / List)
    const segmentedControl = page.locator('.segmented-control');
    await expect(segmentedControl).toBeVisible();

    // Kanban board columns
    const kanban = page.locator('.kanban-board');
    await expect(kanban).toBeVisible();
    await expect(kanban).toContainText('Planned');
    await expect(kanban).toContainText('Ready to run');
    await expect(kanban).toContainText('On the floor');
    await expect(kanban).toContainText('Completed');

    // At least one job card should exist
    const jobCard = page.locator('.job-card').first();
    await expect(jobCard).toBeVisible();
    await expect(jobCard.locator('.badge')).toBeVisible();

    // Switch to List view
    await segmentedControl.getByRole('button', { name: 'List' }).click();
    await expect(page.locator('.job-list')).toBeVisible();
  });

  test('views machine floor, filters by status, and inspects machine details modal', async ({ page }) => {
    await page.goto('/machines');

    // Title and board note
    await expect(page.locator('.topbar .breadcrumb strong')).toHaveText('Machine floor');
    await expect(page.locator('.page-heading h1')).toContainText('Machine floor');
    await expect(page.locator('.reported-pill')).toContainText('Operator-reported data');

    // Machine filter buttons
    const filters = page.locator('.machine-filters button');
    await expect(filters.filter({ hasText: 'All machines' })).toBeVisible();
    await expect(filters.filter({ hasText: 'Running' })).toBeVisible();
    await expect(filters.filter({ hasText: 'Idle' })).toBeVisible();
    await expect(filters.filter({ hasText: 'Breakdown' })).toBeVisible();

    // Machine cards
    const cards = page.locator('.machine-card');
    expect(await cards.count()).toBeGreaterThan(0);

    const firstCard = cards.first();
    await expect(firstCard.locator('.machine-name h3')).toBeVisible();
    await expect(firstCard.locator('.loom-illustration')).toBeVisible();
    await expect(firstCard.locator('.machine-stats')).toBeVisible();

    // Click card to open modal
    await firstCard.click();

    const modal = page.locator('.dialog-content');
    await expect(modal).toBeVisible();
    await expect(modal.locator('.machine-detail-summary')).toBeVisible();
    await expect(modal.locator('.detail-section', { hasText: 'Current assignment' })).toBeVisible();
    await expect(modal.locator('.detail-section', { hasText: 'Recent output' })).toBeVisible();
    await expect(modal.locator('.detail-section', { hasText: 'Downtime history' })).toBeVisible();

    // Close modal
    await page.keyboard.press('Escape');
    await expect(modal).not.toBeVisible();
  });
});
