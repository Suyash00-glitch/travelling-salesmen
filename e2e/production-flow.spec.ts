import { test, expect } from '@playwright/test';
import { loginAs } from './helpers.js';

// The core floor journey: new batch → assign → explicit start → finish → hand over.
test.describe('Production flow', () => {
  test('manager creates a stock batch, assigns a machine and operator, starts and finishes the stage', async ({ page }) => {
    await loginAs(page, 'production@loomos.demo');
    await page.goto('/production');
    await expect(page.locator('.page-heading h1')).toContainText('Production floor');

    // A unique colour per run, so leftovers from earlier runs never match.
    const color = `E2E ecru ${Date.now().toString(36)}`;
    await page.getByRole('button', { name: 'New batch' }).click();
    const form = page.locator('.dialog-content');
    await form.locator('select[name="recipeId"]').selectOption({ index: 1 });
    await form.locator('input[name="color"]').fill(color);
    await form.locator('input[name="quantity"]').fill('120');
    await form.locator('select[name="stageChoice"]').selectOption('DYEING'); // dyeing only: a dyer is free in the demo data
    await form.getByRole('button', { name: 'Create batch' }).click();
    await expect(form).not.toBeVisible();

    // The new batch is waiting for a machine and operator.
    const card = page.locator('.job-card', { hasText: color }).first();
    await expect(card).toContainText('Needs machine & operator');
    await expect(card.getByRole('button', { name: /Start production/ })).toHaveCount(0);

    await card.getByRole('button', { name: 'Assign machine & operator' }).click();
    const assign = page.locator('.dialog-content');
    await assign.locator('select[name="machineId"]').selectOption({ index: 1 });
    await assign.locator('select[name="workerId"]').selectOption({ label: 'Mohan Lal · Dyeing operator' });
    await assign.getByRole('button', { name: 'Save assignment' }).click();
    await expect(assign).not.toBeVisible();

    // Assigned, but nothing has started yet.
    await expect(card).toContainText('Assigned');
    await expect(card).toContainText('Mohan Lal');
    await card.getByRole('button', { name: 'Start production' }).click();
    await expect(card).toContainText('Running', { timeout: 15000 });

    // Finishing asks for the final output of the run; the only stage completes the batch and leaves the board.
    await card.getByRole('button', { name: /Finish/ }).click();
    const finish = page.locator('.dialog-content');
    await expect(finish).toContainText('Finish dyeing');
    await expect(finish.locator('input[name="quantity"]')).toHaveValue('120');
    await finish.getByRole('button', { name: /Finish · send to quality/ }).click();
    await expect(finish).not.toBeVisible();
    await expect(page.locator('.job-card', { hasText: color })).toHaveCount(0, { timeout: 15000 });
    await page.getByLabel(/Show completed/).check();
    await expect(page.locator('.job-card', { hasText: color }).first()).toContainText('complete');
  });

  test('an operator sees only their own stage and cannot assign work', async ({ page }) => {
    await loginAs(page, 'dyeing@loomos.demo');
    await page.goto('/production');
    await expect(page.locator('.page-heading .eyebrow')).toContainText('DYEING TEAM');
    await expect(page.locator('.kanban-column')).toHaveCount(1);
    await expect(page.getByRole('button', { name: /Assign machine/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'New batch' })).toHaveCount(0);
    // Their own running job offers output, finish and pause.
    const mine = page.locator('.job-card', { hasText: 'Priya Sharma' }).first();
    await expect(mine.getByRole('button', { name: /Finish/ })).toBeVisible();
    await expect(mine.getByRole('button', { name: 'Output' })).toBeVisible();
  });

  test('batches page lists the batch with filters and detail', async ({ page }) => {
    await loginAs(page, 'production@loomos.demo');
    await page.goto('/batches');
    await expect(page.locator('.page-heading h1')).toContainText('Production batches');
    await page.getByLabel('Status').selectOption('ONGOING');
    await expect(page.locator('tbody tr').first()).toBeVisible();
    await page.locator('tbody tr').first().click();
    const detail = page.locator('.dialog-content');
    await expect(detail).toContainText('Rework');
    await expect(detail).toContainText('History');
  });
});
