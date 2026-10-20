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
    wrap(<PeakMappingSettings canEdit />);
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

    wrap(<PeakMappingSettings canEdit />);
    await screen.findByText('11-1101');

    const input = screen.getByLabelText(/รหัส PEAK สำหรับ 11-1101/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '1110-01' } });

    const saveBtn = screen.getByRole('button', { name: /บันทึก/ });
    expect(saveBtn).toBeEnabled();
    fireEvent.click(saveBtn);

    await waitFor(() => expect(apiPut).toHaveBeenCalledTimes(1));
    // mapping v5: every dirty row is sent with its full triple so the API never
    // mistakes an omitted field for "clear it".
    expect(apiPut).toHaveBeenCalledWith('/chart-of-accounts/peak-mapping', {
      mappings: [{ id: 'a1', peakCode: '1110-01', peakSubCode: null, peakSubCodeSource: 'none' }],
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
    wrap(<PeakMappingSettings canEdit />);
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

    wrap(<PeakMappingSettings canEdit />);
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

// ---- FINANCE mapping v5: รหัสย่อย PEAK + แหล่งรหัสย่อย (mockup เจ้าของเคาะ 2026-10-20) ----
describe('PeakMappingSettings — sub-code columns', () => {
  const rows = [
    { id: 'c1', code: '11-2101', name: 'ลูกหนี้ผ่อนชำระ', type: 'สินทรัพย์', peakCode: '113101', peakSubCode: null, peakSubCodeSource: 'contact' },
    { id: 'f1', code: '11-6101', name: 'ภาษีจ่ายแทน SHOP', type: 'สินทรัพย์', peakCode: '212203', peakSubCode: 'ADV001', peakSubCodeSource: 'fixed' },
    { id: 'n1', code: '53-1306', name: 'ค่าขนส่ง', type: 'ค่าใช้จ่าย', peakCode: '530215', peakSubCode: null, peakSubCodeSource: 'none' },
  ];

  it('renders a source select per row and enables the sub-code input only for a fixed source', async () => {
    apiGet.mockResolvedValueOnce({ data: rows });
    wrap(<PeakMappingSettings canEdit />);
    await screen.findByText('11-2101');
    expect(screen.getByRole('combobox', { name: 'แหล่งรหัสย่อย สำหรับ 11-2101' })).toHaveValue('contact');
    const contactSub = screen.getByLabelText('รหัสย่อย PEAK สำหรับ 11-2101') as HTMLInputElement;
    expect(contactSub).toBeDisabled();
    expect(contactSub.placeholder).toBe('ระบบหาจากผู้ติดต่อ');
    const fixedSub = screen.getByLabelText('รหัสย่อย PEAK สำหรับ 11-6101') as HTMLInputElement;
    expect(fixedSub).toBeEnabled();
    expect(fixedSub).toHaveValue('ADV001');
    expect(screen.getByLabelText('รหัสย่อย PEAK สำหรับ 53-1306')).toBeDisabled();
  });

  it('switching a row to "fixed" enables the sub-code input and saves the full triple', async () => {
    apiGet.mockResolvedValueOnce({ data: rows });
    apiPut.mockResolvedValueOnce({ data: { updated: 1 } });
    wrap(<PeakMappingSettings canEdit />);
    await screen.findByText('53-1306');
    fireEvent.change(screen.getByRole('combobox', { name: 'แหล่งรหัสย่อย สำหรับ 53-1306' }), { target: { value: 'fixed' } });
    const sub = screen.getByLabelText('รหัสย่อย PEAK สำหรับ 53-1306') as HTMLInputElement;
    expect(sub).toBeEnabled();
    fireEvent.change(sub, { target: { value: ' trn001 ' } });
    fireEvent.click(screen.getByRole('button', { name: /บันทึก/ }));
    await waitFor(() => expect(apiPut).toHaveBeenCalledTimes(1));
    expect(apiPut).toHaveBeenCalledWith('/chart-of-accounts/peak-mapping', {
      mappings: [{ id: 'n1', peakCode: '530215', peakSubCode: 'trn001', peakSubCodeSource: 'fixed' }],
    });
  });

  it('switching a fixed row to a per-line source clears the sub-code', async () => {
    apiGet.mockResolvedValueOnce({ data: rows });
    apiPut.mockResolvedValueOnce({ data: { updated: 1 } });
    wrap(<PeakMappingSettings canEdit />);
    await screen.findByText('11-6101');
    fireEvent.change(screen.getByRole('combobox', { name: 'แหล่งรหัสย่อย สำหรับ 11-6101' }), { target: { value: 'bank' } });
    const sub = screen.getByLabelText('รหัสย่อย PEAK สำหรับ 11-6101') as HTMLInputElement;
    expect(sub).toBeDisabled();
    expect(sub).toHaveValue('');
    expect(sub.placeholder).toBe('ระบบหาจากบัญชีธนาคาร');
    fireEvent.click(screen.getByRole('button', { name: /บันทึก/ }));
    await waitFor(() => expect(apiPut).toHaveBeenCalledTimes(1));
    expect(apiPut).toHaveBeenCalledWith('/chart-of-accounts/peak-mapping', {
      mappings: [{ id: 'f1', peakCode: '212203', peakSubCode: null, peakSubCodeSource: 'bank' }],
    });
  });

  it('a fixed source without a sub-code shows an inline error and disables Save', async () => {
    apiGet.mockResolvedValueOnce({ data: rows });
    wrap(<PeakMappingSettings canEdit />);
    await screen.findByText('11-6101');
    fireEvent.change(screen.getByLabelText('รหัสย่อย PEAK สำหรับ 11-6101'), { target: { value: '' } });
    expect(await screen.findByText('ต้องระบุเมื่อแหล่งเป็น "คงที่"')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /บันทึก/ })).toBeDisabled();
    expect(apiPut).not.toHaveBeenCalled();
  });

  it('bulk import accepts the 4-column format, the downloaded CSV with header, and the old 2-column format', async () => {
    apiGet.mockResolvedValueOnce({ data: rows });
    apiPut.mockResolvedValueOnce({ data: { updated: 3 } });
    wrap(<PeakMappingSettings canEdit />);
    await screen.findByText('11-2101');
    fireEvent.click(screen.getByRole('button', { name: 'นำเข้าจาก CSV' }));
    fireEvent.change(screen.getByLabelText('รายการ'), {
      target: {
        value: [
          'code,name,peakCode,peakSubCode,peakSubCodeSource',
          '11-2101,ลูกหนี้ผ่อนชำระ,113101,,cashbox',
          '53-1306,ค่าขนส่ง,530215,TRN001,fixed',
          '11-6101,212299',
          '99-9999,000000',
        ].join('\n'),
      },
    });
    fireEvent.click(screen.getByRole('button', { name: 'นำไปแก้ไข' }));
    await waitFor(() => expect(toastCalls.success.at(-1)).toContain('นำเข้า 3 รายการ'));
    expect(toastCalls.success.at(-1)).toContain('ข้าม 1 รายการ');
    // Old 2-column line keeps the stored sub-code/source of that row.
    expect(screen.getByLabelText('รหัสย่อย PEAK สำหรับ 11-6101')).toHaveValue('ADV001');
    fireEvent.click(screen.getByRole('button', { name: /บันทึก/ }));
    await waitFor(() => expect(apiPut).toHaveBeenCalledTimes(1));
    const sent = (apiPut.mock.calls[0][1] as { mappings: unknown[] }).mappings;
    expect(sent).toEqual(
      expect.arrayContaining([
        { id: 'c1', peakCode: '113101', peakSubCode: null, peakSubCodeSource: 'cashbox' },
        { id: 'n1', peakCode: '530215', peakSubCode: 'TRN001', peakSubCodeSource: 'fixed' },
        { id: 'f1', peakCode: '212299', peakSubCode: 'ADV001', peakSubCodeSource: 'fixed' },
      ]),
    );
    expect(sent).toHaveLength(3);
  });

  it('read-only users see the source and sub-code but cannot change them', async () => {
    apiGet.mockResolvedValueOnce({ data: rows });
    wrap(<PeakMappingSettings />);
    await screen.findByText('11-6101');
    expect(screen.getByRole('combobox', { name: 'แหล่งรหัสย่อย สำหรับ 11-6101' })).toBeDisabled();
    expect(screen.getByLabelText('รหัสย่อย PEAK สำหรับ 11-6101')).toHaveAttribute('readonly');
  });
});
