import { expect, test } from '@playwright/test';

import { openFreshCampaign, uniqueName } from './helpers';

test.describe('global search', () => {
  test('finds sessions (with highlight) and characters, and links to them', async ({ page }) => {
    await openFreshCampaign(page, 'Search Campaign');

    // A distinctive term so the created rows are easy to find among any existing data.
    const term = 'zephyrquux';
    const sessionTitle = uniqueName('Search Session');
    const characterName = uniqueName('Zephyrquux Hero');

    // Seed a session whose notes contain the term.
    await page
      .locator('section', { has: page.getByRole('heading', { name: 'Sessions' }) })
      .getByRole('button', { name: '+ New' })
      .click();
    await expect(page).toHaveURL(/\/sessions\/\d+$/);
    await page.getByPlaceholder('Session title').fill(sessionTitle);
    await page.locator('textarea[formcontrolname="raw_notes"]').fill(`The ancient ${term} artifact was recovered.`);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Saved')).toBeVisible();
    await page.getByRole('link', { name: '← Back to campaign' }).click();

    // Seed a character whose name contains the term.
    await page
      .locator('section', { has: page.getByRole('heading', { name: 'Characters' }) })
      .getByRole('button', { name: '+ New' })
      .click();
    await expect(page).toHaveURL(/\/characters\/\d+$/);
    await page.getByPlaceholder('Character name').fill(characterName);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Saved')).toBeVisible();

    // Search from the global header box.
    await page.getByPlaceholder('Search notes & characters').fill(term);
    await page.getByPlaceholder('Search notes & characters').press('Enter');
    await expect(page).toHaveURL(new RegExp(`/search\\?q=${term}`));

    // Both the session and the character are found.
    const sessionHit = page.getByRole('link', { name: new RegExp(sessionTitle) });
    await expect(sessionHit).toBeVisible();
    await expect(page.getByRole('link', { name: new RegExp(characterName) })).toBeVisible();

    // The matched term is highlighted in the session snippet.
    await expect(page.locator('mark', { hasText: term }).first()).toBeVisible();

    // Clicking the session result opens its editor.
    await sessionHit.click();
    await expect(page).toHaveURL(/\/sessions\/\d+$/);
    await expect(page.getByPlaceholder('Session title')).toHaveValue(sessionTitle);
  });
});
