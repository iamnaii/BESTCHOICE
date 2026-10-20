import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router';
import React from 'react';

const toastCalls: { success: string[]; error: string[]; warning: string[] } = { success: [], error: [], warning: [] };
vi.mock('sonner', () => ({
  toast: {
    success: (m: string) => toastCalls.success.push(m),
    error: (m: string) => toastCalls.error.push(m),
    warning: (m: string) => toastCalls.warning.push(m),
  },
}));
const apiGet = vi.fn();
vi.mock('@/lib/api', () => ({
  __esModule: true,
  default: { get: (...args: unknown[]) => apiGet(...args) },
  getErrorMessage: (err: unknown) => (err instanceof Error ? err.message : 'unknown'),
}));
vi.mock('@/hooks/useDocumentTitle', () => ({ useDocumentTitle: () => undefined }));

beforeEach(() => {
  toastCalls.success.length = 0;
  toastCalls.error.length = 0;
  toastCalls.warning.length = 0;
  apiGet.mockReset();
  (URL as unknown as { createObjectURL: () => string }).createObjectURL = () => 'blob:mock';
  (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => undefined;
  vi.restoreAllMocks();
  const originalCreate = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
    const el = originalCreate(tag);
    if (tag === 'a') (el as HTMLAnchorElement).click = () => undefined;
    return el;
  });
});

import PeakExportPage from '../PeakExportPage';

/** mapping v5: the export now reports contact lines whose party has no PEAK contact code. */
describe('PeakExportPage — unresolved sub-codes', () => {
  it('shows how many lines still lack a PEAK contact code and where to fix it', async () => {
    apiGet.mockResolvedValue({
      data: new Blob(['x']),
      headers: { 'x-skipped-lines': '0', 'x-row-count': '12', 'x-unresolved-sub-codes': '3' },
    });
    render(<MemoryRouter><PeakExportPage /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: /ดาวน์โหลด CSV/ }));
    await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/รหัสย่อยยังหาไม่ได้/)).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /รายชื่อผู้ติดต่อ/ })).toHaveAttribute('href', '/contacts');
    expect(toastCalls.warning.at(-1)).toContain('รหัสย่อยยังหาไม่ได้ 3 บรรทัด');
  });

  it('stays quiet about sub-codes when every contact line resolved', async () => {
    apiGet.mockResolvedValue({
      data: new Blob(['x']),
      headers: { 'x-skipped-lines': '0', 'x-row-count': '12', 'x-unresolved-sub-codes': '0' },
    });
    render(<MemoryRouter><PeakExportPage /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: /ดาวน์โหลด CSV/ }));
    await waitFor(() => expect(toastCalls.success.length).toBe(1));
    expect(screen.queryByText(/รหัสย่อยยังหาไม่ได้/)).not.toBeInTheDocument();
  });
});
