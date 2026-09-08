import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import QuickBuyModal from './QuickBuyModal';
import AcceptModal from '@/pages/TradeInPage/components/AcceptModal';
import { EMPTY_ACCEPT_FORM, type TradeIn } from '@/pages/TradeInPage/types';
import TradeInProductHandoff from './TradeInProductHandoff';
import api from '@/lib/api';
import { TRADE_IN_DECLARATION_CLAUSES, TRADE_IN_DECLARATION_VERSION } from '@installment/shared';

const auth = vi.hoisted(() => ({ user: { role: 'OWNER', branchId: 'branch-1' } }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('@/lib/api', () => ({ default: { get: vi.fn(), post: vi.fn() }, getErrorMessage: () => 'บันทึกไม่สำเร็จ' }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock('@/lib/api/contacts', () => ({ contactsApi: { detail: async () => ({ phone: '0000000000' }) } }));
vi.mock('@/components/contacts/ContactCombobox', () => ({ ContactCombobox: ({ onSelect }: {
  onSelect: (value: { contactId: string; name: string }) => void;
}) => <button onClick={() => onSelect({ contactId: 'seller-1', name: 'ผู้ขายทดสอบ' })}>เลือกผู้ขายทดสอบ</button> }));
vi.mock('@/components/signing/SignaturePadFull', () => ({ default: ({ onDraftChange }: {
  onDraftChange: (value: string) => void;
}) => <button onClick={() => onDraftChange('data:image/png;base64,test')}>ลงลายเซ็นทดสอบ</button> }));

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return <MemoryRouter><QueryClientProvider client={client}>{children}</QueryClientProvider></MemoryRouter>;
}

async function prepareBuy() {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'เลือกผู้ขายทดสอบ' }));
  await user.click(screen.getByRole('button', { name: /ถัดไป/ }));
  await user.selectOptions(screen.getByRole('option', { name: 'Apple' }).closest('select')!, 'Apple');
  await user.selectOptions(screen.getByRole('option', { name: 'iPhone 15' }).closest('select')!, 'iPhone 15');
  await user.type(screen.getByLabelText('IMEI'), '359000000000081');
  await user.type(screen.getByLabelText('Serial Number'), '  BC-SN-00081  ');
  await user.type(screen.getByPlaceholderText('0'), '5000');
  await user.click(screen.getByRole('button', { name: /ถัดไป/ }));
  await user.click(screen.getByRole('checkbox', { name: /ตรวจบัตรประชาชน/ }));
  await user.click(screen.getByRole('checkbox', { name: /ผู้ขายได้อ่านและยอมรับ/ }));
  await user.click(screen.getByRole('button', { name: 'ลงลายเซ็นทดสอบ' }));
  return user;
}

