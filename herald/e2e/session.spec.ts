import { expect, test } from '@playwright/test';

import { openFreshCampaign, uniqueName } from './helpers';

test.describe('session editor', () => {
  test('creates a session and live-renders the markdown preview', async ({ page }) => {
    await openFreshCampaign(page, 'Session Campaign');

    // "+ New" inside the Sessions section creates a draft and opens the editor.
    await page
      .locator('section', { has: page.getByRole('heading', { name: 'Sessions' }) })
      .getByRole('button', { name: '+ New' })
      .click();
    await expect(page).toHaveURL(/\/sessions\/\d+$/);

    const title = uniqueName('Goblin Ambush');
    await page.getByPlaceholder('Session title').fill(title);

    // Typing Markdown updates the live preview pane (marked + DOMPurify).
    await page.locator('textarea[formcontrolname="raw_notes"]').fill('# Hello World\n\nSome **bold** notes.');
    const preview = page.locator('app-markdown-view');
    await expect(preview.getByRole('heading', { name: 'Hello World' })).toBeVisible();
    await expect(preview.getByText('bold')).toBeVisible();

    // Persist and confirm the save round-trips.
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Saved')).toBeVisible();

    // Reload: the title and notes come back from the server.
    await page.reload();
    await expect(page.getByPlaceholder('Session title')).toHaveValue(title);
    await expect(preview.getByRole('heading', { name: 'Hello World' })).toBeVisible();
  });
});
