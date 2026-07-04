import { expect, test } from '@playwright/test';

import { newSession, openFreshCampaign } from './helpers';

test.describe('Entities & mentions', () => {
  test('typing @ creates a multi-word mention that persists and renders', async ({ page }) => {
    await openFreshCampaign(page, 'Codex Campaign');
    await newSession(page);

    const textarea = page.locator('app-mention-textarea textarea');
    await textarea.click();
    // A multi-word name (spaces allowed): the @-typeahead offers a "Create" option.
    await textarea.pressSequentially('We fought @The Balrog');
    await expect(page.locator('app-mention-textarea ul')).toContainText('The Balrog');
    await textarea.press('Enter');
    await expect(textarea).toHaveValue('We fought @[The Balrog]');

    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Saved')).toBeVisible();

    // Reopening the note shows its content in the Write tab (regression: it loaded empty).
    await page.reload();
    await expect(page.locator('app-mention-textarea textarea')).toHaveValue('We fought @[The Balrog]');

    // The preview renders the mention as emphasized text with no '@[' and links to search.
    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    const mention = page.locator('app-markdown-view a.entity-mention', { hasText: 'The Balrog' });
    await expect(mention).toBeVisible();
    await expect(page.locator('app-markdown-view')).not.toContainText('@[');

    await mention.click();
    await expect(page).toHaveURL(/\/search\?q=The/);
  });

  test('the Codex groups entities and collapses sections', async ({ page }) => {
    await openFreshCampaign(page, 'Codex Campaign');

    await page.getByRole('button', { name: 'Codex' }).click();
    await expect(page).toHaveURL(/\/campaigns\/\d+\/entities$/);

    // Add an entity directly on the Codex; it lands in the Ungrouped bucket.
    await page.getByPlaceholder('New entity name').fill('Aragorn');
    await page.getByRole('button', { name: 'Add entity' }).click();

    // Sections start collapsed, so the entity isn't shown until Ungrouped is expanded.
    await expect(page.getByRole('link', { name: 'Aragorn' })).toBeHidden();
    await page.getByRole('button', { name: /Expand Ungrouped/ }).click();
    await expect(page.getByRole('link', { name: 'Aragorn' })).toBeVisible();

    // Create a group and move the entity into it via its group select.
    await page.getByPlaceholder('New group name').fill('Allies');
    await page.getByRole('button', { name: 'Add group' }).click();
    await page.locator('select').selectOption({ label: 'Allies' });

    // Aragorn moved out of the (now empty) Ungrouped bucket into the collapsed Allies group.
    await expect(page.getByRole('link', { name: 'Aragorn' })).toBeHidden();
    await page.getByRole('button', { name: /Expand Allies/ }).click();
    await expect(page.getByRole('link', { name: 'Aragorn' })).toBeVisible();
    // The group select reflects the entity's actual group (regression: it showed Ungrouped).
    await expect(page.locator('select option:checked')).toHaveText('Allies');
  });
});
