import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SendLineAdHocDialog from './SendLineAdHocDialog';
import type { ContractRow } from '../types';

/**
 * Task 34 ข้อ 2 — ปุ่ม "ส่ง LINE" ของคิวทวงถาม: API คืน `{ sent, notSent: [{ reason, reasonText }] }` · ข้อความที่ถูกระงับ / ยังไม่ได้ส่ง
 * ต้องไม่ขึ้นว่าส่งแล้ว และโหมดโฟกัสต้องไม่บันทึกผล "ส่ง LINE แล้ว" (`onSent`)
 */

const apiMock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@/lib/api', () => ({ default: apiMock, getErrorMessage: (e: unknown) => String(e) }));
const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast: toastMock }));

const NO_CONSENT_TEXT =
  'ไม่ได้ส่ง — ลูกค้ายังไม่ได้ให้ความยินยอม PDPA ระบบจึงไม่ส่งข้อความทวงทาง LINE · ติดต่อลูกค้าทางโทรศัพท์แทน';

const contract = {
  id: 'c1',
  contractNumber: 'BC-001',
  customer: { id: 'cu1', name: 'สมชาย', phone: '081', hasVerifiedLine: true },
  outstanding: 1515.83,
  daysOverdue: 5,
} as unknown as ContractRow;

function renderDialog() {
  const onClose = vi.fn();
  const onSent = vi.fn();
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={qc}>
      <SendLineAdHocDialog open contract={contract} onClose={onClose} onSent={onSent} />
    </QueryClientProvider>,
  );
  return { onClose, onSent };
}

async function sendCustomMessage() {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'พิมพ์เอง' }));
  await user.type(
    screen.getByPlaceholderText('พิมพ์ข้อความถึงลูกค้า...'),
    'กรุณาชำระค่างวดที่ค้าง',
  );
  await user.click(screen.getByRole('button', { name: 'ส่ง LINE' }));
}

beforeEach(() => {
  vi.clearAllMocks();
  apiMock.get.mockResolvedValue({ data: [] });
});

describe('SendLineAdHocDialog — ผลการส่ง', () => {
  it('ถูกระงับ (ไม่มีความยินยอม PDPA) → แจ้งเหตุผล ไม่บอกว่าส่งแล้ว ไม่บันทึกผล "ส่ง LINE แล้ว"', async () => {
    apiMock.post.mockResolvedValueOnce({
      data: {
        sent: 0,
        failed: 1,
        total: 1,
        notSent: [
          {
            contractId: 'c1',
            contractNumber: 'BC-001',
            reason: 'NO_CONSENT',
            reasonText: NO_CONSENT_TEXT,
          },
        ],
      },
    });
    const { onClose, onSent } = renderDialog();

    await sendCustomMessage();

    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith(NO_CONSENT_TEXT));
    expect(toastMock.success).not.toHaveBeenCalled();
    expect(onSent).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('ส่งถึงแล้ว → "ส่ง LINE สำเร็จ" + บันทึกผลในโหมดโฟกัส', async () => {
    apiMock.post.mockResolvedValueOnce({ data: { sent: 1, failed: 0, total: 1, notSent: [] } });
    const { onSent } = renderDialog();

    await sendCustomMessage();

    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith('ส่ง LINE สำเร็จ'));
    expect(toastMock.error).not.toHaveBeenCalled();
    expect(onSent).toHaveBeenCalledTimes(1);
  });
});
