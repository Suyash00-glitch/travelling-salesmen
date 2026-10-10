import { type Page, expect } from '@playwright/test';

export async function loginAsAdmin(page: Page) {
  await page.goto('/');
  // Check if already authenticated as Admin
  const isWorkspace = await page.locator('.workspace-main').isVisible().catch(() => false);
  if (isWorkspace) {
    const userName = await page.locator('.sidebar-user strong').textContent().catch(() => '');
    if (userName?.includes('Aditya Mehta')) {
      return;
    }
    const logoutBtn = page.getByLabel('Sign out');
    if (await logoutBtn.isVisible().catch(() => false)) {
      await logoutBtn.click();
      await page.waitForLoadState('domcontentloaded');
    }
  }

  const emailInput = page.locator('input[type="email"]');
  await expect(emailInput).toBeVisible();
  await emailInput.fill('owner@loomos.demo');

  const passwordInput = page.locator('input[placeholder="Enter your password"]');
  await passwordInput.fill('LoomDemo2026!');

  await page.getByRole('button', { name: /Sign in to workspace/i }).click();
  await expect(page.locator('.workspace-main')).toBeVisible({ timeout: 10000 });
}

export async function loginAsBuyer(page: Page) {
  await page.goto('/');
  const isWorkspace = await page.locator('.workspace-main').isVisible().catch(() => false);
  if (isWorkspace) {
    const userName = await page.locator('.sidebar-user strong').textContent().catch(() => '');
    if (userName?.includes('Arvind Textiles')) {
      return;
    }
    const logoutBtn = page.getByLabel('Sign out');
    if (await logoutBtn.isVisible().catch(() => false)) {
      await logoutBtn.click();
      await page.waitForLoadState('domcontentloaded');
    }
  }

  const emailInput = page.locator('input[type="email"]');
  await expect(emailInput).toBeVisible();
  await emailInput.fill('buyer@loomos.demo');

  const passwordInput = page.locator('input[placeholder="Enter your password"]');
  await passwordInput.fill('LoomDemo2026!');

  await page.getByRole('button', { name: /Sign in to workspace/i }).click();
  await expect(page.locator('.workspace-main')).toBeVisible({ timeout: 10000 });
}
