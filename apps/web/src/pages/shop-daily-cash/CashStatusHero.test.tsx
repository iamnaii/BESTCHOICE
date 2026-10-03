import { describe, expect, it, vi } from 'vitest';
import { render, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import CashStatusHero from './CashStatusHero';
import type { CashClose, CashCloseStatusResponse } from './cash-close';

vi.mock('@/lib/api', () => ({
  default: { get: vi.fn(), post: vi.fn() },
  getErrorMessage: (error: Error) => error.message,
}));

const close = (over: Partial<CashClose> = {}): CashClose => ({
  id: 'cl-1',
  branchId: 'br-1',
  branchName: 'ลพบุรี',
  status: 'PENDING_CONFIRM',
  attemptNo: 1,
  periodStart: null,
  countedAt: '2026-09-21T13:40:00.000Z',
  floatAmount: 1000,
  cashIn: 16500,
  cashOut: 5790,
  expectedAmount: 11710,
  countedAmount: 11510,
  varianceAmount: -200,
  varianceReason: 'ทอนผิด',
  sendAmount: 10510,
  countedBy: { id: 'u-bm', name: 'ผจก.' },
  receivedAmount: null,
  receiveVariance: null,
  receiveNote: null,
  destination: null,
  confirmedBy: null,
  confirmedAt: null,
  sentBackBy: null,
  sentBackAt: null,
  sentBackReason: null,
  journalPosted: false,
  depositReference: null,
  hasDepositSlip: false,
  moneyState: 'AWAITING_CONFIRM',
  ...over,
});
const confirmed = close({
  status: 'CONFIRMED',
  receivedAmount: 10510,
  destination: 'BANK_DEPOSIT',
  moneyState: 'REACHED',
  confirmedAt: '2026-09-21T13:52:00.000Z',
  confirmedBy: { id: 'u-owner', name: 'เจ้าของ' },
});

const manager = {
  canCount: true,
  canConfirm: true,
  viewerId: 'u-bm',
  viewerRole: 'BRANCH_MANAGER',
};
const emptyRound = {
  periodStart: null,
  floatAmount: 1000,
  cashIn: 0,
  cashOut: 0,
  expectedAmount: 1000,
  movementCount: 0,
};

const status = (over: Partial<CashCloseStatusResponse> = {}): CashCloseStatusResponse => ({
  date: '2026-09-21',
  asOf: '2026-09-21T13:00:00.000Z',
  branchId: 'br-1',
  branchName: 'ลพบุรี',
  round: emptyRound,
  closes: [],
  awaitingConfirm: [],
  permissions: manager,
  readiness: {
    hasDrawerAccount: true,
    floatAmount: 1000,
    counters: [{ id: 'u-bm', name: 'ผจก.', role: 'BRANCH_MANAGER' }],
  },
  holdings: [],
  ...over,
});

function renderHero(response: CashCloseStatusResponse) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <CashStatusHero
          status={response}
          date="2026-09-21"
          isToday
          onSend={vi.fn()}
          onConfirm={vi.fn()}
          onDeposit={vi.fn()}
        />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  const list = document.querySelector('ol[aria-label="ขั้นตอนการปิดยอด"]') as HTMLElement;
  return within(list)
    .getAllByRole('listitem')
    .map((item) => item.textContent);
}

describe('CashStatusHero — แถบขั้นตอน 3 ขั้น: เลขลำดับอยู่ในวงกลมที่เดียว หัวข้อไม่ขึ้นต้นด้วยเลขซ้ำ', () => {
  it('ยังไม่มีเงินสดในรอบ (ทุกขั้นยังไม่ถึง) = วงกลมเลข + ชื่อขั้น ไม่ใช่ "1 1 ส่งยอด"', () => {
    expect(renderHero(status())).toEqual(['1ส่งยอด', '2ยืนยันรับเงิน', '3เงินถึงบริษัท']);
  });

  it('เงินถึงบริษัทแล้ว = วงกลมเป็นเครื่องหมายถูก หัวข้อไม่มีเลขนำหน้า', () => {
    const [sent, received, reached] = renderHero(status({ closes: [confirmed] }));
    expect(sent).toMatch(/^ส่งยอดแล้ว/);
    expect(received).toMatch(/^รับเงินแล้ว/);
    expect(reached).toMatch(/^ถึงบริษัทแล้ว/);
  });
});
