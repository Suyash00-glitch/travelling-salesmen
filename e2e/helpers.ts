import { type Page, expect } from '@playwright/test';

export async function loginAsAdmin(page: Page) {
  await page.goto('/login');
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
  await page.goto('/login');
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

// Sign in as any demo account (signs out first if someone else is in).
export async function loginAs(page: Page, email: string) {
  // Drop any earlier session cookie, so the sign-in form is shown whatever the screen size.
  await page.context().clearCookies();
  await page.goto('/login');
  const skip = page.getByRole('button', { name: 'Skip introduction' });
  if (await skip.isVisible().catch(() => false)) await skip.click();
  const emailInput = page.locator('input[type="email"]');
  await expect(emailInput).toBeVisible({ timeout: 30000 });
  await emailInput.fill(email);
  await page.locator('input[placeholder="Enter your password"]').fill('LoomDemo2026!');
  await page.getByRole('button', { name: /Sign in to workspace/i }).click();
  await expect(page.locator('.workspace-main')).toBeVisible({ timeout: 15000 });
}
