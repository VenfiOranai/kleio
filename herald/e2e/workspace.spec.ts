import { expect, test } from '@playwright/test';

import { openFreshCampaign } from './helpers';

test.describe('workspace split view', () => {
  test('toggles between the notes, split, and character panes', async ({ page }) => {
    await openFreshCampaign(page, 'Workspace Campaign');

    // Seed one session and one character so both panes have real content.
    await page
      .locator('section', { has: page.getByRole('heading', { name: 'Sessions' }) })
      .getByRole('button', { name: '+ New' })
      .click();
    await expect(page).toHaveURL(/\/sessions\/\d+$/);
    await page.getByRole('link', { name: '← Back to campaign' }).click();

    await page
      .locator('section', { has: page.getByRole('heading', { name: 'Characters' }) })
      .getByRole('button', { name: '+ New' })
      .click();
    await expect(page).toHaveURL(/\/characters\/\d+$/);
    await page.getByRole('link', { name: '← Back to campaign' }).click();

    // "Open workspace" is an <a z-button>; the Zard button directive stamps role="button" on it,
    // so match it as a button rather than a link.
    await page.getByRole('button', { name: 'Open workspace' }).click();
    await expect(page).toHaveURL(/\/workspace$/);

    const notesPane = page.getByText('Raw notes (Markdown)');
    const characterPane = page.getByRole('heading', { name: 'Abilities & Saving Throws' });

    // Default desktop layout is split — both panes visible side by side.
    await expect(notesPane).toBeVisible();
    await expect(characterPane).toBeVisible();

    // Collapse to notes only.
    await page.getByRole('button', { name: 'Notes', exact: true }).click();
    await expect(notesPane).toBeVisible();
    await expect(characterPane).toHaveCount(0);

    // Collapse to character only.
    await page.getByRole('button', { name: 'Character', exact: true }).click();
    await expect(characterPane).toBeVisible();
    await expect(notesPane).toHaveCount(0);

    // Back to split.
    await page.getByRole('button', { name: 'Split', exact: true }).click();
    await expect(notesPane).toBeVisible();
    await expect(characterPane).toBeVisible();
  });
});
