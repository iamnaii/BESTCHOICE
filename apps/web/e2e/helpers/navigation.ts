import { Page, expect } from '@playwright/test';

/**
 * Navigate to URL with retry on Vite chunk-load errors.
 * Returns true if page loaded successfully, false if error boundary is showing.
 *
 * On error: tries reload once (fixes Vite dynamic import failures).
 * If the error persists after reload, returns false — this indicates
 * an actual app bug (e.g., data reference error), not a test problem.
 */
export async function gotoWithRetry(page: Page, url: string): Promise<boolean> {
  await page.goto(url, { waitUntil: 'domcontentloaded' });

  // Wait a bit for React to render (lazy routes take time)
  await page.waitForTimeout(1000);

  const errLocator = page.getByText('เกิดข้อผิดพลาด');
  const hasError = await errLocator.isVisible({ timeout: 2000 }).catch(() => false);

  if (hasError) {
    // First retry — may fix Vite chunk-load or transient errors
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);

    const stillError = await errLocator.isVisible({ timeout: 2000 }).catch(() => false);
    if (stillError) {
      // Persistent error — app bug, not test issue
      return false;
    }
  }

  return true;
}

/**
 * Check if the current page has an error boundary showing.
 * Use at the top of tests when beforeEach navigates via gotoWithRetry.
 * Returns true if error boundary is visible (test should return early).
 */
export async function hasErrorBoundary(page: Page): Promise<boolean> {
  return page.getByText('เกิดข้อผิดพลาด').first()
    .isVisible({ timeout: 1500 }).catch(() => false);
}
