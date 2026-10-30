import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import LiffFinanceVerify from './LiffFinanceVerify';

/**
 * Task 20 fix round 1 (I-B) — หน้า OTP ต้องบอกทางที่ทำได้จริงเมื่อไม่ได้รับ SMS (เพดาน/decoy ตอบเหมือนส่งแล้ว
 * เสมอ — M4) และข้อความ error ตอนกด "ขอรหัสใหม่" (รอ/ล็อก) ต้องขึ้นบนหน้า OTP ไม่ใช่หน้ากรอกเบอร์ที่มองไม่เห็น
 */
const { get, post } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));

vi.mock('@/hooks/useLiffInit', () => ({
  useLiffInit: () => ({
    lineId: 'U-test',
    profile: { userId: 'U-test', displayName: 'ทดสอบ' },
    loading: false,
    error: null,
  }),
}));
vi.mock('@/lib/api', () => ({ liffApi: { get, post } }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <LiffFinanceVerify />
    </QueryClientProvider>,
  );
}

async function goToOtpStep() {
  renderPage();
  const input = await screen.findByPlaceholderText(/08/);
  fireEvent.change(input, { target: { value: '0812345678' } });
  fireEvent.click(screen.getByRole('button', { name: 'ส่งรหัส OTP' }));
  await screen.findByText('089-***-5678');
}

describe('LiffFinanceVerify — OTP step help (Task 20 round 1)', () => {
  beforeEach(() => {
    get.mockReset().mockResolvedValue({ data: { linked: false } });
    post
      .mockReset()
      .mockResolvedValue({ data: { maskedPhone: '089-***-5678', expiresInSeconds: 300 } });
  });

  it('tells the user what to do when no SMS arrives (call the branch)', async () => {
    await goToOtpStep();
    expect(screen.getByText(/ไม่ได้รับ SMS ภายใน 2 นาที/)).toBeTruthy();
    expect(screen.getByText(/063-134-6356/)).toBeTruthy();
  });

  it('an error from "ขอรหัสใหม่" is shown on the OTP step', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      await goToOtpStep();
      post.mockRejectedValueOnce({
        response: { data: { message: 'ใส่ OTP ผิดครบ 3 ครั้งแล้ว — ขอรหัสใหม่ได้ในอีก 4 นาที' } },
      });
      // นับถอยหลัง 60 วิ (setTimeout ทีละวินาทีผ่าน useEffect) — เดินทีละวินาทีให้ React commit ทุกรอบ
      for (let i = 0; i < 61; i++) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(1_000);
        });
      }
      fireEvent.click(await screen.findByRole('button', { name: 'ขอรหัสใหม่' }));
      expect(await screen.findByText(/ขอรหัสใหม่ได้ในอีก 4 นาที/)).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });
});
