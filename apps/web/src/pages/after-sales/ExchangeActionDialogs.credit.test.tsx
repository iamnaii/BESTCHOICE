import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConfirmExchangeDialog } from './ExchangeActionDialogs';
import type { CaseDetail } from './after-sales';

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@/lib/api', () => ({
  default: { get: mocks.get, post: mocks.post },
  getErrorMessage: (error: Error) => error.message,
}));
vi.mock('./ReplacementProductPicker', () => ({ default: () => <div>picker</div> }));

const baseCase = {
  id: 'case-1',
  outcome: 'SAME_MODEL_EXCHANGE',
  stage: 'AWAITING_APPROVAL',
  contractId: 'ct-old',
  saleId: null,
  replacementProductId: 'p-new',
  replacementContractId: null,
  contract: { id: 'ct-old', contractNumber: 'CT-2569-0412', status: 'ACTIVE' },
} as unknown as CaseDetail;

function renderDialog(data: CaseDetail) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ConfirmExchangeDialog caseId="case-1" open onOpenChange={() => undefined} data={data} />
    </QueryClientProvider>,
  );
}

beforeEach(() => vi.clearAllMocks());

describe('ConfirmExchangeDialog — ใบเสร็จที่จะออกใบลดหนี้ + เครดิต (15ข · mockup กระดาน 3)', () => {
  it('มีใบรับเงิน: ตารางใบเสร็จ · ยอดเครดิตที่จะย้าย · bullet ใบลดหนี้/ไม่คืนเงินสด/ใช้เครดิตตอนเปิดใช้', async () => {
    mocks.get.mockResolvedValue({
      data: {
        receiptsToCreditNote: [
          { id: 'rc-1', receiptNumber: 'RT-202610-00031', receiptType: 'INSTALLMENT', installmentNo: 1, paidDate: '2026-10-10T03:00:00.000Z', paymentMethod: 'BANK_TRANSFER', amount: '1515.83', vatAmount: '99.17' },
        ],
        creditToTransfer: '1515.83',
      },
    });
    renderDialog(baseCase);
    expect(await screen.findByText('RT-202610-00031')).toBeInTheDocument();
    expect(mocks.get).toHaveBeenCalledWith('/defect-exchange/eligibility/ct-old');
    expect(screen.getByText(/ใบเสร็จของสัญญาเดิมที่จะออกใบลดหนี้/)).toBeInTheDocument();
    expect(screen.getByText(/ค่างวดงวดที่ 1/)).toBeInTheDocument();
    expect(screen.getByText(/เครดิตที่จะย้ายไปสัญญาใหม่ \(ไม่คืนเงินสด\)/)).toBeInTheDocument();
    expect(screen.getAllByText(/1,515\.83/).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/ออกใบลดหนี้ให้ใบเสร็จ\/ใบกำกับภาษีของสัญญาเดิมทุกใบ — ไม่ส่ง LINE/)).toBeInTheDocument();
    expect(screen.getByText(/เงินที่ลูกค้าจ่ายแล้วย้ายเป็นเครดิตของสัญญาใหม่ — ไม่คืนเงินสด ธนาคารไม่ขยับ/)).toBeInTheDocument();
    expect(screen.getByText(/เมื่อเปิดใช้ ระบบใช้เครดิตชำระงวดที่ 1 ทันทีและออกใบเสร็จ\/ใบกำกับภาษีใหม่/)).toBeInTheDocument();
  });

  it('ไม่มีใบ ไม่มีเงินค้าง: กล่องเหมือนวันนี้ (ไม่มีตาราง ไม่มี bullet ใบลดหนี้)', async () => {
    mocks.get.mockResolvedValue({ data: { receiptsToCreditNote: [], creditToTransfer: '0.00' } });
    renderDialog(baseCase);
    expect(await screen.findByText(/สัญญาเดิมปิดเป็น/)).toBeInTheDocument();
    expect(screen.queryByText(/ใบเสร็จของสัญญาเดิมที่จะออกใบลดหนี้/)).toBeNull();
    expect(screen.queryByText(/ไม่ส่ง LINE/)).toBeNull();
    expect(screen.getByText(/ต้องเปิดใช้ที่หน้าสัญญาก่อนส่งมอบ/)).toBeInTheDocument();
  });

  it('เคสขายสด: ไม่เรียก eligibility ของสัญญาผ่อน', async () => {
    mocks.get.mockResolvedValue({ data: { saleNumber: 'S-1', oldCost: '1', newCost: '1', lines: [] } });
    // isCashCase() ตัดสินจาก source (ไม่ใช่ outcome) — `after-sales.ts`
    renderDialog({ ...baseCase, source: 'CASH_SALE', outcome: 'CASH_SAME_MODEL_EXCHANGE', contractId: null, saleId: 'sale-1' } as unknown as CaseDetail);
    await screen.findAllByText(/สลับเครื่องบนใบขายเดิม/); // อยู่ทั้งใน DialogDescription และ bullet
    expect(mocks.get.mock.calls.some((c) => String(c[0]).startsWith('/defect-exchange/eligibility'))).toBe(false);
  });
});
