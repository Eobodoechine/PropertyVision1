import { test, expect } from '@playwright/test';

test.describe('Search flow for 185 Jordan Pl, Fayetteville, GA 30215', () => {
  test('runs end-to-end and shows ARV + comps', async ({ page }) => {
    const base = process.env.BASE_URL || 'http://localhost:3000';
    await page.goto(base);

    const input = page.getByPlaceholder(/address/i).first();
    await expect(input).toBeVisible();
    await input.fill('185 Jordan Pl, Fayetteville, GA 30215');

    // Click Search/Analyze
    const action = page.getByRole('button', { name: /search|analyz/i }).first();
    await action.click();

    // A progress percentage should appear while loading
    const percent = page.getByText(/%$/).first();
    await expect(percent).toBeVisible({ timeout: 15_000 });

    // Wait for ARV section to render (UI shows a card titled ARV)
    await expect(page.getByText(/ARV\b/)).toBeVisible({ timeout: 120_000 });

    // Basic assertions on the results view
    const compsHeader = page.getByText(/Comps Used/i);
    await expect(compsHeader).toBeVisible();
  });
});

