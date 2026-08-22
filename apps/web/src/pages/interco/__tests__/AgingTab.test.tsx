import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { AgingTab } from '../AgingTab';
import type { ShopReceivableAgingResponse, ShopReceivableAgingRow } from '../types';

/**
 * แท็บ "อายุลูกหนี้หน้าร้าน" (Phase 4 Task 2) — presentational component:
 * page ถือ useQuery แล้วส่ง data/isLoading/isError ลงมา (pattern เดียวกับ
 * PendingTab/BatchesTab) จึงเทสต์ได้ตรงๆ ไม่ต้อง mock react-query.
 *
 * จุดบังคับจาก review Task 1:
 *   - asOf มีผลกับ "อายุ" เท่านั้น — header ต้องสื่อ "ยอดคงเหลือปัจจุบัน"
 *   - legacyOneBook = สภาพปกติ (spec §11.4) → badge กลางๆ ไม่ใช่สีแดง และ
 *     ไม่ทับด้วย "สองสมุดไม่ตรง"/overdue แม้คณิตศาสตร์จะ mismatch จริง
 *   - bookMismatch (non-legacy) = ผิดปกติจริง → badge destructive
 */

function mkRow(overrides: Partial<ShopReceivableAgingRow> = {}): ShopReceivableAgingRow {
  return {
    contractId: 'c-1',
    contractNumber: 'CT-2026-0001',
    customerName: 'สมชาย ใจดี',
    swapCreditGross: '8000.00',
    payoutRecallGross: '0.00',
    settledDeduction: '0.00',
    intercoNet: '8000.00',
    shopCollect: '0.00',
    shopMirrorNet: '8000.00',
    intercoOldestPostedAt: '2026-08-01T00:00:00.000Z',
    intercoAgeDays: 20,
    shopCollectOldestPostedAt: null,
    shopCollectAgeDays: null,
    bookMismatch: false,
    legacySwapGross: '0.00',
    legacyOneBook: false,
    ...overrides,
  };
}

function mkData(
  rows: ShopReceivableAgingRow[],
  totalsOverrides: Partial<ShopReceivableAgingResponse['totals']> = {},
): ShopReceivableAgingResponse {
  return {
    rows,
    asOf: '2026-08-21T07:00:00.000Z',
    totals: {
      intercoNet: '8000.00',
      shopCollect: '0.00',
      overdueCount: 0,
      legacyOneBookNet: '0.00',
      ...totalsOverrides,
    },
  };
}

const baseProps = {
  thresholdDays: 30,
  isLoading: false,
  isError: false,
  error: null as unknown,
  onRetry: vi.fn(),
};

describe('AgingTab', () => {
  it('renders the type-split columns and one row with fmtMoney amounts', () => {
    render(
      <AgingTab
        {...baseProps}
        data={mkData([
          mkRow({
            payoutRecallGross: '11000.00',
            settledDeduction: '8000.00',
            intercoNet: '11000.00',
            shopMirrorNet: '11000.00',
          }),
        ])}
      />,
    );

    // Column headers per brief
    for (const col of [
      'เครดิตเปลี่ยนเครื่อง',
      'เรียกคืนจากยกเลิก',
      'หักไปแล้ว',
      'คงเหลือสุทธิ',
      'หน้าร้านรับแทน',
      'อายุ (วัน)',
      'สถานะ',
    ]) {
      expect(screen.getByText(col)).toBeInTheDocument();
    }

    expect(screen.getByText('CT-2026-0001')).toBeInTheDocument();
    expect(screen.getByText('สมชาย ใจดี')).toBeInTheDocument();
    // fmtMoney formatting (th-TH, 2dp): swap-credit cell plain, deduction
    // cell minus-prefixed, 11,000.00 in both recall-gross and net columns
    expect(screen.getByText('8,000.00')).toBeInTheDocument();
    expect(screen.getByText('−8,000.00')).toBeInTheDocument();
    expect(screen.getAllByText('11,000.00').length).toBeGreaterThanOrEqual(2);
  });

  it('shows the overdue warning badge only when age >= thresholdDays', () => {
    render(
      <AgingTab
        {...baseProps}
        data={mkData([
          mkRow({ contractId: 'c-old', contractNumber: 'CT-OLD', intercoAgeDays: 45 }),
          mkRow({ contractId: 'c-new', contractNumber: 'CT-NEW', intercoAgeDays: 20 }),
        ])}
      />,
    );
    // Exactly ONE row badge (the 45-day row) — the summary tile uses a
    // different label so it never collides with this string.
    expect(screen.getAllByText('ค้างเกิน 30 วัน')).toHaveLength(1);
  });

  it('flags a non-legacy bookMismatch row with the destructive "สองสมุดไม่ตรง" badge', () => {
    render(
      <AgingTab
        {...baseProps}
        data={mkData([mkRow({ bookMismatch: true, shopMirrorNet: '0.00' })])}
      />,
    );
    expect(screen.getByText('สองสมุดไม่ตรง')).toBeInTheDocument();
  });

  it('marks legacyOneBook rows with a neutral era badge — never the red mismatch badge, never overdue', () => {
    render(
      <AgingTab
        {...baseProps}
        data={mkData(
          [
            mkRow({
              bookMismatch: true, // คณิตศาสตร์ mismatch จริง แต่บริบท = legacy
              legacyOneBook: true,
              legacySwapGross: '8000.00',
              shopMirrorNet: '0.00',
              intercoAgeDays: 400, // เกิน threshold แต่ห้ามติด overdue (ตรง totals ฝั่ง server)
            }),
          ],
          { intercoNet: '0.00', legacyOneBookNet: '8000.00' },
        )}
      />,
    );
    const legacyBadge = screen.getByText('ยุคก่อนระบบสองสมุด');
    expect(legacyBadge).toBeInTheDocument();
    expect(legacyBadge.className).not.toMatch(/destructive/);
    expect(screen.queryByText('สองสมุดไม่ตรง')).not.toBeInTheDocument();
    expect(screen.queryByText('ค้างเกิน 30 วัน')).not.toBeInTheDocument();
  });

  it('reports the legacy net separately in the summary strip (excluded from main totals)', () => {
    render(
      <AgingTab
        {...baseProps}
        data={mkData([mkRow({ legacyOneBook: true, legacySwapGross: '8000.00' })], {
          intercoNet: '0.00',
          legacyOneBookNet: '8000.00',
        })}
      />,
    );
    expect(screen.getByText(/swap ยุคเก่า/)).toBeInTheDocument();
  });

  it('communicates that balances are CURRENT and asOf drives only the age', () => {
    render(<AgingTab {...baseProps} data={mkData([mkRow()])} />);
    expect(screen.getByText(/ยอดคงเหลือปัจจุบัน/)).toBeInTheDocument();
    expect(screen.getByText(/อายุนับถึง/)).toBeInTheDocument();
  });

  it('renders a Thai empty state when there are no rows', () => {
    render(<AgingTab {...baseProps} data={mkData([])} />);
    expect(screen.getByText('ไม่มีลูกหนี้หน้าร้านค้างอยู่')).toBeInTheDocument();
  });
});
