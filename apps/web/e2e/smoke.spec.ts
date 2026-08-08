import { expect, test } from '@playwright/test';

test.describe('BATON web smoke', () => {
  test('loads attention queue and navigates core screens', async ({ page }) => {
    await page.goto('/#/flow');
    await expect(page.locator('#screen-flow')).toBeVisible();
    await expect(page.locator('#screen-flow .screen-title')).toHaveText('Attention queue', { timeout: 20_000 });
    await expect(page.getByLabel('Work mode hint')).toBeVisible();

    await page.goto('/#/overview');
    await expect(page.locator('#screen-overview.active')).toBeVisible();

    await page.goto('/#/runs');
    await expect(page.locator('#screen-runs.active')).toBeVisible();
    await expect(page.locator('#screen-runs .screen-title')).toHaveText('Runs');

    await page.goto('/#/tasks');
    await expect(page.locator('#screen-tasks.active')).toBeVisible();
    await expect(page.locator('#screen-tasks .screen-title')).toHaveText('Tasks');
  });
});
