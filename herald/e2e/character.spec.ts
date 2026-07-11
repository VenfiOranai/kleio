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
    // The spells modal also renders a DC header, but it's a closed <dialog> (display:none), so
    // scope to the visible panel on the sheet.
    const spellBox = page.locator('div.rounded-lg.border:visible', { hasText: 'Spell save DC' });
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

    // Open the equipment modal (native <dialog>; only the open one is exposed as role=dialog).
    await page.getByRole('button', { name: 'Open equipment' }).click();
    const dialog = page.getByRole('dialog');
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

  test('tracks spells and slots in the modal and reflects them in the summary', async ({
    page,
  }) => {
    await openFreshCampaign(page, 'Spells Campaign');
    await newCharacter(page);
    await page.getByPlaceholder('Character name').fill(uniqueName('Gandalf'));

    // Open the spells modal (native <dialog>; only the open one is exposed as role=dialog).
    await page.getByRole('button', { name: 'Open spells' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Give the character two level-1 spell slots.
    await dialog.getByLabel('Level 1 total slots').fill('2');
    await dialog.getByLabel('Level 1 total slots').blur();
    // Two clickable dots appear, both initially available.
    await expect(dialog.getByLabel('Available slot')).toHaveCount(2);

    // Add a prepared level-1 spell.
    await dialog.getByRole('button', { name: '+ Add spell' }).click();
    await dialog.getByPlaceholder('Spell name').fill('Magic Missile');
    await dialog.getByLabel('Spell level').selectOption('1');
    await dialog.getByRole('checkbox', { name: 'Prepared', exact: true }).check();

    // Expend a slot by clicking an available dot → one available, one expended.
    await dialog.getByLabel('Available slot').first().click();
    await expect(dialog.getByLabel('Available slot')).toHaveCount(1);
    await expect(dialog.getByLabel('Expended slot')).toHaveCount(1);

    // Close and save; derived + structured spells round-trip through the backend.
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await page.getByRole('button', { name: 'Save' }).click();

    // Summary: 1 prepared spell and a level-1 slot chip showing 1 of 2 remaining.
    const summary = page.locator('section', { hasText: 'Spells' }).locator('div.rounded-lg.border');
    await expect(summary.getByText('Prepared').locator('strong')).toHaveText('1');
    await expect(summary.getByText(/Lvl 1:/)).toContainText('1/2');

    // Persists across a reload (structured spells + slots came back from the server).
    await page.reload();
    await page.getByRole('button', { name: 'Open spells' }).click();
    const reopened = page.getByRole('dialog');
    await expect(reopened.getByPlaceholder('Spell name')).toHaveValue('Magic Missile');
    await expect(reopened.getByLabel('Available slot')).toHaveCount(1);
  });

  test('long rest restores HP, spent hit dice, and spell slots', async ({ page }) => {
    await openFreshCampaign(page, 'Rest Campaign');
    await newCharacter(page);
    await page.getByPlaceholder('Character name').fill(uniqueName('Weary'));

    // Combat HP fields bind [formControlName] dynamically (no reflected attribute) → target by label.
    const combat = page.locator('section', { hasText: 'Combat' });
    const currentHp = combat.locator('label', { hasText: 'current hp' }).getByRole('spinbutton');
    const tempHp = combat.locator('label', { hasText: 'temp hp' }).getByRole('spinbutton');
    await combat.locator('label', { hasText: 'max hp' }).getByRole('spinbutton').fill('20');
    await currentHp.fill('5');
    await tempHp.fill('4');

    // Add a hit-dice pool: 5 × d8 with 3 spent → 2 available.
    await page.getByRole('button', { name: '+ Add pool' }).click();
    await page.getByLabel('Hit die size').fill('d8');
    await page.getByLabel('Total hit dice').fill('5');
    await page.getByLabel('Spent hit dice').fill('3');
    await page.getByLabel('Spent hit dice').blur();
    await expect(page.getByText('2 available')).toBeVisible();

    // Expend a level-1 spell slot in the modal, then close it.
    await page.getByRole('button', { name: 'Open spells' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Level 1 total slots').fill('2');
    await dialog.getByLabel('Level 1 total slots').blur();
    await dialog.getByLabel('Available slot').first().click();
    await expect(dialog.getByLabel('Expended slot')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    // Long rest: full HP, temp HP cleared, spent hit dice halved (3 → 1), spell slots reset.
    await page.getByRole('button', { name: 'Long rest' }).click();
    await expect(currentHp).toHaveValue('20');
    await expect(tempHp).toHaveValue('0');
    await expect(page.getByText('4 available')).toBeVisible();

    await page.getByRole('button', { name: 'Open spells' }).click();
    await expect(page.getByRole('dialog').getByLabel('Available slot')).toHaveCount(2);
  });

  test('tracks limited-use features in the modal and resets them on a long rest', async ({
    page,
  }) => {
    await openFreshCampaign(page, 'Features Campaign');
    await newCharacter(page);
    await page.getByPlaceholder('Character name').fill(uniqueName('Grog'));

    // Open the features modal (native <dialog>; only the open one is exposed as role=dialog).
    await page.getByRole('button', { name: 'Open features' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Add a limited-use class feature: Rage, 3 uses / long rest.
    await dialog.getByRole('button', { name: '+ Add feature' }).click();
    await dialog.getByPlaceholder('Feature name').fill('Rage');
    await dialog.getByLabel('Feature source').selectOption('class');
    await dialog.getByRole('checkbox', { name: 'Limited use' }).check();
    await dialog.getByLabel('Rage max uses').fill('3');
    await dialog.getByLabel('Rage max uses').blur();
    await expect(dialog.getByLabel('Available use')).toHaveCount(3);

    // Dots are "click the dot for how many remain": clicking the 2nd of 3 leaves 2 available.
    await dialog.getByLabel('Available use').nth(1).click();
    await expect(dialog.getByLabel('Available use')).toHaveCount(2);
    await expect(dialog.getByLabel('Expended use')).toHaveCount(1);

    // Close and save; the summary reflects the limited-use count + remaining uses.
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await page.getByRole('button', { name: 'Save' }).click();

    const summary = page
      .locator('section', { hasText: 'Features & Traits' })
      .locator('div.rounded-lg.border');
    await expect(summary.getByText('Limited-use').locator('strong')).toHaveText('1');
    await expect(summary.getByText('Rage')).toContainText('2/3');

    // A long rest resets the feature's expended uses back to full.
    await page.getByRole('button', { name: 'Long rest' }).click();
    await expect(summary.getByText('Rage')).toContainText('3/3');

    // Persists across a reload (structured features came back from the server).
    await page.getByRole('button', { name: 'Save' }).click();
    await page.reload();
    await page.getByRole('button', { name: 'Open features' }).click();
    const reopened = page.getByRole('dialog');
    await expect(reopened.getByPlaceholder('Feature name')).toHaveValue('Rage');
    await expect(reopened.getByLabel('Available use')).toHaveCount(3);
  });
});
