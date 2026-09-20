import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router';
import type { Product, Customer } from './types';
import POSPage from './index';

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), product: {} as Product }));
vi.mock('@/lib/api', () => ({ default: { get: mocks.get, post: mocks.post },
  getErrorMessage: (error: Error) => error.message }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1', role: 'SALES' } }) }));
vi.mock('@/components/trade-in/TradeInCreditPicker', () => ({ default: () => null }));
// Search transport is isolated; the real POS handler, form, price buttons,
// calculation, summary and POST payload are exercised together.
vi.mock('./components/ProductSearch', () => ({ default: ({ onSelectProduct }: { onSelectProduct: (product: Product) => void }) =>
  <button onClick={() => onSelectProduct(mocks.product)}>เลือกเครื่องทดสอบ</button> }));
vi.mock('./components/CustomerSearch', () => ({ default: ({ onSelectCustomer }: { onSelectCustomer: (customer: Customer) => void }) =>
  <button onClick={() => onSelectCustomer({ id: 'c1', name: 'ลูกค้าทดสอบ', phone: '0800000000', nationalId: '', _count: { contracts: 0 } })}>เลือกลูกค้าทดสอบ</button> }));
vi.mock('@/components/bundle/BundleSearch', () => ({ default: ({ onAddBundle }: { onAddBundle: (product: Product) => void }) =>
  <button onClick={() => onAddBundle({ ...mocks.product, id: 'acc1', name: 'เคสทดสอบ', category: 'ACCESSORY', imeiSerial: null })}>เพิ่มของแถมทดสอบ</button> }));

function Location() { const location = useLocation(); return <output aria-label="current location">{location.pathname}{location.search}</output>; }
function renderPOS() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<MemoryRouter><QueryClientProvider client={client}><POSPage /><Location /></QueryClientProvider></MemoryRouter>);
}
const priceInput = () => screen.getByLabelText(/ราคาขาย/);
const selectProduct = async () => userEvent.click(await screen.findByRole('button', { name: 'เลือกเครื่องทดสอบ' }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.product = { id: 'p1', name: 'เครื่องทดสอบ', brand: 'TEST', model: 'TEST', imeiSerial: 'TEST-IMEI',
    category: 'PHONE_NEW', costPrice: '6000', branchId: 'b1', branch: { id: 'b1', name: 'สาขาทดสอบ' }, prices: [
      { id: 'loan', label: 'ราคาผ่อน BESTCHOICE', amount: '10000', isDefault: false },
      { id: 'cash', label: 'ราคาเงินสด', amount: '9000', isDefault: true },
    ] };
  mocks.get.mockImplementation(async (path: string) => ({ data: path === '/sales/config'
    ? { interestRate: 0.01, minDownPaymentPct: 0.15, minInstallmentMonths: 6, maxInstallmentMonths: 12 } : [] }));
  mocks.post.mockResolvedValue({ data: { id: 's1', saleNumber: 'TEST-SALE-1' } });
});

