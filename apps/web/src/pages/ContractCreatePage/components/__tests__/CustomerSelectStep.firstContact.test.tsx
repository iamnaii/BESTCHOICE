import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { journeySummary } from '@/pages/CustomerDetailPage/__tests__/journeyFixtures';
import ContractCreatePage from '../../index';
import type { Customer } from '../../types';
import { CustomerSelectStep, type CustomerSelectStepProps } from '../CustomerSelectStep';

/**
 * ขั้นเลือกลูกค้า (UI "ขั้นตอน 2", โค้ด step === 1) — บรรทัดช่องทางแรกของลูกค้าที่เลือก + การ์ดถามรู้จักร้านจากไหน
 * 🔴 hook ของ vitest ห้าม return ค่า · ข้อมูลลูกค้าในไฟล์นี้เป็นข้อมูลสังเคราะห์
 */
const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), del: vi.fn(), summary: null as unknown }));

vi.mock('@/lib/api', () => ({
  default: { get: mocks.get, post: mocks.post, delete: mocks.del },
  getErrorMessage: () => 'ผิดพลาด',
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'heard-staff', role: 'SALES' } }) }));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), dismiss: vi.fn() }) }));
vi.mock('@/components/trade-in/TradeInCreditPicker', () => ({ default: () => null }));

const FIRST_CONTACT = 'ทักแชทครั้งแรกทาง Facebook';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function person(over: Partial<Customer> = {}): Customer {
  return {
    id: 'a', name: 'ลูกค้าสังเคราะห์ ก', phone: '0800000001', nationalId: '1000000000001', salary: null,
    occupation: null, salaryPayDay: 31, activeContracts: 0, overdueContracts: 0, ...over,
  };
}

const rowOf = (name: string) => screen.getByText(name).closest('[class*="cursor-pointer"]') as HTMLElement;

function renderStep(over: Partial<CustomerSelectStepProps> = {}) {
  const props: CustomerSelectStepProps = {
    customers: [person(), person({ id: 'b', name: 'ลูกค้าสังเคราะห์ ข', phone: '0800000002', nationalId: '1000000000002' })],
    customerSearch: '', setCustomerSearch: vi.fn(), selectedCustomer: null, setSelectedCustomer: vi.fn(), onNext: vi.fn(),
    latestCreditCheck: null, customerCreditApproved: false, onOpenCredit: vi.fn(), onOpenCustomerModal: vi.fn(),
    overrideActiveContractCheck: false, setOverrideActiveContractCheck: vi.fn(), ...over,
  };
  return render(<CustomerSelectStep {...props} />);
}

