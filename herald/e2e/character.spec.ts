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

  test('derives spell save DC / attack from class and tracks misc proficiencies', async ({
    page,
  }) => {
    await openFreshCampaign(page, 'Spellcaster Campaign');
    await newCharacter(page);

    await page.getByPlaceholder('Character name').fill(uniqueName('Elora'));
    await page.locator('input[formcontrolname="level"]').fill('5'); // proficiency +3
    await page
      .locator('div.flex.items-center.gap-3', { hasText: 'intelligence' })
      .getByRole('spinbutton')
      .fill('18'); // INT +4

    // Spellcasting ability is derived from the class (Wizard → INT), not picked manually.
    // The class_name input binds [formControlName] dynamically (not reflected to an attribute),
    // so target it via its label.
    await page.locator('label', { hasText: 'class name' }).getByRole('textbox').fill('Wizard');

    // Add a misc proficiency chip (pure client state) in the "language" category.
    const langCard = page.locator('div.rounded-lg.border', { hasText: 'language' }).first();
    await langCard.getByPlaceholder(/Add/).fill('Draconic');
    await langCard.getByPlaceholder(/Add/).press('Enter');
    await expect(langCard.getByText('Draconic')).toBeVisible();

    await page.getByRole('button', { name: 'Save' }).click();

    // Wizard → INT; INT +4, proficiency +3 → save DC = 8 + 4 + 3 = 15; attack = 4 + 3 = +7.
    const spellBox = page.locator('div.rounded-lg.border', { hasText: 'Spell save DC' });
    await expect(spellBox.locator('span', { hasText: 'Ability' }).locator('strong')).toHaveText(
      /intelligence/i,
    );
    await expect(spellBox.getByText('Spell save DC').locator('strong')).toHaveText('15');
    await expect(spellBox.getByText('Spell attack').locator('strong')).toHaveText('+7');

    // The proficiency chip persists across a reload (round-trips through the backend).
    await page.reload();
    await expect(
      page.locator('div.rounded-lg.border', { hasText: 'language' }).first().getByText('Draconic'),
    ).toBeVisible();
  });

  test('adds structured equipment in the modal and derives carried weight', async ({ page }) => {
    await openFreshCampaign(page, 'Equipment Campaign');
    await newCharacter(page);
    await page.getByPlaceholder('Character name').fill(uniqueName('Packmule'));

    // Open the equipment modal (native <dialog>) and add an item.
    await page.getByRole('button', { name: 'Open equipment' }).click();
    const dialog = page.locator('dialog.app-modal');
    await expect(dialog).toBeVisible();

    await dialog.getByRole('button', { name: '+ Add item' }).click();
    await dialog.getByPlaceholder('Item name').fill('Longsword');
    await dialog.getByLabel('Weight').fill('3');
    await dialog.getByLabel('Weight').blur();
    // Bump quantity to 2 via the stepper → carried weight 2 × 3 = 6.
    await dialog.getByRole('button', { name: '+', exact: true }).click();

    await expect(dialog.getByText('Items').locator('strong')).toHaveText('1');
    await expect(dialog.getByText('Weight', { exact: false }).first().locator('strong')).toHaveText(
      '6',
    );

    // Close the modal, save the sheet, and confirm the derived weight + item summary.
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await page.getByRole('button', { name: 'Save' }).click();

    const summary = page.locator('section', { hasText: 'Equipment' }).locator('div.rounded-lg.border');
    await expect(summary.getByText('Longsword')).toBeVisible();
    await expect(summary.getByText('×2')).toBeVisible();
    await expect(summary.getByText(/Weight/).locator('strong')).toHaveText('6');
  });
});
