import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import React from 'react';

// --- mock api ----------------------------------------------------------------
const apiGet = vi.fn();
vi.mock('@/lib/api', () => ({
  __esModule: true,
  default: {
    get: (...args: unknown[]) => apiGet(...args),
  },
}));

// IMPORTANT: import after mocks so the hook picks up the mocked module.
import { useUiFlags } from './useUiFlags';

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
  return { wrapper };
}

describe('useUiFlags — animationEnabled effect (D1.4.1.3)', () => {
  beforeEach(() => {
    apiGet.mockReset();
    // Ensure the attribute is clean before each case
    document.documentElement.removeAttribute('data-animations-disabled');
  });

  afterEach(() => {
    document.documentElement.removeAttribute('data-animations-disabled');
  });

  it('does NOT set data-animations-disabled when animationEnabled=true (default)', async () => {
    apiGet.mockResolvedValue({
      data: {
        taxExemptWarningEnabled: true,
        reverseReasonRequired: true,
        reverseReasons: [],
        reverseManagerApprovalDays: 7,
        paymentDateWarningBackdate: 30,
        paymentDateAllowFuture: true,
        periodCloseDay: 31,
        voucherShowQrCode: true,
        themeColor: '#10b981',
        language: 'th',
        animationEnabled: true,
      },
    });
    const { wrapper } = makeWrapper();
    renderHook(() => useUiFlags(), { wrapper });

    await waitFor(() => {
      expect(apiGet).toHaveBeenCalledWith('/settings/ui-flags');
    });
    // Attribute should not be present (or explicitly removed) when enabled
    expect(document.documentElement.getAttribute('data-animations-disabled')).toBeNull();
  });

  it('sets data-animations-disabled="true" when animationEnabled=false', async () => {
    apiGet.mockResolvedValue({
      data: {
        taxExemptWarningEnabled: true,
        reverseReasonRequired: true,
        reverseReasons: [],
        reverseManagerApprovalDays: 7,
        paymentDateWarningBackdate: 30,
        paymentDateAllowFuture: true,
        periodCloseDay: 31,
        voucherShowQrCode: true,
        themeColor: '#10b981',
        language: 'th',
        animationEnabled: false,
      },
    });
    const { wrapper } = makeWrapper();
    renderHook(() => useUiFlags(), { wrapper });

    await waitFor(() => {
      expect(document.documentElement.getAttribute('data-animations-disabled')).toBe('true');
    });
  });
});
