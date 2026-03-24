import { Page, expect } from '@playwright/test';
import { loginViaAPI, getAuthHeaders } from '../../helpers/auth';

// Re-export for convenience
export { loginViaAPI, getAuthHeaders };

const API_URL = process.env.API_DIRECT_URL || 'http://localhost:3000';

/**
 * Wait for page to finish loading — spinner must disappear within timeout.
 * Fails explicitly if spinner is still visible (catches infinite loading).
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
 * Returns array of { url, status, duration } for each /api/ call.
 */
export function interceptApiCalls(page: Page) {
  const calls: { url: string; status: number; duration: number }[] = [];
  const pending = new Map<string, number>();

  page.on('request', req => {
    if (req.url().includes('/api/')) {
      pending.set(req.url() + req.method(), Date.now());
    }
  });

  page.on('response', res => {
    const key = res.url() + res.request().method();
    const start = pending.get(key);
    if (start) {
      calls.push({
        url: res.url(),
        status: res.status(),
        duration: Date.now() - start,
      });
      pending.delete(key);
    }
  });

  return calls;
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
 * Get a contract ID with specific status (for targeted testing).
 */
export async function getContractByStatus(page: Page, status: string): Promise<string | null> {
  const headers = getAuthHeaders();
  const res = await page.request.get(`${API_URL}/api/contracts?status=${status}&page=1`, { headers });
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
