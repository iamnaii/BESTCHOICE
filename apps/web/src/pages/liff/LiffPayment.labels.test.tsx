import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import type { LiffPaymentLinkData } from '@installment/shared';
import LiffPayment from './LiffPayment';

/**
 * Task 42 (คำตัดสินเจ้าของ #44 — mockup ที่เจ้าของเคาะ) — หน้า `/pay/:token` เลิกเดาหัวยอดจากยอด (เดิม: ยอด > ค่างวดที่ผูก + ค่าปรับ + 0.5
 * ⇒ "ยอดปิดสัญญา" — ลิงก์แจ้งล็อก 2,231.66 / แถวเก่าขึ้นยอดปิดสัญญาทั้งที่ไม่ใช่) · หัวยอดมาจาก server (`amountKind`) ·
 * การ์ด "รายละเอียด": ลิงก์งวด / ปิดยอด เหมือนเดิม · ลิงก์แจ้งล็อก / ยอดนัด แสดง "นำไปชำระ (งวดเก่าก่อน)" จาก `allocation` ของ server
 */
const { get, post } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));

vi.mock('@/hooks/useLiffInit', () => ({
  useLiffInit: () => ({ lineId: 'U-test', profile: null, loading: false, error: null }),
}));
vi.mock('@/lib/api', () => ({ liffApi: { get, post } }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const TOKEN = 'a'.repeat(64);

function linkData(fields: Partial<LiffPaymentLinkData>): LiffPaymentLinkData {
  return {
    valid: true,
    token: TOKEN,
    amount: 1615.83,
    status: 'ACTIVE',
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    purpose: 'INSTALLMENT',
    amountKind: 'DUE',
    promiseDate: null,
    allocation: null,
    contract: { id: 'ct-1', contractNumber: 'BC-TEST-001', customer: { name: 'ส***' } },
    // งวดที่ผูก (งวดค้างแรก) — เวลาเที่ยงวันไทย ⇒ วันเดียวกันทั้ง TZ ไทยและ UTC
    payment: { installmentNo: 2, amountDue: 1515.83, lateFee: 100, dueDate: '2026-10-01T05:00:00.000Z' },
    ...fields,
  };
}

async function renderPage(data: LiffPaymentLinkData) {
  get.mockResolvedValue({ data });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/pay/${TOKEN}`]}>
        <Routes>
          <Route path="/pay/:token" element={<LiffPayment />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await screen.findByRole('button', { name: /สแกนจ่าย/ });
}

/** หัวยอด (ป้ายเล็กเหนือยอด) */
const heroLabel = () => screen.getByTestId('pay-amount-label').textContent;
/** การ์ด "รายละเอียด" — แถว [ป้าย, ค่า] ตามลำดับ (ไม่รวมเส้นคั่น / บรรทัดหัวข้อย่อย) */
function detailRows(): [string, string][] {
  const card = screen.getByTestId('pay-details');
  return within(card)
    .getAllByTestId('pay-row')
    .map((row) => {
      const [label, value] = Array.from(row.children);
      return [label.textContent ?? '', value.textContent ?? ''];
    });
}

beforeEach(() => {
  get.mockReset();
  post.mockReset();
});

describe('หน้า /pay/:token — หัวยอดและการ์ดรายละเอียดตามชนิดลิงก์ (ไม่เดาจากยอด)', () => {
  it('ลิงก์งวด → "ยอดที่ต้องชำระ" · ลูกค้า · สัญญา · งวดที่ · ครบกำหนด (เหมือนเดิม)', async () => {
    await renderPage(linkData({}));

    expect(heroLabel()).toBe('ยอดที่ต้องชำระ');
    expect(detailRows()).toEqual([
      ['ลูกค้า', 'ส***'],
      ['สัญญา', 'BC-TEST-001'],
      ['งวดที่', '2'],
      ['ครบกำหนด', '01/10/2569'],
    ]);
    expect(screen.queryByText('นำไปชำระ (งวดเก่าก่อน)')).not.toBeInTheDocument();
  });

  it('ลิงก์ปิดยอด → "ยอดปิดสัญญา" · ลูกค้า · สัญญา (เหมือนเดิม)', async () => {
    await renderPage(linkData({ amount: 15189.98, purpose: 'PAYOFF', amountKind: 'PAYOFF' }));

    expect(heroLabel()).toBe('ยอดปิดสัญญา');
    expect(detailRows()).toEqual([
      ['ลูกค้า', 'ส***'],
      ['สัญญา', 'BC-TEST-001'],
    ]);
  });

  it('ลิงก์แจ้งล็อก → "ยอดค้างชำระ" · ลูกค้า · สัญญา · เส้นคั่น · "นำไปชำระ (งวดเก่าก่อน)" · แถวค่างวด/ค่าปรับต่องวด (mockup)', async () => {
    await renderPage(
      linkData({
        amount: 2231.66,
        purpose: 'AMOUNT',
        amountKind: 'OUTSTANDING',
        allocation: [
          { kind: 'INSTALLMENT_REMAINING', installmentNo: 2, amount: 615.83 },
          { kind: 'LATE_FEE', installmentNo: 2, amount: 100 },
          { kind: 'INSTALLMENT', installmentNo: 3, amount: 1515.83 },
        ],
      }),
    );

    expect(heroLabel()).toBe('ยอดค้างชำระ');
    expect(detailRows()).toEqual([
      ['ลูกค้า', 'ส***'],
      ['สัญญา', 'BC-TEST-001'],
      ['งวดที่ 2 · ค่างวดคงเหลือ', '615.83'],
      ['งวดที่ 2 · ค่าปรับล่าช้า', '100.00'],
      ['งวดที่ 3 · ค่างวด', '1,515.83'],
    ]);
    const card = screen.getByTestId('pay-details');
    expect(within(card).getByTestId('pay-allocation-divider')).toBeInTheDocument();
    expect(within(card).getByText('นำไปชำระ (งวดเก่าก่อน)')).toBeInTheDocument();
    // ยอดของแถวเป็นตัวเลขตาราง (mono · tabular)
    const amount = within(card).getByText('1,515.83');
    expect(amount.className).toContain('font-mono');
    expect(amount.className).toContain('tabular-nums');
    expect(screen.queryByText('วันนัด')).not.toBeInTheDocument();
  });

  it('ลิงก์ยอดนัด → "ยอดนัดชำระ" · วันนัด "ภายใน …" · ชำระบางส่วน + แถวจาง "ยังค้างหลังชำระ" (mockup)', async () => {
    await renderPage(
      linkData({
        amount: 1000,
        purpose: 'AMOUNT',
        amountKind: 'PROMISE',
        // วันนัด 5 พ.ย. 2569 (เที่ยงวันไทย)
        promiseDate: '2026-11-05T05:00:00.000Z',
        allocation: [
          { kind: 'PARTIAL', installmentNo: 2, amount: 1000 },
          { kind: 'LEFT_AFTER', installmentNo: 2, amount: 615.83 },
        ],
      }),
    );

    expect(heroLabel()).toBe('ยอดนัดชำระ');
    expect(detailRows()).toEqual([
      ['ลูกค้า', 'ส***'],
      ['สัญญา', 'BC-TEST-001'],
      ['วันนัด', 'ภายใน 05/11/2569'],
      ['งวดที่ 2 · ชำระบางส่วน', '1,000.00'],
      ['งวดที่ 2 ยังค้างหลังชำระ', '615.83'],
    ]);
    // แถว "ยังค้างหลังชำระ" จาง (ไม่ใช่สีตัวอักษรหลัก) · แถวชำระบางส่วนเป็นสีตัวอักษรหลัก
    const left = within(screen.getByTestId('pay-details')).getByText('615.83');
    expect(left.classList.contains('text-muted-foreground')).toBe(true);
    expect(left.classList.contains('text-foreground')).toBe(false);
    const partial = within(screen.getByTestId('pay-details')).getByText('1,000.00');
    expect(partial.classList.contains('text-foreground')).toBe(true);
  });

  it('ลิงก์ยอดอื่น (AMOUNT ที่ไม่รู้กฎ) → "ยอดที่ต้องชำระ"', async () => {
    await renderPage(
      linkData({
        amount: 1615.83,
        purpose: 'AMOUNT',
        amountKind: 'DUE',
        allocation: [{ kind: 'INSTALLMENT', installmentNo: 2, amount: 1615.83 }],
      }),
    );

    expect(heroLabel()).toBe('ยอดที่ต้องชำระ');
  });

  it('แถวเก่าที่ไม่มี purpose ยอดเกินค่างวดที่ผูก → "ยอดที่ต้องชำระ" ไม่ใช่ "ยอดปิดสัญญา" · ไม่แสดงงวดที่ผูก', async () => {
    await renderPage(linkData({ amount: 15189.98, purpose: null, amountKind: 'DUE' }));

    expect(heroLabel()).toBe('ยอดที่ต้องชำระ');
    expect(screen.queryByText('ยอดปิดสัญญา')).not.toBeInTheDocument();
    expect(detailRows()).toEqual([
      ['ลูกค้า', 'ส***'],
      ['สัญญา', 'BC-TEST-001'],
    ]);
  });
});
