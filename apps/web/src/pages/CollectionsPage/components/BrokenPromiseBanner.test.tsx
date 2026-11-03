import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import BrokenPromiseBanner from './BrokenPromiseBanner';

/**
 * Task 34 ข้อ 2 — ส่ง LINE รวด (แบนเนอร์นัดครบกำหนดวันนี้): สรุปผลต้องแยก "ส่งแล้ว" กับ "ไม่ได้ส่ง พร้อมเหตุผล" · เดิมขึ้น
 * "ส่ง LINE สำเร็จ 3/3 ราย (ล้มเหลว 0)" แม้ข้อความถูกระงับ
 */

const apiMock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@/lib/api', () => ({ default: apiMock, getErrorMessage: (e: unknown) => String(e) }));
const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }));
vi.mock('sonner', () => ({ toast: toastMock }));

// ข้อความเดียวกับ API (`apps/api/src/modules/notifications/send-outcome.ts` NOT_SENT_REASON_TEXT) — รีวิว M3
const NO_CONSENT_TEXT =
  'ไม่ได้ส่ง — ลูกค้ายังไม่ได้ให้ความยินยอม PDPA ระบบจึงไม่ส่งข้อความทวง · ติดต่อลูกค้าทางโทรศัพท์แทน';
const CAP_TEXT =
  'ไม่ได้ส่ง — วันนี้สัญญานี้ได้ข้อความทวงไปแล้ว (ทวงได้วันละ 1 ครั้งต่อสัญญา) · ส่งใหม่ได้พรุ่งนี้';
const OUTSIDE_HOURS_TEXT =
  'ยังไม่ได้ส่ง — นอกเวลาทวงถามตามกฎหมาย (วันธรรมดา 08:00–20:00 น. · วันหยุด 08:00–18:00 น.) ระบบเก็บไว้ส่งให้เองเมื่อถึงเวลา';
const RETRY_TEXT = 'ยังไม่ได้ส่ง — ส่งทาง LINE ไม่ผ่าน ระบบจะลองส่งใหม่อัตโนมัติ';

const rows = ['c1', 'c2', 'c3', 'c4'].map((id, i) => ({
  id: `r${i}`,
  contractId: id,
  contractNumber: `BC-00${i + 1}`,
  customerName: `ลูกค้า ${i + 1}`,
  hasLine: true,
  createdAt: '2026-11-03T02:00:00.000Z',
}));

function renderBanner() {
  apiMock.get.mockResolvedValue({
    data: { total: 4, withLine: 4, contractIds: rows.map((r) => r.contractId), data: rows },
  });
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={qc}>
      <BrokenPromiseBanner />
    </QueryClientProvider>,
  );
}

const notSent = (
  contractId: string,
  contractNumber: string,
  reason: string,
  reasonText: string,
) => ({
  contractId,
  contractNumber,
  reason,
  reasonText,
});

beforeEach(() => vi.clearAllMocks());

describe('BrokenPromiseBanner — สรุปผลส่ง LINE รวด', () => {
  it('ส่งแล้ว 1 · ไม่ได้ส่ง 3 (สองเหตุผล) → แจ้งส่งแล้วเฉพาะที่ส่งถึง + รายการที่ไม่ได้ส่งแยกตามเหตุผล', async () => {
    apiMock.post.mockResolvedValueOnce({
      data: {
        sent: 1,
        failed: 3,
        total: 4,
        notSent: [
          notSent('c2', 'BC-002', 'NO_CONSENT', NO_CONSENT_TEXT),
          notSent('c3', 'BC-003', 'FREQUENCY_CAP', CAP_TEXT),
          notSent('c4', 'BC-004', 'NO_CONSENT', NO_CONSENT_TEXT),
        ],
      },
    });
    renderBanner();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: /ส่ง LINE ทั้งหมด/ }));

    await waitFor(() =>
      expect(toastMock.success).toHaveBeenCalledWith('ส่ง LINE แล้ว 1 จาก 4 ราย'),
    );
    expect(toastMock.error).toHaveBeenCalledWith('ไม่ได้ส่ง 3 จาก 4 ราย', {
      description: `${NO_CONSENT_TEXT} (BC-002, BC-004)\n${CAP_TEXT} (BC-003)`,
    });
  });

  it('ถูกระงับทั้งหมด → ไม่มีข้อความว่าส่งสำเร็จ', async () => {
    apiMock.post.mockResolvedValueOnce({
      data: {
        sent: 0,
        failed: 4,
        total: 4,
        notSent: rows.map((r) =>
          notSent(r.contractId, r.contractNumber, 'NO_CONSENT', NO_CONSENT_TEXT),
        ),
      },
    });
    renderBanner();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: /ส่ง LINE ทั้งหมด/ }));

    await waitFor(() => expect(toastMock.error).toHaveBeenCalledTimes(1));
    expect(toastMock.error).toHaveBeenCalledWith('ไม่ได้ส่ง 4 จาก 4 ราย', {
      description: `${NO_CONSENT_TEXT} (BC-001, BC-002, BC-003, BC-004)`,
    });
    expect(toastMock.success).not.toHaveBeenCalled();
  });

  it('ส่งถึงครบ → "ส่ง LINE แล้ว 4 จาก 4 ราย" ไม่มีแจ้งข้อผิดพลาด', async () => {
    apiMock.post.mockResolvedValueOnce({ data: { sent: 4, failed: 0, total: 4, notSent: [] } });
    renderBanner();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: /ส่ง LINE ทั้งหมด/ }));

    await waitFor(() =>
      expect(toastMock.success).toHaveBeenCalledWith('ส่ง LINE แล้ว 4 จาก 4 ราย'),
    );
    expect(toastMock.error).not.toHaveBeenCalled();
  });

  /** รีวิว M6 — กลุ่ม "ยังไม่ได้ส่ง แต่ระบบจะส่งเอง" แจ้งด้วย toast เตือนแยกจากกลุ่มที่ถูกระงับ (toast error) · ข้อความเหตุผลคงเดิม */
  it('ระบบจะส่งเอง (นอกเวลาทำการ / เข้าคิวส่งซ้ำ) → toast เตือน · ถูกระงับ → toast error · แยกกลุ่ม', async () => {
    apiMock.post.mockResolvedValueOnce({
      data: {
        sent: 1,
        failed: 3,
        total: 4,
        notSent: [
          notSent('c2', 'BC-002', 'OUTSIDE_HOURS', OUTSIDE_HOURS_TEXT),
          notSent('c3', 'BC-003', 'NO_CONSENT', NO_CONSENT_TEXT),
          notSent('c4', 'BC-004', 'DELIVERY_FAILED', RETRY_TEXT),
        ],
      },
    });
    renderBanner();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: /ส่ง LINE ทั้งหมด/ }));

    await waitFor(() => expect(toastMock.warning).toHaveBeenCalledTimes(1));
    expect(toastMock.warning).toHaveBeenCalledWith('ยังไม่ได้ส่ง 2 จาก 4 ราย — ระบบจะส่งให้เอง', {
      description: `${OUTSIDE_HOURS_TEXT} (BC-002)\n${RETRY_TEXT} (BC-004)`,
    });
    expect(toastMock.error).toHaveBeenCalledWith('ไม่ได้ส่ง 1 จาก 4 ราย', {
      description: `${NO_CONSENT_TEXT} (BC-003)`,
    });
    expect(toastMock.success).toHaveBeenCalledWith('ส่ง LINE แล้ว 1 จาก 4 ราย');
  });
});