describe('CustomerSelectStep — บรรทัดช่องทางแรก + ช่องการ์ด', () => {
  it('บรรทัด "ทักแชทครั้งแรกทาง Facebook" อยู่ในแถวที่เลือกเท่านั้น ใต้บรรทัดเบอร์', () => {
    const selected = person({ id: 'b', name: 'ลูกค้าสังเคราะห์ ข', phone: '0800000002', nationalId: '1000000000002' });
    renderStep({ selectedCustomer: selected, firstContactLine: FIRST_CONTACT });

    expect(screen.getAllByText(FIRST_CONTACT)).toHaveLength(1);
    const line = within(rowOf('ลูกค้าสังเคราะห์ ข')).getByText(FIRST_CONTACT);
    expect(line).toHaveClass('mt-1', 'text-xs', 'leading-snug', 'text-muted-foreground');
    const phone = within(rowOf('ลูกค้าสังเคราะห์ ข')).getByText('0800000002');
    expect(phone.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(rowOf('ลูกค้าสังเคราะห์ ก')).queryByText(FIRST_CONTACT)).toBeNull();
  });

  it('firstContactLine เป็น null → ไม่มีบรรทัดเพิ่ม', () => {
    renderStep({ selectedCustomer: person(), firstContactLine: null });
    expect(screen.queryByText(/ทักแชทครั้งแรกทาง/)).toBeNull();
  });

  it('ช่องการ์ดอยู่ระหว่างแถบเตือนสัญญาค้างกับกล่องเครดิต', () => {
    const blocked = person({ activeContracts: 1 });
    renderStep({ customers: [blocked], selectedCustomer: blocked, heardFromSlot: <div data-testid="heard-from-slot">การ์ด</div> });

    const banner = screen.getByText('ลูกค้ายังมีสัญญาที่กำลังผ่อนอยู่ 1 รายการ');
    const slot = screen.getByTestId('heard-from-slot');
    const credit = screen.getByText('สถานะเครดิต: ยังไม่ได้ตรวจ');
    expect(banner.compareDocumentPosition(slot) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(slot.compareDocumentPosition(credit) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

const product = {
  id: 'product', branchId: 'branch', category: 'PHONE_NEW', name: 'Synthetic phone', brand: 'Test', model: 'One',
  status: 'IN_STOCK', installmentPrice: '10000', prices: [], branch: { id: 'branch', name: 'Test branch' },
};
const selected = person({ id: 'customer', name: 'ลูกค้าที่เลือกไว้', phone: '0800000009', nationalId: '1000000000009' });
const config = {
  interestRate: '0.01', minDownPaymentPct: '0.15', storeCommissionPct: '0.1', vatPct: '0.07',
  minInstallmentMonths: 6, maxInstallmentMonths: 12,
};
const approvedCredit = {
  id: 'check', status: 'APPROVED', checkType: 'FULL', aiScore: null,
  approvals: [{ id: 'approval', salaryPayDay: 31, approvedMonthlyPayment: '2000', supersededAt: null, usedByContractId: null }],
};
const walkIn = (over: Parameters<typeof journeySummary>[0] = {}) =>
  journeySummary({ firstChannel: 'WALK_IN', firstSource: 'WALK_IN', firstSourceLabel: 'หน้าร้าน', askHeardFrom: true, ...over });

function mountAtCustomerStep() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/contracts/create']}>
        <ContractCreatePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ContractCreatePage ขั้นเลือกลูกค้า — ถามรู้จักร้านจากไหน / ช่องทางแรก', () => {
  beforeEach(() => {
    localStorage.clear();
    // ร่างที่กู้คืนพาไปขั้นเลือกลูกค้าพร้อมลูกค้าที่เลือกไว้ (step = min(1, 2))
    localStorage.setItem('bestchoice-contract-draft:heard-staff', JSON.stringify({
      step: 1, productId: product.id, customerId: selected.id, downPayment: 0, totalMonths: 6, paymentDueDay: 31,
      notes: '', savedAt: new Date().toISOString(),
    }));
    mocks.summary = walkIn();
    mocks.get.mockReset();
    mocks.get.mockImplementation(async (url: string) => {
      if (url === '/products/product') return { data: product };
      if (url === '/customers/customer') return { data: selected };
      if (url === '/customers/customer/journey/summary') return { data: mocks.summary };
      if (url === '/customers/customer/credit-check/latest') return { data: approvedCredit };
      if (url.startsWith('/interest-configs') || url === '/sales/config') return { data: config };
      return { data: { data: [] } };
    });
    mocks.post.mockReset();
    mocks.post.mockImplementation(async (url: string, body: { heardFrom?: string }) => {
      if (url === '/customers/customer/journey/entries') {
        mocks.summary = walkIn({ askHeardFrom: false, heardFrom: body.heardFrom ?? null });
        return { data: { entryId: 'e-card', event: null, summary: mocks.summary } };
      }
      // ใบเสนอราคาใช้ขั้นตอน 3 — ขั้นนี้ให้ล้มเงียบ ๆ (quote เป็น undefined ไม่กระทบขั้นเลือกลูกค้า)
      if (url === '/contracts/quote') throw new Error('quote not used on the customer step');
      throw new Error(`unexpected POST ${url}`);
    });
  });

  it('ลูกค้าหน้าร้านที่ยังไม่ตอบ: การ์ดอยู่ระหว่างแถวลูกค้ากับกล่องเครดิต · แตะ = บันทึก · ปุ่มถัดไปไม่เปลี่ยน', async () => {
    mountAtCustomerStep();
    const next = await screen.findByRole('button', { name: 'ถัดไป' });
    await waitFor(() => expect(next).toBeEnabled());

    const card = await screen.findByTestId('heard-from-ask');
    expect(card).toHaveClass('mt-4', 'rounded-xl', 'border-border', 'bg-card', 'p-4');
    expect(rowOf('ลูกค้าที่เลือกไว้').compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(card.compareDocumentPosition(screen.getByText('สถานะเครดิต: ผ่าน')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByText(/ทักแชทครั้งแรกทาง/)).toBeNull();

    fireEvent.click(within(card).getByRole('button', { name: 'เพื่อนแนะนำ' }));
    await waitFor(() =>
      expect(screen.getByTestId('heard-from-ask')).toHaveTextContent('ลูกค้าบอกว่ารู้จักร้านจากเพื่อนแนะนำ'),
    );
    const entryCall = mocks.post.mock.calls.find(([url]) => url === '/customers/customer/journey/entries');
    expect(entryCall?.[1]).toEqual({ kind: 'HEARD_FROM', heardFrom: 'FRIEND', clientRequestId: expect.stringMatching(UUID_RE) });
    expect(screen.getByRole('button', { name: 'ถัดไป' })).toBeEnabled();
  });

  it('"ข้าม" ซ่อนการ์ดของลูกค้าคนนี้รอบนี้ ไม่ยิงบันทึก และปุ่มถัดไปยังกดได้', async () => {
    mountAtCustomerStep();
    const card = await screen.findByTestId('heard-from-ask');
    fireEvent.click(within(card).getByRole('button', { name: 'ข้าม' }));

    expect(screen.queryByTestId('heard-from-ask')).toBeNull();
    expect(mocks.post.mock.calls.some(([url]) => url === '/customers/customer/journey/entries')).toBe(false);
    await waitFor(() => expect(screen.getByRole('button', { name: 'ถัดไป' })).toBeEnabled());
  });

  it('ลูกค้าที่ทักแชทมาก่อน: ไม่มีการ์ดชิป · แถวที่เลือกบอก "ทักแชทครั้งแรกทาง Facebook"', async () => {
    mocks.summary = journeySummary({ firstChannel: 'CHAT_FACEBOOK', askHeardFrom: false });
    mountAtCustomerStep();

    const line = await screen.findByText(FIRST_CONTACT);
    expect(rowOf('ลูกค้าที่เลือกไว้')).toContainElement(line);
    expect(screen.queryByTestId('heard-from-ask')).toBeNull();
    expect(screen.queryByRole('button', { name: 'เพื่อนแนะนำ' })).toBeNull();
  });

  it('ลูกค้าหน้าร้านที่ตอบแล้ว (askHeardFrom = false): ไม่แสดงอะไรเพิ่ม', async () => {
    mocks.summary = walkIn({ askHeardFrom: false, heardFrom: 'FRIEND' });
    mountAtCustomerStep();

    await waitFor(() => expect(mocks.get).toHaveBeenCalledWith('/customers/customer/journey/summary'));
    await screen.findByText('สถานะเครดิต: ผ่าน');
    expect(screen.queryByTestId('heard-from-ask')).toBeNull();
    expect(screen.queryByText(/ทักแชทครั้งแรกทาง/)).toBeNull();
  });
});
