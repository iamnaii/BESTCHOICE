import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  ContractEarlyPayoffQuote,
  EarlyPayoffOverlay,
  type EarlyPayoffQuote,
} from '../ContractEarlyPayoff';

/**
 * PR5ข (เจ้าของเคาะ 01/10/2569): ยอดปิดหักเงินที่ลูกค้าชำระเกินจากงวดก่อน (ถังรวม) แบบเดียวกับค่าปรับดิวที่พักไว้ —
 * หน้าปิดยอดแสดงเป็นแถวของตัวเอง ใต้ "ยอดชำระล่วงหน้า" เหนือ "คงเหลือยอดค้าง" (หักก่อนคิดฐานส่วนลด)
 */

const apiGet = vi.fn();
vi.mock('@/lib/api', () => ({
  default: {
    get: (...a: unknown[]) => apiGet(...a),
    post: vi.fn(),
  },
  getErrorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'u-bm', name: 'ผจก.ลพบุรี', role: 'BRANCH_MANAGER', branchId: 'b1' },
    isLoading: false,
    isAuthenticated: true,
  }),
}));
vi.mock('@/components/payment/PaymentApprovalRequestDialog', () => ({
  default: () => null,
}));

/** ตัวอย่างที่เจ้าของเคาะ: 17,000/12 ยังไม่จ่าย · เครดิต 300 + ถังรวม 500 · ส่วนลด 50% (computePayoffQuote) */
const QUOTE: EarlyPayoffQuote = {
  monthlyPayment: 1515.83,
  remainingMonths: 12,
  totalRemaining: 18189.96,
  advancePayment: 300,
  rescheduleAdvanceApplied: 0,
  advanceBalanceApplied: 500,
  remainingBalance: 17389.96,
  remainingExVat: 16252.3,
  remainingCost: 10697.64,
  grossProfit: 5554.66,
  discountPct: 50,
  discountAmount: 2777.33,
  unpaidLateFees: 0,
  totalPayoff: 14612.63,
};

