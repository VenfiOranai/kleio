import { expect, test } from '@playwright/test';

import { E2E_USERNAME, login } from './helpers';

test.describe('authentication', () => {
  test('redirects unauthenticated visitors to the login screen', async ({ page }) => {
    await page.goto('/campaigns');
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByPlaceholder('Username')).toBeVisible();
  });

  test('rejects invalid credentials', async ({ page }) => {
    await page.goto('/login');
    await page.getByPlaceholder('Username').fill(E2E_USERNAME);
    await page.getByPlaceholder('Password').fill('wrong-password');
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page.getByText('Invalid username or password.')).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
  });

  test('logs in with valid credentials', async ({ page }) => {
    await login(page);
    await expect(page.getByRole('heading', { name: 'Campaigns' })).toBeVisible();
  });
});
