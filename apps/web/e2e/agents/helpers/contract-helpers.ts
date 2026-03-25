import { Page, expect } from '@playwright/test';
import { loginViaAPI, getAuthHeaders } from '../../helpers/auth';

// Re-export for convenience
export { loginViaAPI, getAuthHeaders };

const API_URL = process.env.API_DIRECT_URL || 'http://localhost:3000';

/**
 * Wait for page to finish loading — spinner must disappear within timeout.
 * Fails explicitly if spinner is still visible (catches infinite loading).
 * Also verifies the page rendered meaningful content (not just an error boundary).
 */
export async function waitForPageReady(page: Page, timeout = 15000) {
  // Wait for any visible spinner to disappear
  const spinner = page.locator('.animate-spin').first();
  try {
    await spinner.waitFor({ state: 'hidden', timeout });
  } catch {
    // If spinner is still visible, take screenshot and fail with useful message
    const url = page.url();
    throw new Error(`Page still loading after ${timeout}ms (spinner visible) at ${url}`);
  }

  // Verify page has meaningful content (catches error boundaries / blank pages)
  const body = await page.textContent('body');
  if (!body || body.trim().length < 50) {
    const url = page.url();
    throw new Error(`Page at ${url} loaded but has no meaningful content (${(body || '').trim().length} chars)`);
  }
}

/**
 * Assert that page does NOT have an infinite spinner.
 * Waits up to 10s for spinner to disappear, then checks for real content.
 */
export async function assertNoInfiniteSpinner(page: Page, label: string) {
  const spinner = page.locator('.animate-spin').first();
  const isSpinning = await spinner.isVisible().catch(() => false);
  if (isSpinning) {
    await expect(spinner).toBeHidden({ timeout: 10000 });
  }
  // After spinner gone, page should have meaningful content
  const body = await page.textContent('body');
  if (!body || body.trim().length < 10) {
    throw new Error(`[${label}] Page has no meaningful content after loading`);
  }
}

/**
 * Intercept and log all API calls for diagnostics.
 * Returns { calls, cleanup } — call cleanup() to remove listeners.
 * Uses auto-incrementing request ID to avoid collision when same URL fires concurrently.
 */
export function interceptApiCalls(page: Page) {
  const calls: { url: string; status: number; duration: number }[] = [];
  const pending = new Map<number, { url: string; start: number }>();
  let nextId = 0;
  // Map request objects to IDs for matching in response handler
  const reqIdMap = new WeakMap<object, number>();

  const onRequest = (req: any) => {
    if (req.url().includes('/api/')) {
      const id = nextId++;
      reqIdMap.set(req, id);
      pending.set(id, { url: req.url(), start: Date.now() });
    }
  };

  const onResponse = (res: any) => {
    const req = res.request();
    const id = reqIdMap.get(req);
    if (id !== undefined) {
      const entry = pending.get(id);
      if (entry) {
        calls.push({
          url: entry.url,
          status: res.status(),
          duration: Date.now() - entry.start,
        });
        pending.delete(id);
      }
    }
  };

  page.on('request', onRequest);
  page.on('response', onResponse);

  // Return calls array with a cleanup function to remove listeners
  return Object.assign(calls, {
    cleanup: () => {
      page.off('request', onRequest);
      page.off('response', onResponse);
    },
  });
}

/**
 * Get the first contract ID from the API (real data).
 * Returns null if no contracts exist.
 */
export async function getFirstContractId(page: Page): Promise<string | null> {
  const headers = getAuthHeaders();
  const res = await page.request.get(`${API_URL}/api/contracts?page=1`, { headers });
  if (res.status() !== 200) return null;
  const body = await res.json();
  return body?.data?.[0]?.id ?? null;
}


/**
 * Get the first contract ID with a specific status from the API.
 * Returns null if no contracts with that status exist.
 */
export async function getContractByStatus(page: Page, status: string): Promise<string | null> {
  const headers = getAuthHeaders();
  const res = await page.request.get(`${API_URL}/api/contracts?page=1&status=${status}`, { headers });
  if (res.status() !== 200) return null;
  const body = await res.json();
  return body?.data?.[0]?.id ?? null;
}

/**
 * Make authenticated API request directly (no browser needed).
 */
export async function apiGet(page: Page, path: string) {
  const headers = getAuthHeaders();
  const start = Date.now();
  const res = await page.request.get(`${API_URL}${path}`, { headers });
  const elapsed = Date.now() - start;
  return { res, elapsed };
}
