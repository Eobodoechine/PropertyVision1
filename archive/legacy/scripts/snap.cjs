// eslint-disable-next-line @typescript-eslint/no-var-requires
const { chromium } = require('playwright');

(async () => {
  const base = process.env.BASE_URL || 'http://localhost:3001';
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();

  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'test-results/landing.png', fullPage: false });

  const input = await page.getByPlaceholder(/address/i).first();
  await input.fill('1600 Amphitheatre Parkway, Mountain View, CA 94043');
  const btn = await page.getByRole('button', { name: /search|analyz/i }).first();
  await btn.click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'test-results/loading.png', fullPage: false });

  await browser.close();
  console.log('Saved screenshots to test-results/landing.png and test-results/loading.png');
})();

