import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import type { LiffPaymentLinkData, LiffPaymentLinkPurpose } from '@installment/shared';
import LiffPayment from './LiffPayment';

/**
 * Task 39 — หน้า `/pay/:token` ตัดสินจาก**ข้อมูลของลิงก์** (`purpose` จาก `GET /line-oa/pay/:token`) ว่าจะส่งเลขงวดหรือไม่
 * (เดิมเดาจากยอด: ยอด > ค่างวดที่ผูก + ค่าปรับ + 0.5 = หลายงวด ⇒ ลิงก์ยอดนัด 1,000 / ยอดค้างรวมแจ้งล็อก 1,615.83 ส่งเลขงวด
 * แล้ว intent ปฏิเสธ "ยอดชำระไม่ตรง")
 * - `INSTALLMENT` → ส่ง `installmentNo` ของงวดที่ผูก (เหมือนเดิมทุกตัวอักษร) ไม่ส่ง token
 * - `AMOUNT` / `PAYOFF` / ไม่มีค่า (แถวเก่า) → ไม่ส่ง `installmentNo` · ส่ง `paymentLinkToken` ให้ server ใช้ยอดของลิงก์เอง
 */
const { get, post } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));

vi.mock('@/hooks/useLiffInit', () => ({
  useLiffInit: () => ({ lineId: 'U-test', profile: null, loading: false, error: null }),
}));
vi.mock('@/lib/api', () => ({ liffApi: { get, post } }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const TOKEN = 'a'.repeat(64);

/** ลิงก์ของสัญญาที่งวด 1 = ค่างวด 1,515.83 + ค่าปรับ 100 */
function linkData(amount: number, purpose: LiffPaymentLinkPurpose | null): LiffPaymentLinkData {
  return {
    valid: true,
    token: TOKEN,
    amount,
    status: 'ACTIVE',
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    purpose,
    // Task 42 — หัวยอด/วันนัด/แถวนำไปชำระ ไม่เกี่ยวกับสิ่งที่ส่งไปสร้างรายการ
    amountKind: purpose === 'PAYOFF' ? 'PAYOFF' : 'DUE',
    promiseDate: null,
    allocation: null,
    contract: { id: 'ct-1', contractNumber: 'BC-TEST-001', customer: { name: 'ส***' } },
    payment: { installmentNo: 1, amountDue: 1515.83, lateFee: 100, dueDate: '2026-10-01' },
  };
}

async function payAndCaptureBody(data: LiffPaymentLinkData) {
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
  fireEvent.click(await screen.findByRole('button', { name: /สแกนจ่าย/ }));
  await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
  const [url, body] = post.mock.calls[0];
  expect(url).toBe('/paysolutions/create-intent');
  // สิ่งที่ออกไปบนสาย (JSON — คีย์ที่ค่าเป็น undefined ไม่ถูกส่ง)
  return JSON.parse(JSON.stringify(body)) as Record<string, unknown>;
}

beforeEach(() => {
  get.mockReset();
  post
    .mockReset()
    // ไม่มี paymentUrl ⇒ หน้าไม่ redirect (jsdom ไม่รองรับ navigation)
    .mockResolvedValue({ data: { success: true, paymentId: 'p', paymentUrl: '', gatewayRef: 'g' } });
});

describe('หน้า /pay/:token — ส่งเลขงวดเฉพาะลิงก์ผูกงวด (ตัดสินจากข้อมูลของลิงก์)', () => {
  it('ลิงก์ INSTALLMENT (ไม่รับสาย — ยอดคงค้างของงวด 1,615.83) → ส่งเลขงวดที่ผูก · ไม่ส่ง token (เหมือนเดิม)', async () => {
    const body = await payAndCaptureBody(linkData(1615.83, 'INSTALLMENT'));

    expect(body).toEqual({
      contractId: 'ct-1',
      amount: 1615.83,
      description: 'ชำระค่างวด สัญญา BC-TEST-001',
      lineId: 'U-test',
      installmentNo: 1,
    });
    expect(Object.keys(body)).toEqual(['contractId', 'amount', 'description', 'lineId', 'installmentNo']);
  });

  it('ลิงก์ยอดนัด 1,000 (AMOUNT · บางส่วน) → ไม่ส่งเลขงวด · ส่ง token ของลิงก์', async () => {
    const body = await payAndCaptureBody(linkData(1000, 'AMOUNT'));

    expect(body).not.toHaveProperty('installmentNo');
    expect(body).toMatchObject({ contractId: 'ct-1', amount: 1000, paymentLinkToken: TOKEN });
  });

  it('ลิงก์แจ้งล็อก ยอดค้างรวม 1,615.83 (AMOUNT · ค่าปรับงวด 1 + งวด 2) — ยอดเท่าค่างวด + ค่าปรับพอดี ก็ไม่ส่งเลขงวด', async () => {
    const body = await payAndCaptureBody(linkData(1615.83, 'AMOUNT'));

    expect(body).not.toHaveProperty('installmentNo');
    expect(body).toMatchObject({ amount: 1615.83, paymentLinkToken: TOKEN });
  });

  it('ลิงก์ปิดยอด (PAYOFF) → ไม่ส่งเลขงวด · ส่ง token ให้ server ตรวจยอดกับลิงก์', async () => {
    const body = await payAndCaptureBody(linkData(15189.98, 'PAYOFF'));

    expect(body).not.toHaveProperty('installmentNo');
    expect(body).toMatchObject({ amount: 15189.98, paymentLinkToken: TOKEN });
  });

  it('แถวเก่าที่ไม่มี purpose (null) → ไม่ส่งเลขงวด (ไม่เดาจากยอด) · ส่ง token ให้ server ตัดสิน', async () => {
    const body = await payAndCaptureBody(linkData(1615.83, null));

    expect(body).not.toHaveProperty('installmentNo');
    expect(body).toMatchObject({ amount: 1615.83, paymentLinkToken: TOKEN });
  });
});
