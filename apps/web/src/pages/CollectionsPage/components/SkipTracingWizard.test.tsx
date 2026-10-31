import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { toast } from 'sonner';
import api from '@/lib/api';
import SkipTracingWizard from './SkipTracingWizard';

vi.mock('@/lib/api', async (original) => ({
  ...(await original<typeof import('@/lib/api')>()),
  default: { get: vi.fn(), post: vi.fn() },
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const contract = {
  id: 'k1',
  contractNumber: 'CT-2569-0042',
  customer: {
    id: 'c1',
    name: 'สมชาย ใจดี',
    phone: '0812345678',
    lineIdFinance: null,
    lineIdShop: null,
  },
};

async function openStep2() {
  const user = userEvent.setup();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <SkipTracingWizard open onClose={vi.fn()} contract={contract} />
    </QueryClientProvider>,
  );
  await user.click(screen.getByRole('button', { name: /ถัดไป/ }));
  return user;
}

/**
 * Task 27 — ตามหนี้ › ขั้น "ลองช่องทางใหม่": ตัดช่อง "LINE ID ใหม่ (ถ้ามี)" (API ปฏิเสธทั้งคำขอเมื่อมี LINE ID ⇒ เบอร์ใหม่ที่กรอกพร้อมกัน
 * ไม่ถูกบันทึก) · บันทึกได้ด้วยเบอร์ + เหตุผล · หมายเหตุชวนลูกค้าผูกเองทาง OTP ตาม mockup SkipTracing
 */
describe('SkipTracingWizard ขั้น 2 — ไม่มีช่อง LINE ID', () => {
  beforeEach(() => {
    vi.mocked(api.get)
      .mockReset()
      .mockResolvedValue({ data: { references: [] } });
    vi.mocked(api.post)
      .mockReset()
      .mockResolvedValue({
        data: { id: 'c1', phone: '0898765432', lineIdFinance: null, status: 'ACTIVE' },
      });
    vi.mocked(toast.success).mockReset();
  });

  it('ไม่มีช่อง LINE ID ใหม่ · ข้อความนำ + หมายเหตุตาม mockup', async () => {
    await openStep2();
    expect(screen.queryByLabelText(/LINE ID/)).not.toBeInTheDocument();
    expect(
      screen.getByText('ถ้ามีเบอร์ใหม่จากญาติหรือที่ทำงาน กรอกแล้วบันทึกได้เลย'),
    ).toBeInTheDocument();
    expect(screen.getByRole('note')).toHaveTextContent(
      'ได้ LINE ใหม่มา? ทักลูกค้าทาง LINE นั้นแล้วชวนให้ส่งข้อความในแชท LINE น้องเบส และกด “เริ่มยืนยันตัวตน” ระบบจะผูกให้เองหลังยืนยัน OTP',
    );
  });

  it('ปุ่มบันทึกเปิดเมื่อมีเบอร์ (ถูกรูปแบบ) + เหตุผล · ส่งแค่เบอร์ + เหตุผล ไม่มี newLineId', async () => {
    const user = await openStep2();
    const save = screen.getByRole('button', { name: 'บันทึก' });
    expect(save).toBeDisabled();
    await user.type(screen.getByLabelText('เหตุผล (จำเป็น)'), 'พี่สาวให้เบอร์ใหม่');
    expect(save).toBeDisabled();
    await user.type(screen.getByLabelText('เบอร์ใหม่'), '0898765432');
    expect(save).toBeEnabled();
    await user.click(save);

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/customers/c1/update-contact', {
        newPhone: '0898765432',
        reason: 'พี่สาวให้เบอร์ใหม่',
      }),
    );
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('อัปเดตข้อมูลติดต่อแล้ว'));
  });
});
