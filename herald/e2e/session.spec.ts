import { expect, test } from '@playwright/test';

import { newSession, openFreshCampaign, uniqueName } from './helpers';

test.describe('session editor', () => {
  test('creates a session and live-renders the markdown preview', async ({ page }) => {
    await openFreshCampaign(page, 'Session Campaign');

    // Create a session from the workspace; the editor opens inline (no route change).
    await newSession(page);

    const title = uniqueName('Goblin Ambush');
    await page.getByPlaceholder('Session title').fill(title);

    // Typing Markdown updates the live preview (marked + DOMPurify), shown on its own tab.
    await page.locator('textarea[formcontrolname="raw_notes"]').fill('# Hello World\n\nSome **bold** notes.');
    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    const preview = page.locator('app-markdown-view');
    await expect(preview.getByRole('heading', { name: 'Hello World' })).toBeVisible();
    await expect(preview.getByText('bold')).toBeVisible();

    // Persist and confirm the save round-trips.
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Saved')).toBeVisible();

    // Reload: the title and notes come back from the server.
    await page.reload();
    await expect(page.getByPlaceholder('Session title')).toHaveValue(title);
    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    await expect(preview.getByRole('heading', { name: 'Hello World' })).toBeVisible();
  });
});
