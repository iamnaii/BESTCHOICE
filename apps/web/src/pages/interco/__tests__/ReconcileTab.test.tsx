import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReconcileTab } from '../ReconcileTab';
import type {
  NegativeTypedRow,
  PayablePairMismatchRow,
  ReconcileFindingsResponse,
  ReconcileRunResponse,
} from '../types';

/**
 * แท็บ "กระทบยอด" (Phase 5 Task 5 ข้อ 1+4) — presentational เหมือน AgingTab
 * (page ถือ query/mutation) จึงเทสต์ได้ตรง ๆ ไม่ต้อง mock react-query.
 *
 * จุดที่ต้องปัก:
 *   - สองมุมที่แท็บอายุกรองออกโดยโครงสร้าง (คู่เจ้าหนี้ไม่ตรง + ยอดติดลบ)
 *     ต้อง "มีที่ให้ดู" จริง ๆ ที่นี่ — เหตุผลทั้งหมดของงานข้อ 1
 *   - ป้าย "ต่างเฉพาะค่าคอม" มาจาก server (`commissionOnly`) ห้าม FE คำนวณเอง
 *   - ปุ่มสั่งรันเห็นเฉพาะ role ระดับ checker (OWNER/FINANCE_MANAGER)
 *   - kill switch ปิด → ต้องบอกตรง ๆ ว่ายังไม่ได้ตรวจอะไรเลย + ทางแก้
 */

const mockUser = vi.hoisted(() => ({ current: { role: 'OWNER' } as { role: string } | null }));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: mockUser.current }),
}));

function mkPair(overrides: Partial<PayablePairMismatchRow> = {}): PayablePairMismatchRow {
  return {
    contractId: 'c-pair',
    contractNumber: 'CT-2026-0009',
    customerName: 'สมหญิง มีสุข',
    financedGl: '10000.00',
    commissionGl: '1000.00',
    shopFinancedGl: '10000.00',
    shopCommissionGl: '0.00',
    legacyNoShop: false,
    financedDiff: '0.00',
    commissionDiff: '1000.00',
    diff: '1000.00',
    mismatch: true,
    commissionOnly: true,
    ...overrides,
  };
}

function mkNegative(overrides: Partial<NegativeTypedRow> = {}): NegativeTypedRow {
  return {
    contractId: 'c-neg',
    contractNumber: 'CT-2026-0013',
    customerName: 'สมชาย ใจดี',
    swapCreditGross: '0.00',
    payoutRecallGross: '11000.00',
    settledDeduction: '14000.00',
    intercoNet: '-3000.00',
    shopCollect: '0.00',
    shopMirrorNet: '-3000.00',
    intercoOldestPostedAt: '2026-08-01T00:00:00.000Z',
    intercoAgeDays: 20,
    shopCollectOldestPostedAt: null,
    shopCollectAgeDays: null,
    bookMismatch: false,
    legacySwapGross: '0.00',
    legacyOneBook: false,
    negativeFields: [
      { field: 'intercoNet', label: 'กลุ่มระหว่างกิจการ (11-2107)', value: '-3000.00' },
      { field: 'shopMirrorNet', label: 'กระจกฝั่ง SHOP (S21-3001)', value: '-3000.00' },
    ],
    ...overrides,
  };
}

function mkData(
  pairMismatches: PayablePairMismatchRow[] = [],
  negativeRows: NegativeTypedRow[] = [],
): ReconcileFindingsResponse {
  return { asOf: '2026-08-22T07:00:00.000Z', pairMismatches, negativeRows };
}

const baseProps = {
  isLoading: false,
  isError: false,
  error: null as unknown,
  onRetry: vi.fn(),
  onRun: vi.fn(),
  isRunning: false,
  lastRun: null as ReconcileRunResponse | null,
};

