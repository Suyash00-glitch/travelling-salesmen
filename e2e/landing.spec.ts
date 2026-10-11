import { test, expect } from '@playwright/test';

// The public home page: a signed-out visitor lands here, not on the sign-in form.
test.describe('Landing page', () => {
  test.beforeEach(async ({ page }) => {
    await page.context().clearCookies();
  });

  test('shows the hero with sign-in and buyer entry points, and the threads canvas', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Every thread');
    await expect(page.locator('.lp-hero canvas')).toBeVisible();
    await expect(page.locator('.lp-nav').getByRole('link', { name: 'Sign in' })).toBeVisible();
    await expect(page.locator('.lp-nav').getByRole('link', { name: /Place an order/ })).toHaveAttribute('href', '/buyer/signup');
    // No sign-in form on the landing page itself.
    await expect(page.locator('input[type="email"]')).toHaveCount(0);
    // Every section is there.
    for (const heading of ['One screen for the whole mill.', 'From the gate to the truck.', 'See it as the person who does the job.', 'Place an order. Watch it move.', 'Built for the shed, not the boardroom.']) {
      await expect(page.getByRole('heading', { name: heading })).toBeAttached();
    }
  });

  test('a demo role opens the sign-in page with that account filled in, never signed in automatically', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: /Open as quality inspector/ }).click();
    await expect(page).toHaveURL(/\/login\?as=quality%40loomos\.demo/);
    const skip = page.getByRole('button', { name: 'Skip introduction' });
    if (await skip.isVisible().catch(() => false)) await skip.click();
    await expect(page.locator('input[type="email"]')).toHaveValue('quality@loomos.demo');
    await expect(page.locator('.workspace-main')).toHaveCount(0);
    await page.getByRole('button', { name: /Sign in to workspace/i }).click();
    await expect(page.locator('.workspace-main')).toBeVisible({ timeout: 15000 });
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator('.page-heading .eyebrow')).toContainText('QUALITY INSPECTOR');
  });

  test('sign in from the nav, then signing out returns to the landing page', async ({ page }) => {
    await page.goto('/');
    await page.locator('.lp-nav').getByRole('link', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('button', { name: '← Back to home' })).toBeVisible();
    await page.locator('input[type="email"]').fill('owner@loomos.demo');
    await page.locator('input[placeholder="Enter your password"]').fill('LoomDemo2026!');
    await page.getByRole('button', { name: /Sign in to workspace/i }).click();
    await expect(page.locator('.workspace-main')).toBeVisible({ timeout: 15000 });
    await expect(page).toHaveURL(/\/$/);
    await page.getByLabel('Sign out').click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Every thread', { timeout: 15000 });
  });

  test('buyer signup and staff signup are reachable from the page', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: /Create a buyer account/ }).first().click();
    await expect(page).toHaveURL(/\/buyer\/signup$/);
    await expect(page.getByRole('heading', { name: 'Create your buyer account' })).toBeVisible();
    await page.goto('/');
    await page.getByRole('link', { name: /Request a staff account/ }).click();
    await expect(page).toHaveURL(/\/signup$/);
    await expect(page.getByLabel('What is your job?')).toBeVisible();
  });

  test('fits a phone without sideways scrolling', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(800);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  });
});
