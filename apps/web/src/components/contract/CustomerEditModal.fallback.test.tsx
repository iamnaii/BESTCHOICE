import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import api from '@/lib/api';
import CustomerEditModal from './CustomerEditModal';

vi.mock('@/lib/api', async (original) => ({
  ...(await original<typeof import('@/lib/api')>()),
  default: { get: vi.fn(), patch: vi.fn() },
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

/**
 * Task 22 fix round 1 M-2 — โหลดข้อมูลลูกค้าฉบับเต็มไม่ได้ ฟอร์มแสดงข้อมูลจาก snapshot (ช่องอื่นว่างเพราะไม่รู้ค่า) ⇒ ตอนบันทึก
 * ห้ามส่งช่องที่ไม่ได้โหลดเป็น null — เดิมล้างอีเมล/Facebook/ที่อยู่/ผู้อ้างอิง และ LINE การเงิน (= ยกเลิกผูก OTP) ทั้งที่พนักงานไม่ได้แตะ
 */
describe('CustomerEditModal — ทางสำรองเมื่อโหลดข้อมูลฉบับเต็มไม่ได้', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset().mockRejectedValue(new Error('network'));
    vi.mocked(api.patch).mockReset().mockResolvedValue({ data: {} });
  });

  function renderModal() {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    return render(
      <QueryClientProvider client={client}>
        <CustomerEditModal
          customerId="c1"
          customerSnapshot={{ name: 'สมชาย', phone: '0812345678' }}
          customerBasic={{ name: 'สมชาย', phone: '0812345678' }}
          onClose={vi.fn()}
          onSuccess={vi.fn()}
        />
      </QueryClientProvider>,
    );
  }

  it('บันทึกโดยไม่แตะช่องที่ไม่ได้โหลด → ไม่ส่งช่องเหล่านั้น (ไม่ยกเลิกผูก LINE · ไม่ล้างอีเมล/ผู้อ้างอิง)', async () => {
    renderModal();
    const save = await screen.findByRole('button', { name: 'บันทึก' });
    await waitFor(() => expect(save).not.toBeDisabled());
    fireEvent.click(save);

    await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(1));
    const [url, payload] = vi.mocked(api.patch).mock.calls[0] as [string, Record<string, unknown>];
    expect(url).toBe('/customers/c1');
    for (const key of [
      'lineIdFinance',
      'lineIdShop',
      'email',
      'phoneSecondary',
      'facebookLink',
      'facebookName',
      'facebookFriends',
      'googleMapLink',
      'addressCurrentType',
      'occupationDetail',
      'workplace',
      'birthDate',
      'references',
    ]) {
      expect(payload).not.toHaveProperty(key);
    }
    expect(payload).toMatchObject({ name: 'สมชาย', phone: '0812345678' });
  });

  it('โหลดฉบับเต็มได้ → ล้างช่อง LINE การเงินแล้วบันทึก = ส่ง null (ทางยกเลิกผูกของ OWNER/BM ยังใช้ได้)', async () => {
    vi.mocked(api.get)
      .mockReset()
      .mockResolvedValue({
        data: { name: 'สมชาย', phone: '0812345678', lineIdFinance: 'U-verified', references: [] },
      });
    renderModal();
    const line = await screen.findByLabelText('LINE ID (น้องเบส / FINANCE)');
    await waitFor(() => expect(line).toHaveValue('U-verified'));
    fireEvent.change(line, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }));

    await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(1));
    const payload = vi.mocked(api.patch).mock.calls[0][1] as Record<string, unknown>;
    expect(payload.lineIdFinance).toBeNull();
  });
});
