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
  const base: Record<string, string> = { late_fee_mode: 'PER_DAY', late_fee_per_day_rate: '25', ...overrides };
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

  it('view mode shows the active PER_DAY mode badge + stored value', async () => {
    apiGet.mockResolvedValue(settingsResponse());
    wrap(<LateFeeSettingsCard />);
    await waitFor(() => expect(screen.getByText('โหมด: ต่อวัน')).toBeInTheDocument());
    expect(screen.getByText(/25\s*บาท\/วัน/)).toBeInTheDocument();
  });

  it('switching mode to BRACKET swaps the per-day fields for tier fields', async () => {
    apiGet.mockResolvedValue(settingsResponse());
    wrap(<LateFeeSettingsCard />);
    await enterEditMode();

    expect(screen.getByDisplayValue('25')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('โหมดคิดค่าปรับ'), { target: { value: 'BRACKET' } });

    expect(screen.getByDisplayValue('50')).toBeInTheDocument(); // tier1 default
    expect(screen.queryByDisplayValue('25')).toBeNull(); // per-day rate gone
  });

  it('PER_DAY save PATCHes only the changed keys', async () => {
    apiGet.mockResolvedValue(settingsResponse());
    wrap(<LateFeeSettingsCard />);
    await enterEditMode();

    fireEvent.change(screen.getByDisplayValue('25'), { target: { value: '30' } });
    fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }));

    await waitFor(() => expect(apiPatch).toHaveBeenCalledTimes(1));
    const [url, body] = apiPatch.mock.calls[0];
    expect(url).toBe('/settings');
    expect(body.items).toEqual([{ key: 'late_fee_per_day_rate', value: '30' }]);
  });

  it('BRACKET save sends late_fee_mode + edited tier field, and NOT the hidden per-day keys', async () => {
    apiGet.mockResolvedValue(settingsResponse());
    wrap(<LateFeeSettingsCard />);
    await enterEditMode();

    fireEvent.change(screen.getByLabelText('โหมดคิดค่าปรับ'), { target: { value: 'BRACKET' } });
    fireEvent.change(screen.getByDisplayValue('50'), { target: { value: '60' } }); // tier1 50 -> 60
    fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }));

    await waitFor(() => expect(apiPatch).toHaveBeenCalledTimes(1));
    const [, body] = apiPatch.mock.calls[0];
    const keys = body.items.map((i: { key: string }) => i.key);
    expect(body.items).toEqual(
      expect.arrayContaining([
        { key: 'late_fee_mode', value: 'BRACKET' },
        { key: 'late_fee_tier1_amount', value: '60' },
      ]),
    );
    // hidden per-day keys must NOT be resent
    expect(keys).not.toContain('late_fee_per_day_rate');
    expect(keys).not.toContain('late_fee_max_amount');
    expect(keys).not.toContain('late_fee_cap_pct');
  });

  it('blocks save with a toast when cap_pct is out of range (no PATCH)', async () => {
    apiGet.mockResolvedValue(settingsResponse());
    wrap(<LateFeeSettingsCard />);
    await enterEditMode();

    fireEvent.change(screen.getByDisplayValue('5'), { target: { value: '150' } }); // cap_pct default 5 -> 150
    fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }));

    expect(toast.error).toHaveBeenCalled();
    expect(apiPatch).not.toHaveBeenCalled();
  });

  it('blocks save when a late-fee field is cleared to empty (would zero the fee)', async () => {
    apiGet.mockResolvedValue(settingsResponse());
    wrap(<LateFeeSettingsCard />);
    await enterEditMode();

    fireEvent.change(screen.getByDisplayValue('25'), { target: { value: '' } }); // clear per-day rate
    fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }));

    expect(toast.error).toHaveBeenCalled();
    expect(apiPatch).not.toHaveBeenCalled();
  });

  it('preview estimates the PER_DAY fee with the 5% cap binding', async () => {
    apiGet.mockResolvedValue(settingsResponse());
    wrap(<LateFeeSettingsCard />);
    await enterEditMode();
    // defaults: rate=25, max=500, cap=5, days=10, gross=1515.83
    // byDay=250, byMax=500, byPct=round2(0.05*1515.83)=75.79 → min=75.79
    expect(screen.getByText(/75\.79/)).toBeInTheDocument();
  });

  it('non-OWNER sees a read-only notice and no edit button', async () => {
    authState.role = 'SALES';
    apiGet.mockResolvedValue(settingsResponse());
    wrap(<LateFeeSettingsCard />);
    await waitFor(() => expect(screen.getByText('โหมด: ต่อวัน')).toBeInTheDocument());
    expect(screen.getByText('เฉพาะ OWNER เท่านั้นที่แก้ไขได้')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'แก้ไข' })).toBeNull();
  });
});
