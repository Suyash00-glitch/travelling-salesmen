import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './helpers.js';

test.describe('Workspace Navigation & System Modals', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test('opens global search modal, queries pages, and navigates', async ({ page }) => {
    await page.goto('/');

    // Click global search in topbar
    await page.locator('.global-search').click();

    // Verify modal is open
    const modal = page.locator('.dialog-content');
    await expect(modal).toBeVisible();
    await expect(modal).toContainText('Find your next action');

    // Type query
    const searchInput = modal.locator('.command-input input');
    await searchInput.fill('Inventory');

    // Result should show Inventory button
    const resultBtn = modal.locator('.command-results button', { hasText: 'Inventory' });
    await expect(resultBtn).toBeVisible();
    await resultBtn.click();

    // Modal closes and URL is now /inventory
    await expect(page).toHaveURL(/\/inventory/);
    await expect(page.locator('.topbar .breadcrumb strong')).toHaveText('Inventory');
  });

  test('opens factory notifications inbox modal', async ({ page }) => {
    await page.goto('/');

    const bellBtn = page.locator('.notification-button');
    await expect(bellBtn).toBeVisible();
    await bellBtn.click();

    const modal = page.locator('.dialog-content');
    await expect(modal).toBeVisible();
    await expect(modal).toContainText('Notifications');
    await expect(modal).toContainText('What happened, and what is waiting for you.');

    // Close modal
    await page.keyboard.press('Escape');
    await expect(modal).not.toBeVisible();
  });

  test('opens help & getting started modal from sidebar', async ({ page }) => {
    await page.goto('/');

    const helpBtn = page.getByRole('button', { name: /Help & getting started/i });
    await expect(helpBtn).toBeVisible();
    await helpBtn.click();

    const modal = page.locator('.dialog-content');
    await expect(modal).toBeVisible();
    await expect(modal).toContainText('Welcome to LoomOS');
    await expect(modal).toContainText('Receive & reserve yarn');
    await expect(modal).toContainText('Plan and record production');
    await expect(modal).toContainText('Inspect and trace fabric rolls');
    await expect(modal).toContainText('Verify dispatch and track payments');

    // Close modal
    await page.keyboard.press('Escape');
    await expect(modal).not.toBeVisible();
  });
});
