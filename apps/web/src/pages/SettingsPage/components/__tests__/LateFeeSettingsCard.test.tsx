import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import React from 'react';

// Mutable auth role (vi.mock factory is hoisted — reference via vi.hoisted holder).
const authState = vi.hoisted(() => ({ role: 'OWNER' as string }));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { role: authState.role } }),
}));

const apiGet = vi.fn();
const apiPatch = vi.fn();
vi.mock('@/lib/api', () => ({
  __esModule: true,
  default: {
    get: (...args: unknown[]) => apiGet(...args),
    patch: (...args: unknown[]) => apiPatch(...args),
  },
  getErrorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

import { toast } from 'sonner';
import { LateFeeSettingsCard } from '../LateFeeSettingsCard';

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(React.createElement(QueryClientProvider, { client: qc }, ui));
}

// Minimal /settings payload — the card fills the rest from BUSINESS_RULES defaults.
function settingsResponse(overrides: Record<string, string> = {}) {
  const base: Record<string, string> = { late_fee_tier1_amount: '60', ...overrides };
  return {
    data: Object.entries(base).map(([key, value], i) => ({ id: `sc-${i}`, key, value, label: null })),
  };
}

async function enterEditMode() {
  await waitFor(() => expect(screen.getByRole('button', { name: 'แก้ไข' })).toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: 'แก้ไข' }));
}

describe('LateFeeSettingsCard', () => {
  beforeEach(() => {
    authState.role = 'OWNER';
    apiGet.mockReset();
    apiPatch.mockReset();
    apiPatch.mockResolvedValue({ data: {} });
    (toast.error as ReturnType<typeof vi.fn>).mockClear();
    (toast.success as ReturnType<typeof vi.fn>).mockClear();
  });

  it('view mode shows the stored tier1 value', async () => {
    apiGet.mockResolvedValue(settingsResponse());
    wrap(<LateFeeSettingsCard />);
    await waitFor(() => expect(screen.getByText('ค่าปรับ tier1')).toBeInTheDocument());
    expect(screen.getByText(/60\s*บาท/)).toBeInTheDocument();
  });

  it('edit mode shows the tier1/tier2/minDays fields (no mode selector)', async () => {
    apiGet.mockResolvedValue(settingsResponse());
    wrap(<LateFeeSettingsCard />);
    await enterEditMode();

    expect(screen.getByDisplayValue('60')).toBeInTheDocument(); // tier1 override
    expect(screen.getByDisplayValue('100')).toBeInTheDocument(); // tier2 default
    expect(screen.getByDisplayValue('3')).toBeInTheDocument(); // minDays default
    expect(screen.queryByLabelText('โหมดคิดค่าปรับ')).toBeNull();
  });

  it('save PATCHes only the changed keys', async () => {
    apiGet.mockResolvedValue(settingsResponse());
    wrap(<LateFeeSettingsCard />);
    await enterEditMode();

    fireEvent.change(screen.getByDisplayValue('60'), { target: { value: '75' } });
    fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }));

    await waitFor(() => expect(apiPatch).toHaveBeenCalledTimes(1));
    const [url, body] = apiPatch.mock.calls[0];
    expect(url).toBe('/settings');
    expect(body.items).toEqual([{ key: 'late_fee_tier1_amount', value: '75' }]);
  });

  it('blocks save with a toast when tier2_min_days is below 1 (no PATCH)', async () => {
    apiGet.mockResolvedValue(settingsResponse());
    wrap(<LateFeeSettingsCard />);
    await enterEditMode();

    fireEvent.change(screen.getByDisplayValue('3'), { target: { value: '0' } }); // minDays 3 -> 0
    fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }));

    expect(toast.error).toHaveBeenCalled();
    expect(apiPatch).not.toHaveBeenCalled();
  });

  it('blocks save when a late-fee field is cleared to empty (would zero the fee)', async () => {
    apiGet.mockResolvedValue(settingsResponse());
    wrap(<LateFeeSettingsCard />);
    await enterEditMode();

    fireEvent.change(screen.getByDisplayValue('60'), { target: { value: '' } }); // clear tier1
    fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }));

    expect(toast.error).toHaveBeenCalled();
    expect(apiPatch).not.toHaveBeenCalled();
  });

  it('preview estimates the flat-bracket fee (flat tier2, not proportional to days)', async () => {
    apiGet.mockResolvedValue(settingsResponse());
    wrap(<LateFeeSettingsCard />);
    await enterEditMode();
    // defaults: tier1=60 (overridden), tier2=100, minDays=3, preview days=10 (>= minDays) → tier2 = 100
    expect(screen.getByText(/100\.00/)).toBeInTheDocument();
  });

  it('non-OWNER sees a read-only notice and no edit button', async () => {
    authState.role = 'SALES';
    apiGet.mockResolvedValue(settingsResponse());
    wrap(<LateFeeSettingsCard />);
    await waitFor(() => expect(screen.getByText('ค่าปรับ tier1')).toBeInTheDocument());
    expect(screen.getByText('เฉพาะ OWNER เท่านั้นที่แก้ไขได้')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'แก้ไข' })).toBeNull();
  });
});
