import { expect, type Page } from '@playwright/test';

// Matches the static single-user credentials the oracle is started with in
// playwright.config.ts (password hash is bcrypt('e2e-password')).
export const E2E_USERNAME = 'e2e';
export const E2E_PASSWORD = 'e2e-password';

/** Log in through the UI and land on the campaigns list. */
export async function login(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByPlaceholder('Username').fill(E2E_USERNAME);
  await page.getByPlaceholder('Password').fill(E2E_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/campaigns$/);
}

/** A name unlikely to collide with other runs/tests sharing a database. */
export function uniqueName(prefix: string): string {
  return `${prefix} ${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
}

/** Create a campaign from the list page and wait for its card to appear. */
export async function createCampaign(page: Page, name: string): Promise<void> {
  await page.getByPlaceholder('Campaign name').fill(name);
  await page.getByRole('button', { name: 'Add' }).click();
  await expect(page.getByText(name, { exact: true })).toBeVisible();
}

/**
 * Log in, create a fresh campaign, and open it — which now lands directly in the
 * campaign's workspace. Returns the campaign name so callers can assert/clean up.
 */
export async function openFreshCampaign(page: Page, prefix = 'Campaign'): Promise<string> {
  await login(page);
  const name = uniqueName(prefix);
  await createCampaign(page, name);
  await page.getByText(name, { exact: true }).click();
  await expect(page).toHaveURL(/\/campaigns\/\d+$/);
  await expect(page.getByRole('button', { name: '+ New session' })).toBeVisible();
  return name;
}

/**
 * From the workspace, collapse to the notes pane and create a draft session. Leaves the
 * embedded session editor open. Single-pane so there's exactly one Save button on screen.
 */
export async function newSession(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Notes', exact: true }).click();
  await page.getByRole('button', { name: '+ New session' }).click();
  await expect(page.getByPlaceholder('Session title')).toBeVisible();
}

/** From the workspace, collapse to the character pane and create a draft character. */
export async function newCharacter(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Character', exact: true }).click();
  await page.getByRole('button', { name: '+ New character' }).click();
  await expect(page.getByPlaceholder('Character name')).toBeVisible();
}
