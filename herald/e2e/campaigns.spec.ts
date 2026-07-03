import { expect, test } from '@playwright/test';

import { createCampaign, login, uniqueName } from './helpers';

test.describe('campaign CRUD', () => {
  test('creates, opens, and deletes a campaign', async ({ page }) => {
    await login(page);

    const name = uniqueName('CRUD Campaign');
    await page.getByPlaceholder('Campaign name').fill(name);
    await page.getByPlaceholder('Description (optional)').fill('A one-off test campaign');
    await page.getByRole('button', { name: 'Add' }).click();

    // Card shows up in the list…
    const card = page.getByText(name, { exact: true });
    await expect(card).toBeVisible();

    // …and opening it navigates to the detail view.
    await card.click();
    await expect(page).toHaveURL(/\/campaigns\/\d+$/);
    await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
    await expect(page.getByText('A one-off test campaign')).toBeVisible();

    // Back to the list and delete it.
    await page.getByRole('link', { name: '← Campaigns' }).click();
    await expect(page).toHaveURL(/\/campaigns$/);
    await page
      .locator('a', { has: page.getByText(name, { exact: true }) })
      .getByRole('button', { name: 'Delete' })
      .click();

    await expect(page.getByText(name, { exact: true })).toHaveCount(0);
  });

  test('creating a second campaign leaves the first in place', async ({ page }) => {
    await login(page);
    const first = uniqueName('First');
    const second = uniqueName('Second');

    await createCampaign(page, first);
    await createCampaign(page, second);

    await expect(page.getByText(first, { exact: true })).toBeVisible();
    await expect(page.getByText(second, { exact: true })).toBeVisible();
  });
});
