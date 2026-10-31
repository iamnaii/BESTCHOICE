import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import api from '@/lib/api';
import CustomerEditModal from './CustomerEditModal';

vi.mock('@/lib/api', async (original) => ({
  ...(await original<typeof import('@/lib/api')>()),
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
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

  it('ทางสำรอง → ไม่แสดงแถว LINE น้องเบส (ไม่รู้สถานะ = ไม่เดาว่าผูกหรือไม่ผูก)', async () => {
    renderModal();
    await screen.findByRole('button', { name: 'บันทึก' });
    expect(screen.queryByRole('group', { name: 'LINE น้องเบส (การเงิน)' })).not.toBeInTheDocument();
  });
});

/**
 * Task 27 — หน้าสัญญา › แก้ไขข้อมูลลูกค้า: ช่อง LINE การเงินเป็นแถวสถานะจาก `financeLine` (แถว OTP) · ไม่มีช่องพิมพ์ ·
 * payload ไม่ส่ง lineIdFinance อีก (ทางยกเลิกผูกเดิมของฟอร์ม = ล้างช่องแล้วบันทึก ถูกแทนด้วยปุ่ม "ยกเลิกการผูก")
 */
describe('CustomerEditModal — LINE น้องเบส (การเงิน)', () => {
  beforeEach(() => {
    vi.mocked(api.post).mockReset().mockResolvedValue({ data: {} });
    vi.mocked(api.patch).mockReset().mockResolvedValue({ data: {} });
  });

  function renderLoaded(financeLine: unknown, canUnlinkFinanceLine = true) {
    vi.mocked(api.get)
      .mockReset()
      .mockResolvedValue({
        data: {
          name: 'สมชาย',
          phone: '0812345678',
          lineIdFinance: 'U-column',
          lineIdShop: 'U-shop',
          financeLine,
          references: [],
        },
      });
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    return render(
      <QueryClientProvider client={client}>
        <CustomerEditModal
          customerId="c1"
          customerSnapshot={null}
          customerBasic={{ name: 'สมชาย', phone: '0812345678' }}
          onClose={vi.fn()}
          onSuccess={vi.fn()}
          canUnlinkFinanceLine={canUnlinkFinanceLine}
        />
      </QueryClientProvider>,
    );
  }

  it('ผูกแล้ว → สถานะ + ปุ่มยกเลิกการผูก · ไม่มีช่องพิมพ์ LINE การเงิน · LINE ร้านยังแก้ได้', async () => {
    renderLoaded({ verified: true, linkedAt: '2026-10-30T03:00:00.000Z' });
    const row = await screen.findByRole('group', { name: 'LINE น้องเบส (การเงิน)' });
    expect(within(row).getByText('ลูกค้ายืนยันเบอร์ด้วย OTP แล้ว')).toBeInTheDocument();
    expect(row).toHaveTextContent('ผูกเมื่อ 30/10/2569');
    expect(within(row).getByRole('button', { name: 'ยกเลิกการผูก' })).toBeInTheDocument();
    expect(screen.queryByLabelText(/LINE ID \(น้องเบส/)).not.toBeInTheDocument();
    expect(screen.getByLabelText('LINE ID (Shop / ร้าน)')).toHaveValue('U-shop');
  });

  it('ยังไม่ผูก → ข้อความวิธีผูกเอง · ไม่มีสิทธิ์ = ไม่มีปุ่ม', async () => {
    renderLoaded({ verified: false, linkedAt: null }, false);
    const row = await screen.findByRole('group', { name: 'LINE น้องเบส (การเงิน)' });
    expect(within(row).getByText('ยังไม่ได้ผูก LINE')).toBeInTheDocument();
    expect(within(row).queryByRole('button')).not.toBeInTheDocument();
  });

  it('ยืนยันยกเลิกการผูก → POST unlink ทันที ไม่ PATCH ฟอร์ม', async () => {
    renderLoaded({ verified: true, linkedAt: '2026-10-30T03:00:00.000Z' });
    const row = await screen.findByRole('group', { name: 'LINE น้องเบส (การเงิน)' });
    fireEvent.click(within(row).getByRole('button', { name: 'ยกเลิกการผูก' }));
    const confirm = await screen.findByRole('alertdialog', { name: 'ยกเลิกการผูก LINE น้องเบส?' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'ยกเลิกการผูก' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/customers/c1/finance-line/unlink'));
    await waitFor(() => expect(within(row).getByText('ยังไม่ได้ผูก LINE')).toBeInTheDocument());
    expect(api.patch).not.toHaveBeenCalled();
  });

  it('บันทึก → payload ไม่มี lineIdFinance (คอลัมน์มีค่าก็ตาม) — บันทึกฟอร์มยกเลิกผูกไม่ได้', async () => {
    renderLoaded({ verified: true, linkedAt: '2026-10-30T03:00:00.000Z' });
    await screen.findByRole('group', { name: 'LINE น้องเบส (การเงิน)' });
    fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(1));
    const payload = vi.mocked(api.patch).mock.calls[0][1] as Record<string, unknown>;
    expect(payload).not.toHaveProperty('lineIdFinance');
    expect(payload.lineIdShop).toBe('U-shop');
  });
});
