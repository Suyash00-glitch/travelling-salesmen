import { test, expect } from '@playwright/test';
import { loginAsBuyer } from './helpers.js';

test.describe('Buyer Portal & Access Control Guards', () => {
  test('logs in as buyer and interacts with personalized orders and shipments', async ({ page }) => {
    await loginAsBuyer(page);

    // Verify buyer landing page
    await expect(page).toHaveURL(/\/buyer/);
    await expect(page.locator('.topbar .breadcrumb strong')).toHaveText('Buyer workspace');

    // Welcome banner and fabric artwork
    await expect(page.locator('.buyer-welcome')).toBeVisible();
    await expect(page.locator('.buyer-welcome h2')).toContainText('Your next delivery');

    // Buyer order cards
    const orderCards = page.locator('.buyer-order-grid .buyer-order');
    expect(await orderCards.count()).toBeGreaterThan(0);
    const firstOrder = orderCards.first();
    await expect(firstOrder.locator('.badge')).toBeVisible();
    await expect(firstOrder.locator('.progress-wrap')).toBeVisible();
    await expect(firstOrder.getByRole('button', { name: /Follow this order/i })).toBeVisible();

    // Switch to Your shipments tab
    const tabs = page.locator('.buyer-tabs button');
    await tabs.filter({ hasText: 'Your shipments' }).click();

    // Shipment tracker should be shown
    await expect(page.locator('.page-heading h1')).toContainText('Your deliveries.');
  });

  test('guards prevent buyer from accessing administrative and internal operational areas', async ({ page }) => {
    await loginAsBuyer(page);

    // Attempt direct navigation to Settings
    await page.goto('/settings');
    await expect(page.getByText('This area is for another team')).toBeVisible();
    await expect(page.getByText('Your role doesn’t have access to this part of the workspace.')).toBeVisible();

    // Attempt direct navigation to Finance
    await page.goto('/finance');
    await expect(page.getByText('This area is for another team')).toBeVisible();
  });
});
