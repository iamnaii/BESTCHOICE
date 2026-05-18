import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
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
const apiPut = vi.fn();
vi.mock('@/lib/api', () => ({
  __esModule: true,
  default: {
    get: (...args: unknown[]) => apiGet(...args),
    put: (...args: unknown[]) => apiPut(...args),
  },
  getErrorMessage: (err: unknown) =>
    err && typeof err === 'object' && 'message' in err ? String((err as Error).message) : 'unknown',
}));

// Stub URL.createObjectURL for jsdom (used by CSV download button)
beforeEach(() => {
  toastCalls.success.length = 0;
  toastCalls.error.length = 0;
  toastCalls.warning.length = 0;
  apiGet.mockReset();
  apiPut.mockReset();
  (URL as unknown as { createObjectURL: () => string }).createObjectURL = () => 'blob:mock';
  (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => undefined;
});

// Import AFTER mocks
import PeakMappingSettings from '../PeakMappingSettings';

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe('PeakMappingSettings', () => {
  it('renders rows with current PEAK code or empty input for unmapped', async () => {
    apiGet.mockResolvedValueOnce({
      data: [
        { id: 'a1', code: '11-1101', name: 'เงินสด', type: 'สินทรัพย์', peakCode: '1110-01' },
        { id: 'a2', code: '11-1102', name: 'ลูกหนี้', type: 'สินทรัพย์', peakCode: null },
      ],
    });
    wrap(<PeakMappingSettings />);
    expect(await screen.findByText('11-1101')).toBeInTheDocument();
    expect(screen.getByText('11-1102')).toBeInTheDocument();
    expect(screen.getByDisplayValue('1110-01')).toBeInTheDocument();
    // Unmapped row has an empty input rendered with placeholder "—"
    const inputs = screen.getAllByRole('textbox') as HTMLInputElement[];
    const a2Input = inputs.find((i) => i.value === '' && i.getAttribute('aria-label')?.includes('11-1102'));
    expect(a2Input).toBeDefined();
  });

  it('Save calls PUT with the mappings + toasts on success', async () => {
    apiGet.mockResolvedValueOnce({
      data: [{ id: 'a1', code: '11-1101', name: 'เงินสด', type: 'สินทรัพย์', peakCode: null }],
    });
    apiPut.mockResolvedValueOnce({ data: { updated: 1 } });

    wrap(<PeakMappingSettings />);
    await screen.findByText('11-1101');

    const input = screen.getByLabelText(/รหัส PEAK สำหรับ 11-1101/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '1110-01' } });

    const saveBtn = screen.getByRole('button', { name: /บันทึก/ });
    expect(saveBtn).toBeEnabled();
    fireEvent.click(saveBtn);

    await waitFor(() => expect(apiPut).toHaveBeenCalledTimes(1));
    expect(apiPut).toHaveBeenCalledWith('/chart-of-accounts/peak-mapping', {
      mappings: [{ id: 'a1', peakCode: '1110-01' }],
    });
    await waitFor(() => expect(toastCalls.success.length).toBeGreaterThan(0));
  });

  it('Download CSV calls the CSV endpoint with responseType=blob', async () => {
    apiGet.mockImplementation((path: string) => {
      if (path === '/chart-of-accounts/peak-mapping') {
        return Promise.resolve({ data: [] });
      }
      if (path === '/chart-of-accounts/peak-mapping/csv') {
        return Promise.resolve({ data: new Blob(['code,name,peakCode\n']) });
      }
      return Promise.reject(new Error('unexpected path: ' + path));
    });
    wrap(<PeakMappingSettings />);
    // Wait for initial fetch to settle
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/chart-of-accounts/peak-mapping'));

    fireEvent.click(screen.getByRole('button', { name: /ดาวน์โหลด CSV/ }));
    await waitFor(() =>
      expect(apiGet).toHaveBeenCalledWith(
        '/chart-of-accounts/peak-mapping/csv',
        expect.objectContaining({ responseType: 'blob' }),
      ),
    );
  });

  it('Download CSV uses server Content-Disposition filename when present', async () => {
    // Spy on createElement to capture the <a download="..."> attribute set in downloadCsv
    const originalCreate = document.createElement.bind(document);
    const anchors: HTMLAnchorElement[] = [];
    const createSpy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = originalCreate(tag);
      if (tag === 'a') {
        anchors.push(el as HTMLAnchorElement);
        // No-op click — jsdom would otherwise try to navigate
        (el as HTMLAnchorElement).click = () => undefined;
      }
      return el;
    });

    apiGet.mockImplementation((path: string) => {
      if (path === '/chart-of-accounts/peak-mapping') {
        return Promise.resolve({ data: [] });
      }
      if (path === '/chart-of-accounts/peak-mapping/csv') {
        return Promise.resolve({
          data: new Blob(['code,name,peakCode\n']),
          headers: { 'content-disposition': 'attachment; filename="peak-mapping-20260518.csv"' },
        });
      }
      return Promise.reject(new Error('unexpected path: ' + path));
    });

    wrap(<PeakMappingSettings />);
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/chart-of-accounts/peak-mapping'));

    fireEvent.click(screen.getByRole('button', { name: /ดาวน์โหลด CSV/ }));
    await waitFor(() =>
      expect(apiGet).toHaveBeenCalledWith(
        '/chart-of-accounts/peak-mapping/csv',
        expect.objectContaining({ responseType: 'blob' }),
      ),
    );
    await waitFor(() => expect(anchors.length).toBeGreaterThan(0));
    expect(anchors[0].download).toBe('peak-mapping-20260518.csv');

    createSpy.mockRestore();
  });
});
