import { expect, test } from '@playwright/test';

import { openFreshCampaign } from './helpers';

/** Open a fresh session editor within a new campaign. */
async function openNewSession(page: import('@playwright/test').Page): Promise<void> {
  await openFreshCampaign(page, 'AI Campaign');
  await page
    .locator('section', { has: page.getByRole('heading', { name: 'Sessions' }) })
    .getByRole('button', { name: '+ New' })
    .click();
  await expect(page).toHaveURL(/\/sessions\/\d+$/);
}

test.describe('AI summary', () => {
  test('summary field is editable and persists', async ({ page }) => {
    await openNewSession(page);

    const summary = page.locator('textarea[formcontrolname="summary"]');
    await summary.fill('## My recap\n- We defeated the lich.');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Saved')).toBeVisible();

    await page.reload();
    await expect(page.locator('textarea[formcontrolname="summary"]')).toHaveValue(
      '## My recap\n- We defeated the lich.',
    );
  });

  test('surfaces a helpful error when AI is not configured', async ({ page }) => {
    await openNewSession(page);

    await page.locator('textarea[formcontrolname="raw_notes"]').fill('The party explored the crypt.');
    await page.getByRole('button', { name: 'Summarize with AI' }).click();

    // No API key in the e2e backend → a graceful 503 shown to the user (not a crash).
    await expect(page.getByText(/not configured/i)).toBeVisible();
    // The button returns to its idle label afterward.
    await expect(page.getByRole('button', { name: 'Summarize with AI' })).toBeEnabled();
  });
});
