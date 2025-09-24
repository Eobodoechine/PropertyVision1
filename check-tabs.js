import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();

  // Get all pages/tabs
  const pages = context.pages();
  console.log(`Found ${pages.length} tabs/pages`);

  // If no pages, create one and navigate to the video
  if (pages.length === 0) {
    console.log('No existing pages, creating new one...');
    const page = await context.newPage();
    await page.goto('https://drive.google.com/file/d/1p-bN8T6_Ly3gScoZOLa98OcAoVoV-RoX/view?usp=sharing');
    await page.waitForTimeout(5000);
    await page.screenshot({ path: 'video-tab.png', fullPage: true });
    console.log('Screenshot saved as video-tab.png');
  } else {
    // Check each existing page
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      const url = page.url();
      const title = await page.title();
      console.log(`Tab ${i + 1}: ${title} - ${url}`);

      if (url.includes('drive.google.com') || url.includes('video')) {
        console.log(`Taking screenshot of tab ${i + 1}...`);
        await page.screenshot({ path: `video-tab-${i + 1}.png`, fullPage: true });
      }
    }
  }

  console.log('Keeping browser open for 15 seconds...');
  await new Promise(resolve => setTimeout(resolve, 15000));

  await browser.close();
})();