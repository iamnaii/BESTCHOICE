import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const toastCalls: { success: string[]; error: string[] } = { success: [], error: [] };
vi.mock('sonner', () => ({
  toast: { success: (m: string) => toastCalls.success.push(m), error: (m: string) => toastCalls.error.push(m) },
}));
const apiPatch = vi.fn();
vi.mock('@/lib/api', () => ({
  __esModule: true,
  default: { patch: (...args: unknown[]) => apiPatch(...args) },
  getErrorMessage: (err: unknown) => (err instanceof Error ? err.message : 'unknown'),
}));

import { PeakContactCodeField } from '../PeakContactCodeField';

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  toastCalls.success.length = 0;
  toastCalls.error.length = 0;
  apiPatch.mockReset();
});

/** mapping v5: accountants set the PEAK contact code the export uses as a sub-code. */
describe('PeakContactCodeField', () => {
  it('read-only viewers see the code as plain text (or a dash) and no input', () => {
    wrap(<PeakContactCodeField contactId="ct-1" value="C00790" canEdit={false} />);
    expect(screen.getByText('C00790')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('editors get an input prefilled with the current code and a save button that PATCHes the trimmed value', async () => {
    apiPatch.mockResolvedValue({ data: { id: 'ct-1', peakContactCode: 'C00801' } });
    wrap(<PeakContactCodeField contactId="ct-1" value="C00790" canEdit />);
    const input = screen.getByRole('textbox', { name: 'รหัสผู้ติดต่อ PEAK' }) as HTMLInputElement;
    expect(input).toHaveValue('C00790');
    const save = screen.getByRole('button', { name: 'บันทึกรหัส PEAK' });
    expect(save).toBeDisabled();
    fireEvent.change(input, { target: { value: ' C00801 ' } });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await waitFor(() => expect(apiPatch).toHaveBeenCalledWith('/contacts/ct-1/peak-code', { peakContactCode: 'C00801' }));
    await waitFor(() => expect(toastCalls.success.length).toBe(1));
  });

  it('clearing the input sends null', async () => {
    apiPatch.mockResolvedValue({ data: { id: 'ct-1', peakContactCode: null } });
    wrap(<PeakContactCodeField contactId="ct-1" value="C00790" canEdit />);
    fireEvent.change(screen.getByRole('textbox', { name: 'รหัสผู้ติดต่อ PEAK' }), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'บันทึกรหัส PEAK' }));
    await waitFor(() => expect(apiPatch).toHaveBeenCalledWith('/contacts/ct-1/peak-code', { peakContactCode: null }));
  });

  it('rejects characters outside the PEAK pattern before calling the API', async () => {
    wrap(<PeakContactCodeField contactId="ct-1" value={null} canEdit />);
    fireEvent.change(screen.getByRole('textbox', { name: 'รหัสผู้ติดต่อ PEAK' }), { target: { value: 'C 00790' } });
    fireEvent.click(screen.getByRole('button', { name: 'บันทึกรหัส PEAK' }));
    await waitFor(() => expect(toastCalls.error.length).toBe(1));
    expect(apiPatch).not.toHaveBeenCalled();
  });
});
