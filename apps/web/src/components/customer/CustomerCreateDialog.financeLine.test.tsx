import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const apiPost = vi.fn();
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock('@/lib/api', () => ({
  __esModule: true,
  default: { post: (...args: unknown[]) => apiPost(...args) },
  getErrorMessage: (e: unknown) => (e instanceof Error ? e.message : 'error'),
}));
vi.mock('@/lib/cardReader', () => ({ checkCardReaderStatus: vi.fn(), readSmartCard: vi.fn() }));
vi.mock('@/lib/compressImage', () => ({ compressImageForOcr: vi.fn() }));

import CustomerCreateDialog, { type CustomerCreateDialogProps } from './CustomerCreateDialog';

const VALID_NID = '1234567890121';
const NOTE =
  'ไม่ต้องกรอก ลูกค้าผูกเองหลังสร้างเสร็จ: ส่งข้อความใดก็ได้ในแชท LINE น้องเบส แล้วกดปุ่ม “เริ่มยืนยันตัวตน” กรอกเบอร์และรหัส OTP ทาง SMS';

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

/**
 * Task 27 — สร้างลูกค้าใหม่ (หน้ารายชื่อลูกค้า / แชท): ไม่มีช่อง LINE การเงิน — หมายเหตุเต็มความกว้างบอกวิธีที่ลูกค้าผูกเอง ·
 * payload ไม่ส่ง lineIdFinance (API ปฏิเสธค่าใหม่ทุกค่าอยู่แล้ว — ฟอร์มเดิมทำให้พนักงานชนกำแพง 400)
 */
describe('CustomerCreateDialog — LINE น้องเบส (การเงิน)', () => {
  beforeEach(() => {
    apiPost.mockReset();
  });

  it('ไม่มีช่องพิมพ์ LINE การเงิน · มีหมายเหตุตาม mockup · LINE ร้านยังอยู่ต่อจากหมายเหตุ', () => {
    wrap(<CustomerCreateDialog open onOpenChange={vi.fn()} onCreated={vi.fn()} />);
    expect(screen.queryByText(/LINE ID \(Finance/)).not.toBeInTheDocument();
    const note = screen.getByRole('note', { name: 'LINE น้องเบส (การเงิน)' });
    expect(note).toHaveTextContent(NOTE);
    const shop = screen.getByText('LINE ID (Shop / ร้าน)');
    expect(note.compareDocumentPosition(shop) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('บันทึก → payload ไม่มี lineIdFinance แม้ค่าตั้งต้นจากผู้เรียกจะมีมา', async () => {
    apiPost.mockResolvedValue({ data: { id: 'c-new', name: 'สมชาย ใจดี' } });
    const initialValues = {
      firstName: 'สมชาย',
      lastName: 'ใจดี',
      lineIdFinance: 'U-from-caller',
    } as unknown as CustomerCreateDialogProps['initialValues'];
    wrap(
      <CustomerCreateDialog
        open
        onOpenChange={vi.fn()}
        onCreated={vi.fn()}
        initialValues={initialValues}
      />,
    );
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'นาย' } });
    fireEvent.change(screen.getAllByPlaceholderText('X-XXXX-XXXXX-XX-X')[0], {
      target: { value: VALID_NID },
    });
    fireEvent.change(screen.getAllByPlaceholderText('0XX-XXX-XXXX')[0], {
      target: { value: '0812345678' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }));

    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1));
    const [url, payload] = apiPost.mock.calls[0] as [string, Record<string, unknown>];
    expect(url).toBe('/customers');
    expect(payload).not.toHaveProperty('lineIdFinance');
  });
});
