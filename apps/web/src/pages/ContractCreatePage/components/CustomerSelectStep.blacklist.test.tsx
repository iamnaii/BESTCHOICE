import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import type { CustomerBlacklistResult } from '@installment/shared';
import { CustomerSelectStep, type CustomerSelectStepProps } from './CustomerSelectStep';

const auth = vi.hoisted(() => ({ role: 'OWNER' }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1', role: auth.role } }) }));
// กล่องถอด tag ของจริงอยู่ที่ CollectionsPage — stub ให้เห็นแค่ว่าเปิด/ปิดและส่ง customerId ถูก
vi.mock('@/pages/CollectionsPage/components/CustomerTagDialog', () => ({ __esModule: true,
  default: (p: { open: boolean; customerId: string | null; onClose: () => void }) => p.open ? <div data-testid="tag-dialog">{p.customerId}<button onClick={p.onClose}>ปิดกล่อง</button></div> : null }));

const customer = { id: 'c1', name: 'ลูกค้าทดสอบ', phone: '0812345678', nationalId: '1234567890123', salary: null, occupation: null,
  salaryPayDay: null, activeContracts: 2, overdueContracts: 0 };
const hard: CustomerBlacklistResult = { level: 'HARD', checkedAt: 't', reasons: [{ code: 'MANUAL_TAG', level: 'HARD', message: 'ติด tag blacklist โดย เจ้าของ' }] };
const soft: CustomerBlacklistResult = { level: 'SOFT', checkedAt: 't', reasons: [
  { code: 'REFERENCES_BLACKLISTED', level: 'SOFT', message: 'ผู้อ้างอิง "ก" คือ ข ที่ติด blacklist', related: { customerId: 'c9', name: 'ข' } }] };
const none: CustomerBlacklistResult = { level: 'NONE', checkedAt: 't', reasons: [] };

function renderStep(over: Partial<CustomerSelectStepProps> = {}) {
  const props: CustomerSelectStepProps = {
    customers: [customer], customerSearch: '', setCustomerSearch: vi.fn(), selectedCustomer: customer, setSelectedCustomer: vi.fn(), onNext: vi.fn(),
    latestCreditCheck: null, customerCreditApproved: true, onOpenCredit: vi.fn(), onOpenCustomerModal: vi.fn(),
    blacklist: none, blacklistStatus: 'ready', onRetryBlacklist: vi.fn(),
    overrideAccepted: false, setOverrideAccepted: vi.fn(), overrideReason: '', setOverrideReason: vi.fn(),
    ...over,
  };
  render(<MemoryRouter><CustomerSelectStep {...props} /></MemoryRouter>);
  return props;
}

describe('CustomerSelectStep — blacklist box (ก้อน 5 C3)', () => {
  beforeEach(() => { auth.role = 'OWNER'; });

  it('HARD shows the red box with reasons and no override controls', () => {
    renderStep({ blacklist: hard });
    const box = screen.getByRole('alert');
    expect(box).toHaveTextContent('ห้ามทำสัญญา — ลูกค้าติด blacklist');
    expect(box).toHaveTextContent('ติด tag blacklist โดย เจ้าของ');
    expect(box).toHaveTextContent('ไม่มีการอนุมัติข้าม');
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /เหตุผล/ })).not.toBeInTheDocument();
  });

  it('HARD with MANUAL_TAG lets OWNER open the real tag dialog here and re-checks on close; SALES is told whom to contact', async () => {
    const props = renderStep({ blacklist: hard });
    expect(screen.queryByTestId('tag-dialog')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'ถอด tag' }));
    expect(screen.getByTestId('tag-dialog')).toHaveTextContent('c1');
    await userEvent.click(screen.getByRole('button', { name: 'ปิดกล่อง' }));
    expect(screen.queryByTestId('tag-dialog')).not.toBeInTheDocument();
    expect(props.onRetryBlacklist).toHaveBeenCalledTimes(1);
  });

  it('HARD with MANUAL_TAG: SALES gets no tag button, only whom to contact', () => {
    auth.role = 'SALES';
    renderStep({ blacklist: hard });
    expect(screen.queryByRole('button', { name: 'ถอด tag' })).not.toBeInTheDocument();
    expect(screen.getByText(/ติดต่อเจ้าของ\/ผู้จัดการการเงิน/)).toBeInTheDocument();
  });

  it('SOFT lets OWNER tick and type a reason with a counter', async () => {
    const props = renderStep({ blacklist: soft, overrideReason: 'สั้น' });
    const box = screen.getByRole('alert');
    expect(box).toHaveTextContent('ต้องให้ผู้จัดการอนุมัติก่อนทำสัญญา');
    expect(screen.getByRole('link', { name: 'ข' })).toHaveAttribute('href', '/customers/c9');
    const tick = screen.getByRole('checkbox', { name: /อนุมัติทำสัญญาทั้งที่มีประวัติ \(ในฐานะ เจ้าของ\)/ });
    await userEvent.click(tick);
    expect(props.setOverrideAccepted).toHaveBeenCalledWith(true);
    expect(screen.getByText('4/10')).toBeInTheDocument();
    await userEvent.type(screen.getByRole('textbox', { name: /เหตุผล/ }), 'ก');
    expect(props.setOverrideReason).toHaveBeenCalled();
  });

  it('SOFT tells SALES to contact the branch manager', () => {
    auth.role = 'SALES';
    renderStep({ blacklist: soft });
    expect(screen.getByText('กรุณาติดต่อผู้จัดการสาขาเพื่ออนุมัติ')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('error state offers a retry button; loading shows a waiting line', async () => {
    const props = renderStep({ blacklist: undefined, blacklistStatus: 'error' });
    await userEvent.click(screen.getByRole('button', { name: 'ลองใหม่' }));
    expect(props.onRetryBlacklist).toHaveBeenCalledTimes(1);
    renderStep({ blacklist: undefined, blacklistStatus: 'loading' });
    expect(screen.getByText(/กำลังตรวจ blacklist/)).toBeInTheDocument();
  });

  it('no longer renders the legacy active-contract banner', () => {
    renderStep({ blacklist: none });
    expect(screen.queryByText(/ยังมีสัญญาที่กำลังผ่อนอยู่/)).not.toBeInTheDocument();
    expect(screen.queryByText(/อนุมัติผ่อนซ้อน/)).not.toBeInTheDocument();
  });
});
