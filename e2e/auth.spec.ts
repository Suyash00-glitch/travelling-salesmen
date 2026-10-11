import { test, expect } from '@playwright/test';

test.describe('Authentication Flow', () => {
  test('renders login page with rich story and interactive password toggle', async ({ page }) => {
    await page.goto('/');

    // Check brand mark and headline
    await expect(page.locator('.brand')).toContainText('LoomOS');
    await expect(page.getByRole('heading', { level: 2, name: /A good day starts here/i })).toBeVisible();
    await expect(page.getByText('Everest Textile Mills')).toBeVisible();

    // The form starts empty: no demo account is filled in for you.
    const emailInput = page.locator('input[type="email"]');
    await expect(emailInput).toHaveValue('');

    // Test password show/hide toggle
    const passwordInput = page.locator('input[placeholder="Enter your password"]');
    await passwordInput.fill('Secret123');
    await expect(passwordInput).toHaveAttribute('type', 'password');

    // Click show password
    await page.getByLabel('Show password').click();
    await expect(passwordInput).toHaveAttribute('type', 'text');

    // Click hide password
    await page.getByLabel('Hide password').click();
    await expect(passwordInput).toHaveAttribute('type', 'password');
  });

  test('displays error message on invalid credentials', async ({ page }) => {
    await page.goto('/');

    await page.locator('input[type="email"]').fill('owner@loomos.demo');
    const passwordInput = page.locator('input[placeholder="Enter your password"]');
    await passwordInput.fill('WrongPassword123!');

    await page.getByRole('button', { name: /Sign in to workspace/i }).click();

    // Error banner should appear
    const errorBanner = page.locator('.error-banner');
    await expect(errorBanner).toBeVisible();
    await expect(errorBanner).toContainText(/Email or password is incorrect/i);
  });

  test('successfully logs in with demo credentials into workspace and can log out', async ({ page }) => {
    await page.goto('/');

    await page.locator('input[type="email"]').fill('owner@loomos.demo');
    const passwordInput = page.locator('input[placeholder="Enter your password"]');
    await passwordInput.fill('LoomDemo2026!');

    await page.getByRole('button', { name: /Sign in to workspace/i }).click();

    // Should enter workspace dashboard
    await expect(page.locator('.workspace-main')).toBeVisible();
    await expect(page.locator('.topbar')).toContainText('Workspace');
    await expect(page.locator('.mill-switch')).toContainText('Everest Textile Mills');
    await expect(page.getByText('Good morning, Aditya')
      .or(page.getByText('Good afternoon, Aditya'))
      .or(page.getByText('Good evening, Aditya'))
    ).toBeVisible();

    // Test Logout
    const logoutBtn = page.getByLabel('Sign out');
    await expect(logoutBtn).toBeVisible();
    await logoutBtn.click();

    // Should return to login page
    await expect(page.getByRole('heading', { level: 2, name: /A good day starts here/i })).toBeVisible();
  });
});
