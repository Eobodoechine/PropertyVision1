import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  // Listen for console messages
  page.on('console', msg => console.log('BROWSER:', msg.text()));
  page.on('pageerror', err => console.log('ERROR:', err.message));

  try {
    await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    // Get page info
    const title = await page.title();
    console.log('✅ Page title:', title);

    // Check main heading
    const heading = await page.$('h1');
    if (heading) {
      const headingText = await heading.textContent();
      const headingStyles = await heading.evaluate(el => {
        const styles = window.getComputedStyle(el);
        return {
          fontSize: styles.fontSize,
          color: styles.color,
          display: styles.display,
          position: styles.position
        };
      });
      console.log('✅ Main heading:', headingText);
      console.log('✅ Heading styles:', headingStyles);
    }

    // Look for any elements with unusual content
    const suspiciousElements = await page.$$eval('*', elements => {
      return elements
        .filter(el => {
          const text = el.textContent || '';
          const rect = el.getBoundingClientRect();
          return (text.includes('Q') && text.length < 5) ||
                 (rect.width > 200 && rect.height > 200 && text.length < 10);
        })
        .map(el => ({
          tag: el.tagName,
          text: el.textContent,
          className: el.className,
          id: el.id,
          width: Math.round(el.getBoundingClientRect().width),
          height: Math.round(el.getBoundingClientRect().height)
        }));
    });

    console.log('🔍 Suspicious elements:', suspiciousElements);

    // Check for any CSS issues
    const cssErrors = await page.evaluate(() => {
      const errors = [];
      const sheets = Array.from(document.styleSheets);
      return errors;
    });

    console.log('💡 Keep browser open for 10 seconds to inspect...');
    await page.waitForTimeout(10000);

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await browser.close();
  }
})();