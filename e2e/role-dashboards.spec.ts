import { test, expect } from '@playwright/test';
import { loginAs } from './helpers.js';

// Every role lands on a dashboard made for it and sees only its own navigation.
const roles: [string, string, string[], string[]][] = [
  ['production@loomos.demo', 'Running now', ['Production', 'Machine floor'], ['Finance', 'Settings']],
  ['supervisor@loomos.demo', 'Current shift', ['Workers & shifts', 'Production'], ['Finance', 'Orders']],
  ['spinning@loomos.demo', 'Running now', ['Production'], ['Orders', 'Workers & shifts', 'Finance']],
  ['quality@loomos.demo', 'Awaiting inspection', ['Quality control'], ['Finance', 'Inventory']],
  ['dispatch@loomos.demo', 'Ready to dispatch', ['Dispatch'], ['Production', 'Inventory']],
  ['accounts@loomos.demo', 'Outstanding', ['Finance'], ['Production', 'Machine floor']],
  ['inventory@loomos.demo', 'Yarn available', ['Inventory'], ['Production', 'Finance']],
  ['operations@loomos.demo', 'Running now', ['Orders', 'Production', 'Machine floor', 'Reports'], ['Finance', 'Settings']],
  ['maintenance@loomos.demo', 'Breakdowns', ['Machine floor', 'Production'], ['Orders', 'Workers & shifts', 'Finance']],
];

for (const [email, card, visible, hidden] of roles) {
  test(`${email.split('@')[0]} dashboard and navigation`, async ({ page }) => {
    await loginAs(page, email);
    await expect(page.locator('.kpi', { hasText: card }).first()).toBeVisible();
    await expect(page.locator('.panel', { hasText: 'Needs attention' })).toBeVisible();
    for (const item of visible) await expect(page.locator('nav a', { hasText: item })).toBeVisible();
    for (const item of hidden) await expect(page.locator('nav a, .sidebar-bottom a', { hasText: item })).toHaveCount(0);
  });
}

test('pages stay readable on a phone', async ({ page }) => {
  await loginAs(page, 'owner@loomos.demo');
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ['/', '/orders', '/production', '/batches', '/machines', '/workforce', '/dispatch', '/finance', '/inventory', '/quality', '/rolls', '/procurement', '/reports', '/settings']) {
    await page.goto(path);
    await expect(page.locator('.page-heading h1')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), path).toBe(true);
    // Nothing inside a card sticks out of the card.
    const overflowing = await page.evaluate(() => {
      const out: string[] = [];
      for (const card of document.querySelectorAll('.panel, .kpi, .job-card, .record')) {
        const box = card.getBoundingClientRect();
        for (const el of card.querySelectorAll('*')) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          if (el.closest('.table-scroll, .overflow-x-auto, .history-list, .batch-modal-body')) continue;
          if (r.right > box.right + 2 || r.left < box.left - 2) {
            out.push(`${card.className.split(' ')[0]} > ${el.tagName.toLowerCase()}.${String((el as HTMLElement).className).split(' ')[0]}`);
            break;
          }
        }
      }
      return out;
    });
    expect(overflowing, path).toEqual([]);
  }
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
});