describe('ReconcileTab', () => {
  beforeEach(() => {
    mockUser.current = { role: 'OWNER' };
    vi.clearAllMocks();
  });

  it('แสดงคู่เจ้าหนี้ที่ไม่ตรง พร้อมส่วนต่างแยกขา และป้ายรูปแบบจาก server', () => {
    render(<ReconcileTab {...baseProps} data={mkData([mkPair()], [])} />);

    expect(screen.getByText('CT-2026-0009')).toBeInTheDocument();
    expect(screen.getByText('สมหญิง มีสุข')).toBeInTheDocument();
    // ต่างเฉพาะค่าคอม 1,000 (financedDiff = 0)
    expect(screen.getByText('ต่างเฉพาะค่าคอม')).toBeInTheDocument();
    expect(screen.getAllByText('1,000.00').length).toBeGreaterThan(0);
  });

  it('คู่ที่ไม่ใช่รูปแบบที่รู้จัก → ป้าย "ต้องตรวจสอบ" ไม่ใช่ "ต่างเฉพาะค่าคอม"', () => {
    render(
      <ReconcileTab
        {...baseProps}
        data={mkData(
          [mkPair({ financedDiff: '500.00', commissionDiff: '0.00', commissionOnly: false })],
          [],
        )}
      />,
    );
    expect(screen.getByText('ต้องตรวจสอบ')).toBeInTheDocument();
    expect(screen.queryByText('ต่างเฉพาะค่าคอม')).not.toBeInTheDocument();
  });

  it('แสดงแถวยอดติดลบพร้อมช่องที่ติดลบทุกช่อง (server เป็นคนบอกว่าช่องไหน)', () => {
    render(<ReconcileTab {...baseProps} data={mkData([], [mkNegative()])} />);

    expect(screen.getByText('CT-2026-0013')).toBeInTheDocument();
    expect(screen.getByText(/กลุ่มระหว่างกิจการ \(11-2107\): -3,000.00/)).toBeInTheDocument();
    expect(screen.getByText(/กระจกฝั่ง SHOP \(S21-3001\): -3,000.00/)).toBeInTheDocument();
  });

  it('ไม่มีอะไรผิดปกติ → ข้อความว่างของทั้งสองส่วน', () => {
    render(<ReconcileTab {...baseProps} data={mkData([], [])} />);
    expect(screen.getByText('เจ้าหนี้กับลูกหนี้รอบจ่ายตรงกันทุกสัญญา')).toBeInTheDocument();
    expect(screen.getByText('ไม่มียอดติดลบ')).toBeInTheDocument();
  });

  it('ปุ่มสั่งรัน: OWNER เห็นและกดได้ → เรียก onRun', async () => {
    const onRun = vi.fn();
    render(<ReconcileTab {...baseProps} onRun={onRun} data={mkData()} />);
    await userEvent.click(screen.getByRole('button', { name: /สั่งรันกระทบยอด/ }));
    expect(onRun).toHaveBeenCalledTimes(1);
  });

  it('ปุ่มสั่งรัน: ACCOUNTANT (อ่านได้ แต่ไม่ใช่ role อนุมัติ) ต้องไม่เห็นปุ่ม', () => {
    mockUser.current = { role: 'ACCOUNTANT' };
    render(<ReconcileTab {...baseProps} data={mkData()} />);
    expect(screen.queryByRole('button', { name: /สั่งรันกระทบยอด/ })).not.toBeInTheDocument();
  });

  it('kill switch ปิด → บอกว่ายังไม่ได้ตรวจอะไรเลย + ชี้ทางแก้ที่ทำได้จริง', () => {
    render(
      <ReconcileTab
        {...baseProps}
        data={mkData()}
        lastRun={{ enabled: false, todoCreated: false, total: 0, counts: {}, findings: [] }}
      />,
    );
    expect(screen.getByText(/ยังไม่ได้ตรวจอะไรเลย/)).toBeInTheDocument();
    expect(screen.getByText(/interco_reconcile_enabled/)).toBeInTheDocument();
  });

  it('รันแล้วพบรายการ + เดือนนี้มีใบงานค้างอยู่แล้ว → ไม่หลอกว่าสร้างใบใหม่', () => {
    render(
      <ReconcileTab
        {...baseProps}
        data={mkData()}
        lastRun={{
          enabled: true,
          todoCreated: false,
          total: 3,
          counts: { NEGATIVE_TYPED: 2, ACCOUNT_DRIFT: 1 },
          findings: [],
        }}
      />,
    );
    expect(screen.getByText(/พบ 3 รายการไม่ตรง/)).toBeInTheDocument();
    expect(screen.getByText(/ยอดติดลบ \(ล้างเกิน\) 2/)).toBeInTheDocument();
    expect(screen.getByText(/มีใบงานค้างอยู่แล้ว/)).toBeInTheDocument();
  });

  it('รันแล้วตรงทุกรายการ → ข้อความยืนยันเชิงบวก', () => {
    render(
      <ReconcileTab
        {...baseProps}
        data={mkData()}
        lastRun={{ enabled: true, todoCreated: false, total: 0, counts: {}, findings: [] }}
      />,
    );
    expect(screen.getByText(/ตรงทุกรายการ/)).toBeInTheDocument();
  });
});
