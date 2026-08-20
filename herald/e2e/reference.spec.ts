import { type Locator, type Page, expect, test } from '@playwright/test';

import { login, newCharacter, openFreshCampaign, uniqueName } from './helpers';

/**
 * 5etools reference import (Phase 13). The oracle under test is started with
 * FIVETOOLS_DATA_DIR pointed at its miniature fixture dataset (see playwright.config.ts) —
 * Kleio ships no real game data, so these assertions are about the flow, not the content.
 *
 * Two native <dialog>s are open at once here (the section modal, plus the browser stacked on
 * top of it), so every locator is scoped to one of them by its heading.
 */
function dialogWithHeading(page: Page, name: string): Locator {
  return page.getByRole('dialog').filter({ has: page.getByRole('heading', { name, exact: true }) });
}

test.describe('5etools reference import', () => {
  test('the campaigns page reports the loaded dataset', async ({ page }) => {
    await login(page);

    const card = page.locator('z-card', { hasText: '5etools reference' });
    await expect(card).toContainText('Loaded');
    await expect(card).toContainText('spells');
    // The oracle is started with FIVETOOLS_DATA_DIR, so downloading isn't offered — it would
    // write files the index would never read.
    await expect(card).toContainText('Read from your own copy');
    await expect(card.getByRole('button', { name: /Download/ })).toHaveCount(0);
  });

  test('browses, filters and imports a spell into the spell list', async ({ page }) => {
    await openFreshCampaign(page, 'Reference Campaign');
    await newCharacter(page);
    await page.getByPlaceholder('Character name').fill(uniqueName('Elminster'));

    await page.getByRole('button', { name: 'Open spells' }).click();
    const spells = dialogWithHeading(page, 'Spells');
    await expect(spells).toBeVisible();

    // The Browse button only exists because the oracle reports a dataset is loaded.
    await spells.getByRole('button', { name: 'Browse reference' }).click();
    const browser = dialogWithHeading(page, 'Browse spells');
    await expect(browser).toBeVisible();

    // Searching narrows the list; relevance puts the prefix match first.
    await browser.getByLabel('Search reference').fill('fire');
    await expect(browser.getByRole('button', { name: /Fire Bolt/ })).toBeVisible();
    await expect(browser.getByRole('button', { name: /Fireball/ })).toBeVisible();

    // Filters come from the dataset itself.
    await browser.getByLabel('Filter by level').selectOption({ label: 'Level 3' });
    await expect(browser.getByRole('button', { name: /Fire Bolt/ })).toBeHidden();

    // Expanding a row shows the full record, rendered from the 5etools entries.
    const row = browser.getByRole('button', { name: /Fireball/ });
    await row.click();
    await expect(browser.getByText('8d6 fire damage')).toBeVisible();
    await expect(browser.getByText('Ignition')).toBeVisible();

    // Importing keeps the browser open (several picks per visit) and marks the row.
    await browser.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(browser.getByRole('button', { name: /Added/ })).toBeVisible();
    await browser.getByRole('button', { name: 'Close' }).click();
    await expect(browser).toBeHidden();

    // The spell landed in the list as an ordinary, editable entry.
    await expect(spells.getByPlaceholder('Spell name')).toHaveValue('Fireball');
    await expect(spells.getByPlaceholder('School')).toHaveValue('Evocation');
    await expect(spells.getByPlaceholder('Casting time')).toHaveValue('1 action');
    await expect(spells.getByPlaceholder('Range')).toHaveValue('150 feet');

    await page.keyboard.press('Escape');
    await expect(spells).toBeHidden();

    await page.getByRole('button', { name: 'Save' }).click();
    const summary = page.locator('section', { hasText: 'Spells' }).locator('div.rounded-lg.border');
    await expect(summary.getByRole('listitem').filter({ hasText: 'Fireball' })).toBeVisible();
  });

  test('imports a weapon as an attack, with derived to-hit', async ({ page }) => {
    await openFreshCampaign(page, 'Reference Attacks Campaign');
    await newCharacter(page);
    await page.getByPlaceholder('Character name').fill(uniqueName('Sword Person'));

    await page.getByRole('button', { name: 'Open attacks' }).click();
    const attacks = dialogWithHeading(page, 'Attacks & Spellcasting');
    await attacks.getByRole('button', { name: 'Browse weapons' }).click();

    const browser = dialogWithHeading(page, 'Browse weapons');
    await browser.getByLabel('Search reference').fill('longsword');
    // Weapons-only: the magic variant assembled from the base item is browsable by name.
    await expect(browser.getByRole('button', { name: /\+1 Longsword/ })).toBeVisible();

    await browser
      .getByRole('button', { name: 'Add', exact: true })
      .first()
      .click();
    await browser.getByRole('button', { name: 'Close' }).click();

    await expect(attacks.getByPlaceholder('Attack name')).toHaveValue('Longsword');
    await expect(attacks.getByPlaceholder('1d8')).toHaveValue('1d8');

    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Save' }).click();

    // STR 10 (+0) + proficiency +2 at level 1 = +2 to hit; damage 1d8 + 0.
    const row = page.locator('section', { hasText: 'Attacks & Spellcasting' }).locator('tr', {
      hasText: 'Longsword',
    });
    await expect(row).toContainText('+2');
    await expect(row).toContainText('1d8');
  });
});
