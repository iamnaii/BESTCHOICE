import { Page } from '@playwright/test';

/**
 * Mock LIFF SDK for E2E testing.
 * Injects a fake `liff` object before the page loads so useLiffInit
 * resolves with test data instead of failing outside LINE.
 */
export const MOCK_LINE_ID = 'U_e2e_test_user';
export const MOCK_DISPLAY_NAME = 'ทดสอบ E2E';
export const MOCK_ID_TOKEN = 'mock-liff-id-token-for-e2e';

export async function mockLiffSdk(page: Page) {
  await page.addInitScript(() => {
    // Mock the @line/liff module before the app imports it
    (window as Record<string, unknown>).__LIFF_MOCK__ = {
      userId: 'U_e2e_test_user',
      displayName: 'ทดสอบ E2E',
      idToken: 'mock-liff-id-token-for-e2e',
    };
  });

  // Intercept the actual LIFF SDK module — replace init/getProfile/etc.
  await page.addInitScript(() => {
    const mock = (window as Record<string, unknown>).__LIFF_MOCK__ as {
      userId: string; displayName: string; idToken: string;
    };

    // Override the liff module that gets imported
    Object.defineProperty(window, 'liff', {
      value: {
        init: () => Promise.resolve(),
        isLoggedIn: () => true,
        getProfile: () => Promise.resolve({
          userId: mock.userId,
          displayName: mock.displayName,
          pictureUrl: undefined,
        }),
        getIDToken: () => mock.idToken,
        login: () => {},
        closeWindow: () => {},
      },
      writable: true,
      configurable: true,
    });
  });
}

const API_BASE = 'http://localhost:5173/api';

/**
 * Mock LIFF API responses with route interception.
 */
export async function mockLiffApi(
  page: Page,
  routes: Array<{
    method: 'GET' | 'POST';
    path: string;
    status?: number;
    body: unknown;
  }>,
) {
  for (const route of routes) {
    const url = `${API_BASE}${route.path}`;
    await page.route(url + '*', async (r) => {
      if (r.request().method() === route.method) {
        await r.fulfill({
          status: route.status ?? 200,
          contentType: 'application/json',
          body: JSON.stringify(route.body),
        });
      } else {
        await r.continue();
      }
    });
  }
}
