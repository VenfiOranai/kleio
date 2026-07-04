import { expect, test } from '@playwright/test';

import { newSession, openFreshCampaign } from './helpers';

/** Open a fresh, inline session editor within a new campaign's workspace. */
async function openNewSession(page: import('@playwright/test').Page): Promise<void> {
  await openFreshCampaign(page, 'AI Campaign');
  await newSession(page);
}

test.describe('AI summary', () => {
  test('summary field is editable and persists', async ({ page }) => {
    await openNewSession(page);

    // The summary lives on the "Summary" tab of the embedded editor.
    await page.getByRole('button', { name: 'Summary', exact: true }).click();
    const summary = page.locator('textarea[formcontrolname="summary"]');
    await summary.fill('## My recap\n- We defeated the lich.');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Saved')).toBeVisible();

    await page.reload();
    await page.getByRole('button', { name: 'Summary', exact: true }).click();
    await expect(page.locator('textarea[formcontrolname="summary"]')).toHaveValue(
      '## My recap\n- We defeated the lich.',
    );
  });

  test('surfaces a helpful error when AI is not configured', async ({ page }) => {
    await openNewSession(page);

    // Notes are entered on the Write tab; the value is kept when switching tabs.
    await page.locator('app-mention-textarea textarea').fill('The party explored the crypt.');
    await page.getByRole('button', { name: 'Summary', exact: true }).click();
    await page.getByRole('button', { name: 'Summarize with AI' }).click();

    // No API key in the e2e backend → a graceful 503 shown to the user (not a crash).
    await expect(page.getByText(/not configured/i)).toBeVisible();
    // The button returns to its idle label afterward.
    await expect(page.getByRole('button', { name: 'Summarize with AI' })).toBeEnabled();
  });
});
