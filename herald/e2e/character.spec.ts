import { expect, test } from '@playwright/test';

import { newCharacter, openFreshCampaign, uniqueName } from './helpers';

test.describe('character sheet', () => {
  test('server-computes derived stats from manual inputs', async ({ page }) => {
    await openFreshCampaign(page, 'Character Campaign');

    // Create a character from the workspace; the sheet opens inline (no route change).
    await newCharacter(page);

    await page.getByPlaceholder('Character name').fill(uniqueName('Aragorn'));
    await page.locator('input[formcontrolname="level"]').fill('5');
    // The ability inputs bind [formControlName] dynamically, which Angular does not reflect to a
    // DOM attribute, so target the strength row by its label and grab its number input instead.
    await page
      .locator('div.flex.items-center.gap-3', { hasText: 'strength' })
      .getByRole('spinbutton')
      .fill('16');

    // Derived stats are authoritative on the backend and refresh after saving.
    await page.getByRole('button', { name: 'Save' }).click();

    // Level 5 → proficiency +3; STR 16 → +3 modifier; WIS 10 → passive perception 10.
    const strengthRow = page.locator('div.flex.items-center.gap-3', { hasText: 'strength' });
    await expect(strengthRow.locator('span.w-10')).toHaveText('+3');
    await expect(page.getByText('Proficiency').locator('strong')).toHaveText('+3');
    await expect(page.getByText('Passive Perception').locator('strong')).toHaveText('10');
    await expect(page.getByText('Initiative').locator('strong')).toHaveText('+0');
  });
});
