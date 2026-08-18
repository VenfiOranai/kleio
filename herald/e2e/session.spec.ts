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
    await page.locator('app-markdown-editor textarea').fill('# Hello World\n\nSome **bold** notes.');
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

  test('formats notes from the toolbar and previews the summary', async ({ page }) => {
    await openFreshCampaign(page, 'Toolbar Campaign');
    await newSession(page);

    const notes = page.locator('app-markdown-editor textarea');
    await notes.fill('the goblin king');
    // Select "goblin" and bold it from the toolbar; the word stays selected afterwards…
    await notes.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(4, 10));
    await page.getByRole('button', { name: 'Bold' }).click();
    await expect(notes).toHaveValue('the **goblin** king');

    // …so the Ctrl+I shortcut nests italics inside the bold rather than breaking it.
    await page.keyboard.press('Control+i');
    await expect(notes).toHaveValue('the ***goblin*** king');

    // A table lands below the current line, leaving the sentence intact.
    await page.getByRole('button', { name: 'Table' }).click();
    await expect(notes).toHaveValue(/^the \*\*\*goblin\*\*\* king\n\n\| Column \| Column \|/);

    // The summary editor renders its own Markdown behind the preview toggle.
    await page.getByRole('button', { name: 'Summary', exact: true }).click();
    const summary = page.locator('app-markdown-editor[formcontrolname="summary"] textarea');
    await summary.fill('## Recap\n\n- The **lich** fell.');
    await page.getByRole('button', { name: 'Toggle preview' }).click();
    const preview = page.locator('app-markdown-editor[formcontrolname="summary"] app-markdown-view');
    await expect(preview.getByRole('heading', { name: 'Recap' })).toBeVisible();
    await expect(preview.getByText('lich')).toBeVisible();
  });

  test('defaults new sessions to today and keeps the picker sorted by date', async ({ page }) => {
    await openFreshCampaign(page, 'Sorting Campaign');
    const picker = page.locator('select');
    const dateField = page.locator('input[type="date"]');
    const titleField = page.getByPlaceholder('Session title');

    // A brand-new session is dated today (local time, matching the workspace's default).
    // The editor is reused across sessions, so wait for the draft to load before typing.
    await newSession(page);
    await expect(titleField).toHaveValue('Untitled session');
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
      now.getDate(),
    ).padStart(2, '0')}`;
    await expect(dateField).toHaveValue(today);

    const older = uniqueName('Older');
    await titleField.fill(older);
    await dateField.fill('2024-01-05');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Saved')).toBeVisible();

    const newer = uniqueName('Newer');
    await newSession(page);
    await expect(titleField).toHaveValue('Untitled session');
    await titleField.fill(newer);
    await dateField.fill('2024-03-10');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Saved')).toBeVisible();

    // Most recent play date first.
    await expect(picker.locator('option')).toHaveText([newer, older]);

    // Re-dating and renaming the open session re-sorts and relabels the picker on save,
    // without leaving the session that's being edited.
    const renamed = uniqueName('Renamed');
    await titleField.fill(renamed);
    await dateField.fill('2023-06-01');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(picker.locator('option')).toHaveText([older, renamed]);
    await expect(titleField).toHaveValue(renamed);
  });
});
