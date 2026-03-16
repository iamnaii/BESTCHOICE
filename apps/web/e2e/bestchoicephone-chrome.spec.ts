import { test, expect } from '@playwright/test';

test.describe('BestChoicePhone.app in Chrome', () => {
  test('should open bestchoicephone.app and verify it loads', async ({ browser }) => {
    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
    });
    const page = await context.newPage();

    // Navigate to bestchoicephone.app
    const response = await page.goto('https://bestchoicephone.app', {
      timeout: 30000,
      waitUntil: 'domcontentloaded',
    });

    // Verify the page loaded
    expect(response).not.toBeNull();
    const status = response!.status();
    console.log(`Response status: ${status}`);
    console.log(`Page URL: ${page.url()}`);
    console.log(`Page title: ${await page.title()}`);

    // Take a screenshot
    await page.screenshot({ path: 'e2e/screenshots/bestchoicephone-chrome.png', fullPage: true });
    console.log('Screenshot saved to e2e/screenshots/bestchoicephone-chrome.png');

    // Check that the page has some content
    const bodyText = await page.locator('body').textContent();
    console.log(`Body text length: ${bodyText?.length || 0}`);

    await context.close();
  });
});
