import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { toast } from 'sonner';
import api from '@/lib/api';
import EditCustomerDialog from '../components/EditCustomerDialog';
import { detail } from './fixtures';
import type { CustomerDetail } from '../types';

vi.mock('@/lib/api', async (original) => ({
  ...(await original<typeof import('@/lib/api')>()),
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const LINKED = { verified: true, linkedAt: '2026-10-30T03:00:00.000Z' };
const NOT_LINKED = { verified: false, linkedAt: null };

function renderDialog(over: Partial<CustomerDetail> = {}, canUnlinkFinanceLine = true) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <EditCustomerDialog
        customer={detail(over)}
        open
        onClose={vi.fn()}
        canUnlinkFinanceLine={canUnlinkFinanceLine}
      />
    </QueryClientProvider>,
  );
}

const financeRow = () => screen.getByRole('group', { name: 'LINE น้องเบส (การเงิน)' });

/**
 * Task 27 — หน้าลูกค้า › แก้ไข: ช่อง LINE การเงินเป็นแถวสถานะ (ไม่มีช่องพิมพ์) · ปุ่ม "ยกเลิกการผูก" ยกเลิกทันทีหลังยืนยัน ·
 * บันทึกฟอร์มไม่ส่ง lineIdFinance (จึงยกเลิกผูก/ตั้งค่าไม่ได้ทางฟอร์ม)
 */
describe('EditCustomerDialog — LINE น้องเบส (การเงิน)', () => {
  beforeEach(() => {
    vi.mocked(api.post).mockReset().mockResolvedValue({ data: {} });
    vi.mocked(api.patch).mockReset().mockResolvedValue({ data: {} });
    vi.mocked(toast.success).mockReset();
  });

  it('ผูกแล้ว → ไอคอน + ข้อความ + วันที่ผูก + ปุ่มยกเลิกการผูก · ไม่มีช่องพิมพ์ LINE การเงิน', () => {
    renderDialog({ financeLine: LINKED, lineIdFinance: null });
    const row = financeRow();
    expect(within(row).getByText('ลูกค้ายืนยันเบอร์ด้วย OTP แล้ว')).toBeInTheDocument();
    expect(row).toHaveTextContent(
      'ผูกเมื่อ 30/10/2569 · แจ้งเตือนค่างวด ใบเสร็จ และลิงก์จ่ายเงินส่งไปที่ LINE นี้',
    );
    expect(within(row).getByRole('button', { name: 'ยกเลิกการผูก' })).toBeInTheDocument();
    expect(screen.queryByLabelText(/LINE ID \(Finance/)).not.toBeInTheDocument();
    expect(screen.getByLabelText('LINE ID (Shop / ร้าน)')).toBeEnabled();
  });

  it('ยังไม่ผูก (คอลัมน์ค้างค่าไว้ก็ตาม) → ข้อความวิธีผูกเอง ไม่มีปุ่ม', () => {
    renderDialog({ financeLine: NOT_LINKED, lineIdFinance: 'U-typed-by-staff' });
    const row = financeRow();
    expect(within(row).getByText('ยังไม่ได้ผูก LINE')).toBeInTheDocument();
    expect(row).toHaveTextContent(
      'ลูกค้าต้องผูกเอง: ส่งข้อความใดก็ได้ในแชท LINE น้องเบส แล้วกดปุ่ม “เริ่มยืนยันตัวตน” กรอกเบอร์และรหัส OTP ทาง SMS ผูกเสร็จแล้วสถานะที่นี่จะเปลี่ยนเอง',
    );
    expect(within(row).queryByRole('button')).not.toBeInTheDocument();
    expect(row).not.toHaveTextContent('U-typed-by-staff');
  });

  it('ไม่มีสิทธิ์ยกเลิกผูก → ซ่อนปุ่ม (สถานะยังแสดง)', () => {
    renderDialog({ financeLine: LINKED }, false);
    expect(within(financeRow()).getByText('ลูกค้ายืนยันเบอร์ด้วย OTP แล้ว')).toBeInTheDocument();
    expect(within(financeRow()).queryByRole('button')).not.toBeInTheDocument();
  });

  it('กดยกเลิกการผูก → หน้าต่างยืนยัน · "ไม่ยกเลิก" ไม่เรียก API · ยืนยัน → ยกเลิกทันที + toast + แถวเป็นยังไม่ผูก (ไม่ต้องบันทึกฟอร์ม)', async () => {
    const user = userEvent.setup();
    renderDialog({ financeLine: LINKED });

    await user.click(within(financeRow()).getByRole('button', { name: 'ยกเลิกการผูก' }));
    let confirm = await screen.findByRole('alertdialog', { name: 'ยกเลิกการผูก LINE น้องเบส?' });
    expect(confirm).toHaveTextContent(
      'ลูกค้าจะไม่ได้รับแจ้งเตือนค่างวด ใบเสร็จ และลิงก์จ่ายเงินทาง LINE จนกว่าจะยืนยันตัวตนด้วย OTP ใหม่',
    );
    expect(confirm).toHaveTextContent(
      'ใช้เมื่อลูกค้าเปลี่ยนเครื่อง หรือแจ้งว่า LINE นี้ไม่ใช่ของเขา',
    );
    await user.click(within(confirm).getByRole('button', { name: 'ไม่ยกเลิก' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(api.post).not.toHaveBeenCalled();

    await user.click(within(financeRow()).getByRole('button', { name: 'ยกเลิกการผูก' }));
    confirm = await screen.findByRole('alertdialog', { name: 'ยกเลิกการผูก LINE น้องเบส?' });
    await user.click(within(confirm).getByRole('button', { name: 'ยกเลิกการผูก' }));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/customers/c1/finance-line/unlink'));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('ยกเลิกการผูก LINE แล้ว'));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(within(financeRow()).getByText('ยังไม่ได้ผูก LINE')).toBeInTheDocument();
    expect(api.patch).not.toHaveBeenCalled();
  });

  it('บันทึกฟอร์ม → payload ไม่มี lineIdFinance แม้คอลัมน์มีค่า · LINE ร้านยังส่งตามที่แก้', async () => {
    const user = userEvent.setup();
    renderDialog({ financeLine: LINKED, lineIdFinance: 'U-verified', lineIdShop: null });
    await user.type(screen.getByLabelText('LINE ID (Shop / ร้าน)'), 'U-shop');
    await user.click(screen.getByRole('button', { name: 'บันทึก' }));

    await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(1));
    const [url, payload] = vi.mocked(api.patch).mock.calls[0] as [string, Record<string, unknown>];
    expect(url).toBe('/customers/c1');
    expect(payload).not.toHaveProperty('lineIdFinance');
    expect(payload.lineIdShop).toBe('U-shop');
  });
});