describe('POS price selection', () => {
  it('preserves selected customer/product on handoff after disclosing non-transferable conditions', async () => {
    renderPOS(); await selectProduct();
    await userEvent.click(screen.getByRole('button', { name: 'เลือกลูกค้าทดสอบ' }));
    await userEvent.click(screen.getByRole('button', { name: /ไปสร้างสัญญาผ่อนชำระ/ }));
    expect(screen.getByText(/ราคา ส่วนลด เครดิตเทิร์น/)).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'กลับมาแก้ไข' }));
    expect(priceInput()).toHaveValue(9000);
    await userEvent.click(screen.getByRole('button', { name: /ไปสร้างสัญญาผ่อนชำระ/ }));
    await userEvent.click(screen.getByRole('button', { name: 'ไปสร้างสัญญาด้วยข้อมูลนี้' }));
    expect(screen.getByLabelText('current location')).toHaveTextContent('/contracts/create?customerId=c1&productId=p1');
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it('พาของแถมที่เลือกไว้ไปหน้าสัญญาด้วย (เดิมแจ้งว่า "ของแถมจะไม่ถูกย้าย")', async () => {
    renderPOS(); await selectProduct();
    await userEvent.click(screen.getByRole('button', { name: 'เลือกลูกค้าทดสอบ' }));
    await userEvent.click(screen.getByRole('button', { name: 'เพิ่มของแถมทดสอบ' }));
    await userEvent.click(screen.getByRole('button', { name: /ไปสร้างสัญญาผ่อนชำระ/ }));
    expect(screen.getByText(/ของแถม 1 รายการจะถูกพาไปหน้าสัญญาด้วย/)).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'ไปสร้างสัญญาด้วยข้อมูลนี้' }));
    expect(screen.getByLabelText('current location')).toHaveTextContent('/contracts/create?customerId=c1&productId=p1&bundleProductIds=acc1');
  });

  it('ปุ่มประเภทการขายเขียนว่า "ไฟแนนซ์นอก" และบอกตรง ๆ ว่าผ่อนในเครือไม่ต้องบันทึกที่หน้านี้', async () => {
    renderPOS();
    expect(await screen.findByRole('button', { name: /ไฟแนนซ์นอก/ })).toHaveTextContent('GFIN และบริษัทไฟแนนซ์ภายนอก');
    expect(screen.queryByRole('button', { name: /ผ่อนไฟแนนซ์/ })).not.toBeInTheDocument();
    expect(screen.getByText('ผ่อนกับ BESTCHOICE ทำที่หน้าสัญญา')).toBeVisible();
    expect(screen.getByText(/ระบบตัดสต๊อกและออกใบขายให้เองเมื่อเปิดใช้สัญญา ไม่ต้องบันทึกที่หน้านี้ซ้ำ/)).toBeVisible();
  });

  it('initializes CASH from the cash price and submits that exact amount', async () => {
    renderPOS(); await selectProduct();
    expect(priceInput()).toHaveValue(9000);
    await userEvent.click(screen.getByRole('button', { name: 'เลือกลูกค้าทดสอบ' }));
    await userEvent.click(screen.getByRole('button', { name: 'บันทึกการขาย' }));
    await waitFor(() => expect(mocks.post).toHaveBeenCalledWith('/sales', expect.objectContaining({
      saleType: 'CASH', sellingPrice: 9000, amountReceived: 9000, productId: 'p1', customerId: 'c1',
    })));
  });

  it('reselects the default price on an intentional sale-type change', async () => {
    renderPOS(); await selectProduct();
    await userEvent.click(screen.getByRole('button', { name: /ไฟแนนซ์นอก/ }));
    expect(priceInput()).toHaveValue(10000);
    await userEvent.click(screen.getByRole('button', { name: 'เงินสด' }));
    expect(priceInput()).toHaveValue(9000);
  });

  it('prefers the cash column without highlighting a mismatched price row', async () => {
    Object.assign(mocks.product, { cashPrice: '8500', installmentPrice: '10000' });
    renderPOS(); await selectProduct();
    expect(priceInput()).toHaveValue(8500);
    expect(screen.getByRole('button', { name: /ราคาเงินสด/ })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: /ราคาผ่อน BESTCHOICE/ })).toHaveAttribute('aria-pressed', 'false');
  });

  it('does not highlight a loan row just because it has the same amount as cash', async () => {
    mocks.product.prices[0].amount = '9000';
    renderPOS(); await selectProduct();
    expect(screen.getByRole('button', { name: /ราคาเงินสด/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /ราคาผ่อน BESTCHOICE/ })).toHaveAttribute('aria-pressed', 'false');
  });

  it('shows a missing cash price and prevents submitting a zero-price sale', async () => {
    mocks.product.prices = mocks.product.prices.slice(0, 1);
    renderPOS(); await selectProduct();
    await userEvent.click(screen.getByRole('button', { name: 'เลือกลูกค้าทดสอบ' }));
    expect(priceInput()).toHaveValue(0);
    expect(screen.getByText(/ยังไม่ได้ตั้งราคาเงินสด/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'บันทึกการขาย' })).toBeDisabled();
  });

  it('keeps an explicitly selected price when the customer changes', async () => {
    renderPOS(); await selectProduct();
    await userEvent.click(screen.getByRole('button', { name: /ราคาผ่อน BESTCHOICE/ }));
    expect(priceInput()).toHaveValue(10000);
    await userEvent.click(screen.getByRole('button', { name: 'เลือกลูกค้าทดสอบ' }));
    expect(priceInput()).toHaveValue(10000);
  });

  it('uses the newly selected device cash price while preserving the existing discount', async () => {
    renderPOS(); await selectProduct();
    const discount = screen.getAllByRole('spinbutton')[1];
    await userEvent.clear(discount);
    await userEvent.type(discount, '100');
    mocks.product = { ...mocks.product, id: 'p2', cashPrice: '8000', prices: [
      { id: 'p2-cash', label: 'ราคาเงินสด', amount: '8000', isDefault: true },
    ] };
    await selectProduct();
    expect(priceInput()).toHaveValue(8000);
    expect(discount).toHaveValue(100);
    expect(screen.getByRole('button', { name: /ราคาเงินสด/ })).toHaveAttribute('aria-pressed', 'true');
  });
});
