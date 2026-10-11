import { expect, test, type Page } from '@playwright/test';

const INTRODUCTION = 'LoomOS introduction';
const INTRO_STORAGE_KEY = 'loomos:intro:v1';

async function expectWorkspaceAvailable(page: Page) {
  await expect(page.getByRole('region', { name: INTRODUCTION })).toHaveCount(0);
  await expect(page.locator('.loom-entry-app')).not.toHaveAttribute('inert', '');
  await expect(page.locator('body')).not.toHaveCSS('overflow', 'hidden');
  await expect(page.getByRole('heading', { name: 'A good day starts here.' })).toBeVisible();
  await expect(page.getByLabel('Email address')).toBeEditable();
}

test.describe('LoomOS introduction', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.route('**/api/v1/auth/me', (route) => route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ error: { message: 'Please sign in.' } }),
    }));
  });

  test('plays once on initial entry and hands off to the mounted sign-in page', async ({ page }) => {
    await page.clock.install();
    await page.goto('/');

    await expect(page.getByRole('region', { name: INTRODUCTION })).toBeVisible();
    await expect(page.locator('.loom-entry-app')).toHaveAttribute('inert', '');
    await expect(page.locator('body')).toHaveCSS('overflow', 'hidden');
    // Authentication can resolve underneath the introduction without being interactive.
    await expect(page.locator('input[type="email"]')).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Skip introduction' })).toBeVisible();

    await page.clock.fastForward(7_000);

    await expectWorkspaceAvailable(page);
    expect(await page.evaluate((key) => sessionStorage.getItem(key), INTRO_STORAGE_KEY)).toBe('seen');
  });

  test('skip opens the workspace immediately and does not replay on reload', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Skip introduction' }).click();

    await expectWorkspaceAvailable(page);
    expect(await page.evaluate((key) => sessionStorage.getItem(key), INTRO_STORAGE_KEY)).toBe('seen');

    await page.reload();

    await expectWorkspaceAvailable(page);
  });

  test('pause keeps the introduction open and resume continues the handoff', async ({ page }) => {
    await page.clock.install();
    await page.goto('/');
    await expect(page.getByRole('region', { name: INTRODUCTION })).toBeVisible();

    await page.clock.fastForward(1_000);
    await page.getByRole('button', { name: 'Pause animation' }).click();
    await expect(page.getByRole('button', { name: 'Resume animation' })).toBeVisible();
    await page.clock.fastForward(10_000);
    await expect(page.getByRole('region', { name: INTRODUCTION })).toBeVisible();
    await expect(page.locator('.loom-entry-app')).toHaveAttribute('inert', '');

    await page.getByRole('button', { name: 'Resume animation' }).click();
    await page.clock.fastForward(1_000);
    await expect(page.getByRole('region', { name: INTRODUCTION })).toBeVisible();
    await page.clock.fastForward(6_000);

    await expectWorkspaceAvailable(page);
  });

  test('keyboard pause during the final fade completes the handoff instead of trapping the workspace', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-10-11T00:00:00Z') });
    await page.clock.pauseAt(new Date('2026-10-11T00:00:01Z'));
    await page.goto('/');
    const introduction = page.getByRole('region', { name: INTRODUCTION });
    const pause = page.getByRole('button', { name: 'Pause animation' });
    await expect(introduction).toBeVisible();
    await pause.focus();

    await page.clock.fastForward(5_750);
    await expect(introduction).toHaveAttribute('data-phase', 'exit');
    await expect(pause).toBeFocused();
    // The fading overlay ignores pointer clicks, but its focused control still accepts keys.
    await page.keyboard.press('Space');

    await expectWorkspaceAvailable(page);
  });

  test('respects reduced motion without delaying sign-in or locking scroll', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');

    await expectWorkspaceAvailable(page);
  });

  test('preserves direct CRM links without showing an introduction', async ({ page }) => {
    await page.goto('/orders');

    await expectWorkspaceAvailable(page);
    await expect(page).toHaveURL(/\/orders$/);
  });

  test('preserves the public buyer signup entry point', async ({ page }) => {
    await page.goto('/buyer/signup');

    await expect(page.getByRole('region', { name: INTRODUCTION })).toHaveCount(0);
    await expect(page.locator('.loom-entry-app')).not.toHaveAttribute('inert', '');
    await expect(page.locator('body')).not.toHaveCSS('overflow', 'hidden');
    await expect(page.locator('input[type="email"]')).toBeEditable();
    await expect(page).toHaveURL(/\/buyer\/signup$/);
  });

  test('keyboard users can navigate introduction controls and skip into sign-in', async ({ page }) => {
    await page.goto('/');
    const introduction = page.getByRole('region', { name: INTRODUCTION });
    const skip = page.getByRole('button', { name: 'Skip introduction' });
    await introduction.getByRole('button').first().focus();
    await page.keyboard.press('Tab');
    expect(await introduction.evaluate((element) => element.contains(document.activeElement))).toBe(true);

    await skip.focus();
    await page.keyboard.press('Enter');

    await expectWorkspaceAvailable(page);
    await page.getByLabel('Email address').focus();
    await expect(page.getByLabel('Email address')).toBeFocused();
  });

  test('fits a narrow mobile viewport and restores ordinary scrolling', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    const introduction = page.getByRole('region', { name: INTRODUCTION });
    await expect(introduction).toBeVisible();
    const bounds = await introduction.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.width).toBeLessThanOrEqual(390);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    await page.getByRole('button', { name: 'Skip introduction' }).click();

    await expectWorkspaceAvailable(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    expect(await page.evaluate(() => {
      const scrollable = document.documentElement.scrollHeight > window.innerHeight;
      return !scrollable || window.scrollY > 0;
    })).toBe(true);
  });
});
