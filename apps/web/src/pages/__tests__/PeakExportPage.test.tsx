import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import type { ReactNode } from 'react';
import React from 'react';

// --- mock sonner --------------------------------------------------------------
const toastCalls: { success: string[]; error: string[]; warning: string[] } = {
  success: [],
  error: [],
  warning: [],
};
vi.mock('sonner', () => ({
  toast: {
    success: (m: string) => toastCalls.success.push(m),
    error: (m: string) => toastCalls.error.push(m),
    warning: (m: string) => toastCalls.warning.push(m),
  },
}));

// --- mock api -----------------------------------------------------------------
const apiGet = vi.fn();
vi.mock('@/lib/api', () => ({
  __esModule: true,
  default: { get: (...args: unknown[]) => apiGet(...args) },
  getErrorMessage: (err: unknown) =>
    err && typeof err === 'object' && 'message' in err ? String((err as Error).message) : 'unknown',
}));

beforeEach(() => {
  toastCalls.success.length = 0;
  toastCalls.error.length = 0;
  toastCalls.warning.length = 0;
  apiGet.mockReset();
  (URL as unknown as { createObjectURL: () => string }).createObjectURL = () => 'blob:mock';
  (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => undefined;
});

import PeakExportPage from '../PeakExportPage';

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('PeakExportPage', () => {
  it('renders the date pickers + download button', () => {
    wrap(<PeakExportPage />);
    expect(screen.getByLabelText('วันที่เริ่มต้น')).toBeInTheDocument();
    expect(screen.getByLabelText('วันที่สิ้นสุด')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /ดาวน์โหลด CSV/ })).toBeInTheDocument();
  });

  it('calls the export endpoint with start/end + surfaces skipped count', async () => {
    apiGet.mockResolvedValueOnce({
      data: new Blob(['﻿entryDate,...\n']),
      headers: { 'x-skipped-lines': '5', 'x-row-count': '20' },
    });

    wrap(<PeakExportPage />);
    fireEvent.click(screen.getByRole('button', { name: /ดาวน์โหลด CSV/ }));

    await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(1));
    const callPath = apiGet.mock.calls[0][0] as string;
    expect(callPath).toContain('/expenses/journal/export-peak');
    expect(callPath).toContain('startDate=');
    expect(callPath).toContain('endDate=');
    // Warning toast because skipped > 0
    await waitFor(() => expect(toastCalls.warning.length).toBe(1));
    expect(toastCalls.warning[0]).toContain('5');
  });
});