describe('Counter purchase, seller payment and stock handoff', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.user.role = 'OWNER';
    vi.mocked(api.get).mockResolvedValue({ data: [{ id: 'branch-1', name: 'สาขาทดสอบ' }] });
    vi.mocked(api.post).mockResolvedValue({ data: { id: 'trade-in-1', productId: 'received-product', productStatus: 'PHOTO_PENDING', voucherNumber: 'EXP-1' } });
  });

  it.each(['CASH', 'TRANSFER'])('sends %s and the seller destination only, and returns the received product', async (method) => {
    const onSuccess = vi.fn();
    render(<QuickBuyModal open onClose={vi.fn()} onSuccess={onSuccess} onIncomplete={vi.fn()} />, { wrapper });
    const user = await prepareBuy();
    for (const clause of TRADE_IN_DECLARATION_CLAUSES) expect(screen.getByText(clause)).toBeVisible();
    await user.click(screen.getByRole('radio', { name: 'โอนเงิน' }));
    await user.type(screen.getByLabelText('ธนาคารผู้ขาย *'), 'ธนาคารผู้ขาย');
    await user.type(screen.getByLabelText('เลขบัญชีผู้ขาย *'), '1234567890');
    await user.type(screen.getByLabelText('ชื่อบัญชีผู้ขาย *'), 'ผู้ขายทดสอบ');
    if (method === 'CASH') await user.click(screen.getByRole('radio', { name: 'เงินสด' }));
    await user.click(screen.getByRole('button', { name: /บันทึก \+ ออกใบสำคัญ/ }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith(expect.objectContaining({ productId: 'received-product' })));
    expect(api.post).toHaveBeenCalledWith('/trade-ins/quick-buy', expect.objectContaining({
      paymentMethod: method, sellerContactId: 'seller-1', agreedPrice: 5000,
      imei: '359000000000081', serialNumber: 'BC-SN-00081',
      declarationVersion: TRADE_IN_DECLARATION_VERSION,
      transferAccountNumber: method === 'TRANSFER' ? '1234567890' : undefined,
    }));
    expect(vi.mocked(api.get).mock.calls.some(([url]) => String(url).includes('bank-accounts'))).toBe(false);
  });

  it('keeps the entered form after a validation failure', async () => {
    vi.mocked(api.post).mockRejectedValue(new Error('validation'));
    const close = vi.fn();
    render(<QuickBuyModal open onClose={close} onSuccess={vi.fn()} onIncomplete={vi.fn()} />, { wrapper });
    const user = await prepareBuy();
    await user.click(screen.getByRole('button', { name: /บันทึก \+ ออกใบสำคัญ/ }));
    await waitFor(() => expect(api.post).toHaveBeenCalled());
    expect(close).not.toHaveBeenCalled();
    expect(screen.getByText('ผู้ขายทดสอบ')).toBeInTheDocument();
  });

  it('requires fresh identity confirmation and signature after going back to edit the purchase', async () => {
    render(<QuickBuyModal open onClose={vi.fn()} onSuccess={vi.fn()} onIncomplete={vi.fn()} />, { wrapper });
    const user = await prepareBuy();
    await user.click(screen.getByRole('button', { name: /ย้อนกลับ/ }));
    await user.clear(screen.getByPlaceholderText('0'));
    await user.type(screen.getByPlaceholderText('0'), '6000');
    await user.click(screen.getByRole('button', { name: /ถัดไป/ }));
    expect(screen.getByRole('checkbox', { name: /ตรวจบัตรประชาชน/ })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: /ผู้ขายได้อ่านและยอมรับ/ })).not.toBeChecked();
    await user.click(screen.getByRole('checkbox', { name: /ตรวจบัตรประชาชน/ }));
    await user.click(screen.getByRole('checkbox', { name: /ผู้ขายได้อ่านและยอมรับ/ }));
    await user.click(screen.getByRole('button', { name: /บันทึก \+ ออกใบสำคัญ/ }));
    expect(api.post).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'ลงลายเซ็นทดสอบ' }));
    await user.click(screen.getByRole('button', { name: /บันทึก \+ ออกใบสำคัญ/ }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/trade-ins/quick-buy', expect.objectContaining({ agreedPrice: 6000 })));
  });

  it('opens the existing record after a partial failure instead of offering to submit a new purchase', async () => {
    vi.mocked(api.post).mockRejectedValue({ isAxiosError: true, response: { data: { tradeInId: 'partial-1' } } });
    const close = vi.fn();
    const incomplete = vi.fn();
    render(<QuickBuyModal open onClose={close} onSuccess={vi.fn()} onIncomplete={incomplete} />, { wrapper });
    const user = await prepareBuy();
    await user.click(screen.getByRole('button', { name: /บันทึก \+ ออกใบสำคัญ/ }));
    await waitFor(() => expect(incomplete).toHaveBeenCalledWith('partial-1'));
    expect(close).toHaveBeenCalledOnce();
  });

  it('accepts EXCHANGE as credit without a payout selector or stale seller bank fields', async () => {
    const confirm = vi.fn();
    const change = vi.fn();
    const item: TradeIn = { id: 'exchange-1', status: 'APPRAISED', branchId: 'branch-1', flow: 'EXCHANGE',
      deviceBrand: 'Apple', deviceModel: 'iPhone 15', deviceStorage: null, deviceCondition: null, imei: '359000000000082', serialNumber: 'HANDOFF-SN-82',
      estimatedValue: 5500, offeredPrice: 5500, agreedPrice: null, sellerName: 'ผู้ขาย', sellerPhone: null,
      voucherNumber: null, voucherPdfUrl: null, createdAt: '2026-09-08', customer: null };
    render(<AcceptModal item={item} form={{ ...EMPTY_ACCEPT_FORM, idCardVerified: true, sellerConsentSigned: true,
      sellerSignatureBase64: 'signature', paymentMethod: 'TRANSFER', transferBankName: 'STALE', transferAccountName: 'STALE', transferAccountNumber: '123' }}
      isPending={false} onChange={change} onConfirm={confirm} onClose={vi.fn()} />, { wrapper });
    expect(screen.getByLabelText('IMEI')).toHaveValue('359000000000082');
    expect(screen.getByLabelText('Serial Number')).toHaveValue('HANDOFF-SN-82');
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    for (const clause of TRADE_IN_DECLARATION_CLAUSES) expect(screen.getByText(clause)).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'ยืนยันรับเครื่องเทิร์น' }));
    expect(confirm).toHaveBeenCalledWith('exchange-1', expect.objectContaining({
      imei: '359000000000082', serialNumber: 'HANDOFF-SN-82',
      paymentMethod: 'TRADE_IN_CREDIT', transferBankName: '', transferAccountName: '', transferAccountNumber: '',
      declarationVersion: TRADE_IN_DECLARATION_VERSION,
    }));
    await userEvent.type(screen.getByLabelText('Serial Number'), 'A');
    expect(change).toHaveBeenLastCalledWith({ sellerConsentSigned: false, sellerSignatureBase64: '' });
  });

  it('gives SALES a valid product link and asks a manager to set prices', () => {
    auth.user.role = 'SALES';
    render(<TradeInProductHandoff productId="received-product" />, { wrapper });
    expect(screen.getByRole('link', { name: 'เปิดเครื่อง ดูรูปและราคา' })).toHaveAttribute('href', '/products/received-product?zone=shop');
    expect(screen.getByText(/ให้ผู้จัดการตรวจข้อมูลสภาพเครื่องกับตั้งราคาขาย/)).toBeInTheDocument();
    expect(screen.getByText('รับเครื่องแล้ว — รอเตรียมเครื่องก่อนขาย')).toBeInTheDocument();
  });
});
