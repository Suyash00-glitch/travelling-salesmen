import { test, expect } from '@playwright/test';
import { loginAs } from './helpers.js';

test.describe('Buyer portal', () => {
  test('buyer sees fixed prices, places an order, and cannot pick a past date or an internal page', async ({ page }) => {
    await loginAs(page, 'buyer@loomos.demo');
    await expect(page.locator('.topbar .breadcrumb strong')).toHaveText('Buyer workspace');
    await expect(page.getByText('Materials and prices')).toBeVisible();
    await expect(page.locator('.flag', { hasText: 'Premium cotton poplin' })).toContainText('/m');

    await page.getByRole('button', { name: 'Place an order' }).click();
    const modal = page.locator('.dialog-content');
    await expect(modal).toContainText('Place an order');
    // No price field anywhere in the form.
    await expect(modal.locator('input[name="price"]')).toHaveCount(0);

    // The date picker does not allow today or earlier.
    const dateInput = modal.locator('input[type="date"]');
    const min = await dateInput.getAttribute('min');
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
    expect(min! > today).toBe(true);

    await modal.locator('.line-item select').selectOption({ index: 1 });
    await modal.locator('input[placeholder="e.g. Sage green"]').fill('Navy');
    await modal.locator('input[type="number"]').fill('150');
    await expect(modal).toContainText('Order total');
    await expect(modal.getByText(/Order total: ₹/)).not.toContainText('₹0');
    await modal.getByRole('button', { name: /Send order/ }).click();

    await expect(page).toHaveURL(/\/orders\//, { timeout: 15000 });
    await expect(page.locator('.badge', { hasText: /Waiting for review|Pending review/i }).first()).toBeVisible();

    await page.goto('/production');
    await expect(page.getByText('This area is for another team')).toBeVisible();
    await page.goto('/settings');
    await expect(page.getByText('This area is for another team')).toBeVisible();
  });

  test('buyer signup page is separate from staff signup', async ({ page }) => {
    await page.goto('/buyer/signup');
    await expect(page.getByRole('heading', { name: 'Create your buyer account' })).toBeVisible();
    await expect(page.getByLabel('Company name')).toBeVisible();
    await expect(page.getByLabel('What is your job?')).toHaveCount(0);
  });
});
