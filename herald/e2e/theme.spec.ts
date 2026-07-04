import { expect, test } from '@playwright/test';

import { login } from './helpers';

test.describe('dark mode', () => {
  test('toggles the theme and persists the choice', async ({ page }) => {
    await login(page);
    const html = page.locator('html');

    // Fresh headless browser: no saved preference and prefers-color-scheme is light.
    await expect(html).not.toHaveClass(/dark/);
    await page.screenshot({ path: 'test-results/header-light.png', clip: { x: 0, y: 0, width: 1280, height: 64 } });

    // Toggle to dark.
    await page.getByRole('button', { name: 'Switch to dark mode' }).click();
    await expect(html).toHaveClass(/dark/);
    await page.screenshot({ path: 'test-results/header-dark.png', clip: { x: 0, y: 0, width: 1280, height: 64 } });

    // The choice survives a reload (persisted to localStorage).
    await page.reload();
    await expect(html).toHaveClass(/dark/);
    await expect(page.getByRole('button', { name: 'Switch to light mode' })).toBeVisible();

    // And toggles back.
    await page.getByRole('button', { name: 'Switch to light mode' }).click();
    await expect(html).not.toHaveClass(/dark/);
  });
});
