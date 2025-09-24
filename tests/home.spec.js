import { test, expect } from '@playwright/test';

test.describe('PropertyVision UI (dev)', () => {
  test('landing shows centered search and no RapidAPI', async ({ page }) => {
    await page.goto('/');

    // Brand headline
    await expect(page.getByText('PropertyVision').first()).toBeVisible();

    // Single rounded search input should exist
    const input = page.getByPlaceholder(/address/i).first();
    await expect(input).toBeVisible();

    // No RapidAPI text in footer or anywhere
    await expect(page.getByText(/rapidapi/i)).toHaveCount(0);
  });

  test('search shows progress bar to 100% (mocked API)', async ({ page }) => {
    await page.goto('/');
    const input = page.getByPlaceholder(/address/i).first();
    await input.fill('1600 Amphitheatre Parkway, Mountain View, CA 94043');

    // Mock API to ensure deterministic progression
    await page.route('**/api/analyze', async route => {
      // Simulate a short running request so the progress bar is visible
      await new Promise(r => setTimeout(r, 1500));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          address: '1600 Amphitheatre Parkway, Mountain View, CA 94043',
          subject: { sqft: 1800, beds: 3, baths: 2, yearBuilt: 1998, subdivision: null },
          arv: { estimate: 1500000, rangeLow: 1400000, rangeHigh: 1600000, method: 'Median PPSF', confidence: 'high', dataPoints: 5 },
          compsUsed: [
            { address: '123 Comp St', price: 1450000, sqft: 1750, beds: 3, baths: 2, yearBuilt: 1995, soldDate: '2024-06-01', distance: 0.5, ppsf: 828.57, source: 'mock' }
          ]
        })
      });
    });

    // Click search/analyze button (label variations)
    const btn = page.getByRole('button', { name: /search|analyz/i }).first();
    await btn.click();

    // Progress bar and percentage should appear
    const percent = page.getByText(/%$/).first();
    await expect(percent).toBeVisible();
    await expect(percent).toHaveText('100%', { timeout: 30_000 });
  });
});
