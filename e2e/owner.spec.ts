import { test, expect } from '@playwright/test';
import { loginAs } from './helpers.js';

// The owner's view: money this month, bills, shift history, and adding things from anywhere.
test.describe('Owner and accounts', () => {
  test('sign-in page has no demo shortcuts but keeps signup', async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/login');
    await expect(page.locator('input[type="email"]')).toHaveValue('');
    await expect(page.getByText('Quick Fill Demo Roles')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Request a staff account' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create a buyer account' })).toBeVisible();
  });

  test('accounts sees whether the mill made money and adds a bill', async ({ page }) => {
    await loginAs(page, 'accounts@loomos.demo');
    await page.goto('/finance');
    await expect(page.locator('.pnl-card')).toContainText(/DID WE MAKE MONEY/);
    await expect(page.locator('.panel', { hasText: 'Where the money went' }).locator('.donut-legend li')).toHaveCount(4);
    await expect(page.locator('.panel', { hasText: 'Six months at a glance' }).locator('.recharts-bar-rectangle').first()).toBeVisible();

    const number = `E2E-${Date.now()}`;
    await page.getByRole('button', { name: 'Add bill' }).click();
    const form = page.locator('.dialog-content');
    await form.locator('select[name="supplierId"]').selectOption({ label: 'Colourtex Dyes & Chemicals' });
    await form.locator('input[name="number"]').fill(number);
    await form.locator('input[name="amount"]').fill('12500');
    await form.getByRole('button', { name: 'Save bill' }).click();
    await expect(form).not.toBeVisible();
    await page.getByRole('button', { name: 'Bills to pay' }).click();
    await expect(page.locator('tbody tr', { hasText: number })).toContainText('Unpaid');
  });

  test('owner reads what happened in every shift', async ({ page }) => {
    await loginAs(page, 'owner@loomos.demo');
    await page.goto('/workforce?view=reports');
    await expect(page.locator('.panel', { hasText: 'Metres made per shift' })).toBeVisible();
    await page.getByRole('button', { name: '2 days ago' }).click();
    const cards = page.locator('.shift-grid > .panel');
    await expect(cards).toHaveCount(3);
    await expect(cards.first()).toContainText('Who worked');
    await expect(page.locator('.people-list span').first()).toBeVisible();
  });

  test('owner dashboard has the charts, and the New menu adds a buyer', async ({ page }) => {
    await loginAs(page, 'owner@loomos.demo');
    await expect(page.locator('.panel', { hasText: 'Machines right now' }).locator('.donut')).toBeVisible();
    await expect(page.locator('.panel', { hasText: 'Orders by stage' }).locator('.hbar')).toHaveCount(7);
    await page.getByRole('button', { name: 'New' }).click();
    for (const item of ['Order', 'Bill to pay', 'Machine', 'Worker', 'Shift', 'User login']) {
      await expect(page.getByRole('menuitem', { name: new RegExp(`^${item}`) })).toBeVisible();
    }
    await page.getByRole('menuitem', { name: /^Buyer/ }).click();
    const form = page.locator('.dialog-content');
    const name = `E2E Buyer ${Date.now()}`;
    await form.locator('input[name="name"]').fill(name);
    await form.locator('input[name="email"]').fill('e2e@example.test');
    await form.locator('input[name="city"]').fill('Surat');
    await form.getByRole('button', { name: 'Add buyer' }).click();
    await expect(form).not.toBeVisible();
  });

  test('operators get no New menu items they cannot use', async ({ page }) => {
    await loginAs(page, 'weaving@loomos.demo');
    await expect(page.getByRole('button', { name: 'New' })).toHaveCount(0);
  });
});
