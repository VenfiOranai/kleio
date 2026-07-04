import { expect, test } from '@playwright/test';

import { newSession, openFreshCampaign } from './helpers';

test.describe('AI Q&A (Ask)', () => {
  test('opens as a notes tab and surfaces a helpful error when AI is not configured', async ({
    page,
  }) => {
    await openFreshCampaign(page, 'Ask Campaign');
    // The Ask tab sits alongside Write/Preview/Summary inside the notes editor.
    await newSession(page);

    await page.getByRole('button', { name: 'Ask', exact: true }).click();

    const ask = page.locator('app-ask');
    const input = ask.getByPlaceholder(/who betrayed/i);
    await input.fill('Who is the villain?');
    // Submit with Enter — must not implicitly submit the editor form and jump back to Write.
    await input.press('Enter');

    // The input is cleared on submit, and the question moves into the output block.
    await expect(input).toHaveValue('');
    await expect(ask.getByText('Who is the villain?')).toBeVisible();
    // The question was sent: with no API key the e2e backend returns a graceful 503.
    await expect(page.getByText(/not configured/i)).toBeVisible();
    // The button is back to its idle label (not stuck on "Thinking…").
    await expect(ask.getByRole('button', { name: 'Ask AI' })).toBeVisible();
  });
});