const renderWith = (quote: EarlyPayoffQuote) => {
  apiGet.mockImplementation((url: string) =>
    url.includes('/early-payoff-quote')
      ? Promise.resolve({ data: quote })
      : Promise.reject(new Error(`unexpected GET ${url}`)),
  );
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <EarlyPayoffOverlay
        contractId="ct-1"
        contractNumber="TEST-20261001-001"
        customerName="ทดสอบ ถังรวม"
        branchName="ลพบุรี"
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('EarlyPayoffOverlay — หักเงินที่ชำระเกินจากงวดก่อน (PR5ข)', () => {
  it('ตัวอย่างที่เจ้าของเคาะ: แถว "หักเงินที่ชำระเกินจากงวดก่อน" −500 ใต้ยอดชำระล่วงหน้า เหนือคงเหลือยอดค้าง · ยอดชำระปิดยอด 14,612.63', async () => {
    renderWith(QUOTE);
    await screen.findByText('14,612.63 บาท', { selector: 'span' });
    const advanceRow = screen.getByText('หักเงินที่ชำระเกินจากงวดก่อน');
    expect(advanceRow.parentElement).toHaveTextContent('-500 บาท');
    expect(screen.getByText('ยอดชำระล่วงหน้า').parentElement).toHaveTextContent('-300 บาท');
    expect(
      screen.getByText('ยอดชำระล่วงหน้า').compareDocumentPosition(advanceRow) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      advanceRow.compareDocumentPosition(screen.getByText('คงเหลือยอดค้าง')) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.queryByText('หักค่าปรับดิวที่จ่ายล่วงหน้าไว้')).not.toBeInTheDocument();
    expect(screen.getByText('คงเหลือยอดค้าง').parentElement).toHaveTextContent('17,389.96 บาท');
    expect(screen.getByText('ต้นทุนยอดค้างชำระ (2)').parentElement).toHaveTextContent(
      '10,697.64 บาท',
    );
    expect(screen.getByText('ส่วนลดลูกค้า 50%').parentElement).toHaveTextContent('-2,777.33 บาท');
  });

  it('ไม่มีเงินที่ชำระเกิน (0) → ไม่มีแถว', async () => {
    renderWith({ ...QUOTE, advanceBalanceApplied: 0 });
    await screen.findByText('14,612.63 บาท', { selector: 'span' });
    expect(screen.queryByText('หักเงินที่ชำระเกินจากงวดก่อน')).not.toBeInTheDocument();
  });

  it('API ก่อน PR5ข (ไม่มี advanceBalanceApplied) → ไม่มีแถว', async () => {
    const legacy: EarlyPayoffQuote = { ...QUOTE };
    delete legacy.advanceBalanceApplied;
    renderWith(legacy);
    await screen.findByText('14,612.63 บาท', { selector: 'span' });
    expect(screen.queryByText('หักเงินที่ชำระเกินจากงวดก่อน')).not.toBeInTheDocument();
  });
});

/** ฝ่ายบัญชี 16/10/2569 ข้อ 18.1 แบบ (ค): ส่วนลดเฉพาะงวดที่ยังไม่ถึงกำหนด — สัญญา 3,671 × 12 ถึงกำหนดแล้ว 4 งวด */
const dueCase: EarlyPayoffQuote = {
  monthlyPayment: 3671,
  remainingMonths: 12,
  totalRemaining: 44052,
  advancePayment: 0,
  rescheduleAdvanceApplied: 0,
  advanceBalanceApplied: 0,
  remainingBalance: 44052,
  remainingExVat: 41170.09,
  remainingCost: 19690,
  grossProfit: 21480.09,
  notDueMonths: 8,
  dueMonths: 4,
  discountableMonths: 8,
  discountBase: 14320.06,
  discountPct: 50,
  discountAmount: 7160.03,
  unpaidLateFees: 100,
  totalPayoff: 36991.97,
};

describe('EarlyPayoffOverlay — ส่วนลดเฉพาะงวดที่ยังไม่ถึงกำหนด (ฝ่ายบัญชี 18.1 แบบ ค)', () => {
  it('มีงวดถึงกำหนดแล้ว → แถวฐานส่วนลด "กำไรของงวดที่ยังไม่ถึงกำหนด (8 จาก 12 งวด)" + ข้อความงวดที่ไม่ได้ส่วนลด · ยอดปิด 36,991.97', async () => {
    renderWith(dueCase);
    await screen.findByText('36,991.97 บาท', { selector: 'span' });
    expect(screen.getByText('กำไรของงวดที่ยังไม่ถึงกำหนด (8 จาก 12 งวด)')).toBeInTheDocument();
    expect(screen.getByText('14,320.06 บาท')).toBeInTheDocument();
    expect(screen.getByText('ส่วนลดลูกค้า 50% ของงวดที่ยังไม่ถึงกำหนด')).toBeInTheDocument();
    expect(screen.getByText(/งวดที่ถึงกำหนดแล้ว 4 งวด ไม่ได้ส่วนลด/)).toBeInTheDocument();
  });

  it('ไม่มีงวดถึงกำหนด (API ใหม่ dueMonths 0) หรือ API เก่าไม่ส่ง → หน้าจอเหมือนเดิม ไม่มีแถว/ข้อความเพิ่ม', async () => {
    renderWith({ ...QUOTE, notDueMonths: 12, dueMonths: 0, discountableMonths: 12, discountBase: 5554.66 });
    await screen.findByText('14,612.63 บาท', { selector: 'span' });
    expect(screen.queryByText(/กำไรของงวดที่ยังไม่ถึงกำหนด/)).not.toBeInTheDocument();
    expect(screen.queryByText(/ไม่ได้ส่วนลด/)).not.toBeInTheDocument();
    expect(screen.getByText('ส่วนลดลูกค้า 50%')).toBeInTheDocument();
  });
});

describe('ContractEarlyPayoffQuote — การ์ดสรุปไม่เขียน "ส่วนลด 50%" ตายตัว (ผู้ตรวจอิสระ M2)', () => {
  it('มีงวดถึงกำหนดแล้ว → "(ส่วนลด 50% ของงวดที่ยังไม่ถึงกำหนด)"', () => {
    render(<ContractEarlyPayoffQuote payoffQuote={dueCase} contractStatus="ACTIVE" />);
    expect(screen.getByText('ยอดปิดสัญญา (ส่วนลด 50% ของงวดที่ยังไม่ถึงกำหนด)')).toBeInTheDocument();
  });

  it('ไม่มีงวดถึงกำหนด → "(ส่วนลด 50%)" · quote เก่าไม่มี % → ไม่มีวงเล็บ', () => {
    const { unmount } = render(
      <ContractEarlyPayoffQuote payoffQuote={{ ...dueCase, dueMonths: 0, discountPct: 30 }} contractStatus="ACTIVE" />,
    );
    expect(screen.getByText('ยอดปิดสัญญา (ส่วนลด 30%)')).toBeInTheDocument();
    unmount();
    render(<ContractEarlyPayoffQuote payoffQuote={{ totalPayoff: 1, remainingMonths: 1 }} contractStatus="ACTIVE" />);
    expect(screen.getByText('ยอดปิดสัญญา')).toBeInTheDocument();
  });
});
