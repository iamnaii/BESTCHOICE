import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import QuickBuyModal from './QuickBuyModal';
import AcceptModal from '@/pages/TradeInPage/components/AcceptModal';
import { EMPTY_ACCEPT_FORM, type TradeIn } from '@/pages/TradeInPage/types';
import TradeInProductHandoff from './TradeInProductHandoff';
import api from '@/lib/api';
import { readSmartCard, type SmartCardData } from '@/lib/cardReader';
import { TRADE_IN_DECLARATION_CLAUSES, TRADE_IN_DECLARATION_VERSION, type BuybackQuestionsResponse, type BuybackQuoteResult } from '@installment/shared';

const auth = vi.hoisted(() => ({ user: { id: 'staff-1', role: 'OWNER', branchId: 'branch-1' } }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('@/lib/api', () => ({ default: { get: vi.fn(), post: vi.fn() }, getErrorMessage: () => 'บันทึกไม่สำเร็จ' }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/api/contacts', () => ({ contactsApi: { detail: async () => ({ phone: '0000000000' }) } }));
vi.mock('@/lib/cardReader', () => ({ readSmartCard: vi.fn() }));
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

const catalog = { models: [{ model: 'iPhone 15', storages: [
  { storage: '128GB', maxPrice: '10000' }, { storage: '256GB', maxPrice: '12000' },
] }, { model: 'iPhone 17', storages: [{ storage: '256GB', maxPrice: '20000' }] }] };
const questionnaire: BuybackQuestionsResponse = {
  bonusPct: '10', pricingMode: 'MAX_PERCENT_EXACT', source: 'https://www.yellobe.com/buy',
  capturedAt: '2026-09-08T00:00:00Z', eligibilityRequired: true,
  eligibilityText: 'เครื่องไม่ติดล็อค iCloud ไม่ติดระบบผ่อนชำระ สามารถรีเซ็ทและใช้งานได้ปกติ',
  questions: [
    { id: 'screen', key: 'screen', title: 'หน้าจอ', helpText: null, selectType: 'SINGLE', choices: [
      { id: 'screen-good', label: 'หน้าจอสมบูรณ์', deductType: 'PERCENT', deductValue: '0' },
      { id: 'screen-scratch', label: 'หน้าจอมีรอย', deductType: 'PERCENT', deductValue: '15' },
    ] },
    { id: 'issues', key: 'issues', title: 'การใช้งาน', helpText: null, selectType: 'MULTI', choices: [
      { id: 'camera', label: 'กล้องมีฝ้า', deductType: 'PERCENT', deductValue: '22' },
    ] },
  ],
};
const completeAnswers = [{ questionKey: 'screen', choiceIds: ['screen-good'] }, { questionKey: 'issues', choiceIds: [] }];
type Preview = BuybackQuoteResult & { previewToken: string };
const quoted: Preview = { available: true, grade: 'B', price: '5000.00', cashPrice: '5000.00', exchangePrice: '5500.00', bonusPct: '10', previewToken: 'a'.repeat(64),
  breakdown: { maxPrice: '10000', fixedTotal: '0', pctTotal: '50', price: '5000.00', lines: [] } };
const received = { id: 'trade-in-1', productId: 'received-product', productStatus: 'PHOTO_PENDING', voucherNumber: 'EXP-1' };
let previewResponse: () => Promise<{ data: Preview }>;
let purchaseResponse: () => Promise<{ data: typeof received }>;
const purchaseCalls = () => vi.mocked(api.post).mock.calls.filter(([url]) => url === '/trade-ins/quick-buy');
const previewCalls = () => vi.mocked(api.post).mock.calls.filter(([url]) => url === '/trade-ins/quick-buy/preview');
const nextButton = () => screen.getByRole('button', { name: /ถัดไป/ });
const backButton = () => screen.getByRole('button', { name: /ย้อนกลับ/ });
const saveButton = () => screen.getByRole('button', { name: /บันทึก \+ ออกใบสำคัญ/ });

// Radix Select uses browser APIs that jsdom does not implement.
const selectBrowserAPIs = ['hasPointerCapture', 'scrollIntoView'] as const;
const originalBrowserAPIs = selectBrowserAPIs.map((name) => Object.getOwnPropertyDescriptor(HTMLElement.prototype, name));
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', { configurable: true, value: () => false });
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: () => {} });
});
afterAll(() => {
  selectBrowserAPIs.forEach((name, index) => {
    const original = originalBrowserAPIs[index];
    if (original) Object.defineProperty(HTMLElement.prototype, name, original);
    else Reflect.deleteProperty(HTMLElement.prototype, name);
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { resolve, promise };
}

async function selectPurchaseOption(user: ReturnType<typeof userEvent.setup>, label: string, option: string) {
  const trigger = await screen.findByRole('combobox', { name: label });
  await waitFor(() => expect(trigger).toBeEnabled());
  await user.click(trigger);
  await user.click(await screen.findByRole('option', { name: option }));
}
async function selectDevice(user: ReturnType<typeof userEvent.setup>) {
  await selectPurchaseOption(user, 'รุ่น iPhone *', 'iPhone 15');
  await selectPurchaseOption(user, 'ความจุ *', '128GB');
  await user.type(screen.getByLabelText('IMEI'), '359000000000081');
  await user.type(screen.getByLabelText('Serial Number'), '  BC-SN-00081  ');
}
async function answerQuestions(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('radio', { name: 'หน้าจอสมบูรณ์' }));
  await user.click(screen.getByRole('checkbox', { name: 'ตรวจแล้ว ไม่พบปัญหา' }));
  await user.click(screen.getByRole('checkbox', { name: 'ยืนยันเครื่องผ่านเงื่อนไขรับซื้อ' }));
  await waitFor(() => expect(previewCalls()).toHaveLength(1));
  await waitFor(() => expect(nextButton()).toBeEnabled());
}
async function preparePrice(user: ReturnType<typeof userEvent.setup>) {
  await selectDevice(user);
  await user.click(nextButton());
  await answerQuestions(user);
}
async function fillSeller(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'เลือกผู้ขายทดสอบ' }));
  await user.type(screen.getByLabelText('เลขบัตรประชาชน *'), '0000000000001');
  await user.type(screen.getByPlaceholderText('123/45'), '1 Test Road');
}
async function prepareBuy() {
  const user = userEvent.setup();
  await preparePrice(user);
  await user.click(nextButton());
  await fillSeller(user);
  await user.click(nextButton());
  await user.click(screen.getByRole('checkbox', { name: /ตรวจบัตรประชาชน/ }));
  await user.click(screen.getByRole('checkbox', { name: /ผู้ขายได้อ่านและยอมรับ/ }));
  await user.click(screen.getByRole('button', { name: 'ลงลายเซ็นทดสอบ' }));
  return user;
}

describe('Counter purchase, seller payment and stock handoff', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    auth.user.role = 'OWNER';
    vi.mocked(api.get).mockImplementation(async (url) => ({ data: String(url).endsWith('/catalog') ? catalog
      : String(url).endsWith('/questions') ? questionnaire
      : String(url).includes('check-imei') ? { result: 'clean', occurrences: [] }
      : String(url).includes('seller-history') ? { found: false }
      : [{ id: 'branch-1', name: 'สาขาทดสอบ' }] }));
    previewResponse = async () => ({ data: quoted });
    purchaseResponse = async () => ({ data: received });
    vi.mocked(api.post).mockImplementation((url) => String(url).endsWith('/preview') ? previewResponse() : purchaseResponse());
  });

  it('starts with the device and shows its server price before asking for a seller', async () => {
    render(<QuickBuyModal open onClose={vi.fn()} onSuccess={vi.fn()} onIncomplete={vi.fn()} />, { wrapper });
    const user = userEvent.setup();
    expect(screen.getByText('ขั้นที่ 1 / 4')).toBeVisible();
    expect(screen.getByLabelText('เครื่องไทย / เครื่องนอก')).toBeVisible();
    expect(screen.queryByLabelText('ประกันร้าน (วัน)')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('ผู้รับประกันและเงื่อนไขความคุ้มครอง')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'เลือกผู้ขายทดสอบ' })).not.toBeInTheDocument();
    await selectDevice(user);
    await user.click(nextButton());
    expect(screen.getByText('ขั้นที่ 2 / 4')).toBeVisible();
    expect(screen.queryByLabelText('เลขบัตรประชาชน *')).not.toBeInTheDocument();
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(nextButton()).toBeDisabled();
    await answerQuestions(user);
    expect(previewCalls()[0][1]).toEqual({
      deviceBrand: 'Apple', deviceModel: 'iPhone 15', deviceStorage: '128GB',
      answers: completeAnswers, deviceEligibilityConfirmed: true,
    });
    expect(screen.getAllByText('฿5,000').length).toBeGreaterThan(0);
    expect(purchaseCalls()).toHaveLength(0);
    await user.click(nextButton());
    expect(screen.getByText('ขั้นที่ 3 / 4')).toBeVisible();
    expect(screen.getByRole('button', { name: 'เลือกผู้ขายทดสอบ' })).toBeVisible();
  });

  it('preserves inspection answers on Back but clears them and the quote when storage changes', async () => {
    render(<QuickBuyModal open onClose={vi.fn()} onSuccess={vi.fn()} onIncomplete={vi.fn()} />, { wrapper });
    const user = userEvent.setup();
    await preparePrice(user);
    await user.click(nextButton());
    await user.click(backButton());
    expect(screen.getByRole('radio', { name: 'หน้าจอสมบูรณ์' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'ตรวจแล้ว ไม่พบปัญหา' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'ยืนยันเครื่องผ่านเงื่อนไขรับซื้อ' })).toBeChecked();
    await waitFor(() => expect(nextButton()).toBeEnabled());
    await user.click(backButton());
    await selectPurchaseOption(user, 'ความจุ *', '256GB');
    await user.click(nextButton());
    expect(await screen.findByRole('radio', { name: 'หน้าจอสมบูรณ์' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'ตรวจแล้ว ไม่พบปัญหา' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'ยืนยันเครื่องผ่านเงื่อนไขรับซื้อ' })).not.toBeChecked();
    expect(nextButton()).toBeDisabled();
    expect(screen.queryByText('฿5,000')).not.toBeInTheDocument();
    expect(purchaseCalls()).toHaveLength(0);
  });

  it('requires explicit no-issues and device eligibility before calculating a price', async () => {
    render(<QuickBuyModal open onClose={vi.fn()} onSuccess={vi.fn()} onIncomplete={vi.fn()} />, { wrapper });
    const user = userEvent.setup();
    await selectDevice(user); await user.click(nextButton());
    await user.click(await screen.findByRole('radio', { name: 'หน้าจอสมบูรณ์' }));
    await user.click(screen.getByRole('checkbox', { name: 'ตรวจแล้ว ไม่พบปัญหา' }));
    expect(previewCalls()).toHaveLength(0);
    expect(nextButton()).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: 'ยืนยันเครื่องผ่านเงื่อนไขรับซื้อ' }));
    await waitFor(() => expect(nextButton()).toBeEnabled());
    await user.click(screen.getByRole('checkbox', { name: 'ตรวจแล้ว ไม่พบปัญหา' }));
    expect(nextButton()).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: 'กล้องมีฝ้า' }));
    await waitFor(() => expect(nextButton()).toBeEnabled());
    await user.click(screen.getByRole('checkbox', { name: 'กล้องมีฝ้า' }));
    expect(screen.getByRole('checkbox', { name: 'ตรวจแล้ว ไม่พบปัญหา' })).not.toBeChecked();
    expect(nextButton()).toBeDisabled();
  });

  it('requires device identifiers or an explicit missing-identifier reason before assessment', async () => {
    render(<QuickBuyModal open onClose={vi.fn()} onSuccess={vi.fn()} onIncomplete={vi.fn()} />, { wrapper });
    const user = userEvent.setup();
    await selectPurchaseOption(user, 'รุ่น iPhone *', 'iPhone 15');
    await selectPurchaseOption(user, 'ความจุ *', '128GB');
    await user.click(nextButton());
    expect(screen.getByText('ขั้นที่ 1 / 4')).toBeVisible();
    await user.type(screen.getByLabelText('IMEI'), '359000000000081');
    await user.click(nextButton());
    expect(screen.getByText('ขั้นที่ 1 / 4')).toBeVisible();
    await user.type(screen.getByLabelText('เหตุผลที่ไม่มี Serial Number *'), 'อ่านหมายเลขไม่ได้');
    await user.click(nextButton());
    expect(screen.getByText('ขั้นที่ 2 / 4')).toBeVisible();
    expect(previewCalls()).toHaveLength(0);
  });

  it('requires seller contact, valid identity and address after pricing before payment', async () => {
    render(<QuickBuyModal open onClose={vi.fn()} onSuccess={vi.fn()} onIncomplete={vi.fn()} />, { wrapper });
    const user = userEvent.setup();
    await preparePrice(user); await user.click(nextButton());
    await user.click(nextButton());
    expect(screen.getByText('ขั้นที่ 3 / 4')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'เลือกผู้ขายทดสอบ' }));
    await user.type(screen.getByLabelText('เลขบัตรประชาชน *'), '0000000000002');
    await user.click(nextButton());
    expect(screen.getByText('ขั้นที่ 3 / 4')).toBeVisible();
    await user.clear(screen.getByLabelText('เลขบัตรประชาชน *'));
    await user.type(screen.getByLabelText('เลขบัตรประชาชน *'), '0000000000001');
    await user.click(nextButton());
    expect(screen.getByText('ขั้นที่ 3 / 4')).toBeVisible();
    await user.type(screen.getByPlaceholderText('123/45'), '1 Test Road');
    await user.click(nextButton());
    expect(screen.getByText('ขั้นที่ 4 / 4')).toBeVisible();
    await user.click(saveButton());
    expect(purchaseCalls()).toHaveLength(0);
  });

  it('retries a failed price lookup without clearing answers or creating a purchase', async () => {
    previewResponse = vi.fn().mockRejectedValueOnce(new Error('preview failed')).mockResolvedValue({ data: quoted });
    render(<QuickBuyModal open onClose={vi.fn()} onSuccess={vi.fn()} onIncomplete={vi.fn()} />, { wrapper });
    const user = userEvent.setup();
    await selectDevice(user); await user.click(nextButton());
    await user.click(await screen.findByRole('radio', { name: 'หน้าจอสมบูรณ์' }));
    await user.click(screen.getByRole('checkbox', { name: 'ตรวจแล้ว ไม่พบปัญหา' }));
    await user.click(screen.getByRole('checkbox', { name: 'ยืนยันเครื่องผ่านเงื่อนไขรับซื้อ' }));
    await screen.findByRole('button', { name: 'คำนวณราคาใหม่' });
    expect(nextButton()).toBeDisabled();
    expect(screen.getByRole('radio', { name: 'หน้าจอสมบูรณ์' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'ตรวจแล้ว ไม่พบปัญหา' })).toBeChecked();
    await user.click(screen.getByRole('button', { name: 'คำนวณราคาใหม่' }));
    await waitFor(() => expect(nextButton()).toBeEnabled());
    expect(previewCalls()).toHaveLength(2);
    expect(previewCalls()[1][1]).toEqual(previewCalls()[0][1]);
    expect(purchaseCalls()).toHaveLength(0);
  });

  it('discards a late price preview after inspection answers change', async () => {
    const old = deferred<{ data: Preview }>();
    const current = deferred<{ data: Preview }>();
    previewResponse = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    render(<QuickBuyModal open onClose={vi.fn()} onSuccess={vi.fn()} onIncomplete={vi.fn()} />, { wrapper });
    const user = userEvent.setup();
    await selectDevice(user); await user.click(nextButton());
    await user.click(await screen.findByRole('radio', { name: 'หน้าจอสมบูรณ์' }));
    await user.click(screen.getByRole('checkbox', { name: 'ตรวจแล้ว ไม่พบปัญหา' }));
    await user.click(screen.getByRole('checkbox', { name: 'ยืนยันเครื่องผ่านเงื่อนไขรับซื้อ' }));
    await waitFor(() => expect(previewCalls()).toHaveLength(1));
    await user.click(screen.getByRole('radio', { name: 'หน้าจอมีรอย' }));
    await waitFor(() => expect(previewCalls()).toHaveLength(2));
    await act(async () => { current.resolve({ data: { ...quoted, price: '4100', cashPrice: '4100', previewToken: 'b'.repeat(64) } }); });
    await waitFor(() => expect(nextButton()).toBeEnabled());
    await act(async () => { old.resolve({ data: { ...quoted, price: '9999', cashPrice: '9999' } }); });
    expect(screen.queryByText('฿9,999')).not.toBeInTheDocument();
    expect(screen.getAllByText('฿4,100').length).toBeGreaterThan(0);
    await user.click(nextButton()); await fillSeller(user); await user.click(nextButton());
    await user.click(screen.getByRole('checkbox', { name: /ตรวจบัตรประชาชน/ }));
    await user.click(screen.getByRole('checkbox', { name: /ผู้ขายได้อ่านและยอมรับ/ }));
    await user.click(screen.getByRole('button', { name: 'ลงลายเซ็นทดสอบ' }));
    await user.click(saveButton());
    await waitFor(() => expect(purchaseCalls()).toHaveLength(1));
    expect(purchaseCalls()[0][1]).toEqual(expect.objectContaining({ previewToken: 'b'.repeat(64), agreedPrice: 4100,
      answers: [{ questionKey: 'screen', choiceIds: ['screen-scratch'] }, completeAnswers[1]] }));
  });

  it('blocks duplicate purchase, back and close while saving', async () => {
    const pending = deferred<{ data: typeof received }>();
    purchaseResponse = () => pending.promise;
    const close = vi.fn();
    render(<QuickBuyModal open onClose={close} onSuccess={vi.fn()} onIncomplete={vi.fn()} />, { wrapper });
    const user = await prepareBuy();
    await user.dblClick(saveButton());
    await waitFor(() => expect(purchaseCalls()).toHaveLength(1));
    expect(backButton()).toBeDisabled();
    expect(screen.getByRole('button', { name: 'ปิด' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: /ตรวจบัตรประชาชน/ })).toBeDisabled();
    expect(screen.getByRole('radio', { name: 'โอนเงิน' })).toBeDisabled();
    expect(close).not.toHaveBeenCalled();
    await act(async () => { pending.resolve({ data: received }); });
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
  });

  it('refreshes a stale server quote after 409 and requires a fresh signature without losing seller data', async () => {
    const refreshed = deferred<{ data: Preview }>();
    previewResponse = vi.fn().mockResolvedValueOnce({ data: quoted }).mockReturnValueOnce(refreshed.promise);
    purchaseResponse = vi.fn().mockRejectedValueOnce({ isAxiosError: true, response: {
      status: 409, data: { code: 'QUICK_BUY_QUOTE_CHANGED', message: 'ราคาประเมินเปลี่ยนแล้ว' },
    } }).mockResolvedValue({ data: received });
    const success = vi.fn();
    render(<QuickBuyModal open onClose={vi.fn()} onSuccess={success} onIncomplete={vi.fn()} />, { wrapper });
    const user = await prepareBuy();
    await user.click(saveButton());
    await screen.findByText('ขั้นที่ 2 / 4');
    await waitFor(() => expect(previewCalls()).toHaveLength(2));
    expect(nextButton()).toBeDisabled();
    expect(screen.getByRole('radio', { name: 'หน้าจอสมบูรณ์' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'ตรวจแล้ว ไม่พบปัญหา' })).toBeChecked();
    expect(vi.mocked(api.get).mock.calls.filter(([url]) => url === '/trade-ins/quick-buy/questions')).toHaveLength(2);
    await act(async () => { refreshed.resolve({ data: { ...quoted, price: '4800', cashPrice: '4800', previewToken: 'c'.repeat(64) } }); });
    await waitFor(() => expect(nextButton()).toBeEnabled());
    await user.click(nextButton());
    expect(screen.getByLabelText('ชื่อผู้ขายตามบัตรประชาชน *')).toHaveValue('ผู้ขายทดสอบ');
    expect(screen.getByLabelText('เลขบัตรประชาชน *')).toHaveValue('0000000000001');
    expect(screen.getByPlaceholderText('123/45')).toHaveValue('1 Test Road');
    await user.click(nextButton());
    expect(screen.getByRole('checkbox', { name: /ตรวจบัตรประชาชน/ })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: /ผู้ขายได้อ่านและยอมรับ/ })).not.toBeChecked();
    await user.click(screen.getByRole('checkbox', { name: /ตรวจบัตรประชาชน/ }));
    await user.click(screen.getByRole('checkbox', { name: /ผู้ขายได้อ่านและยอมรับ/ }));
    await user.click(saveButton());
    expect(purchaseCalls()).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'ลงลายเซ็นทดสอบ' }));
    await user.click(saveButton());
    await waitFor(() => expect(success).toHaveBeenCalledOnce());
    expect(purchaseCalls()[1][1]).toEqual(expect.objectContaining({ agreedPrice: 4800, previewToken: 'c'.repeat(64), sellerName: 'ผู้ขายทดสอบ' }));
    expect((purchaseCalls()[1][1] as { requestId: string }).requestId).toBe((purchaseCalls()[0][1] as { requestId: string }).requestId);
  });

  it('ignores a delayed card-reader result after leaving the seller step', async () => {
    const card = deferred<SmartCardData>();
    vi.mocked(readSmartCard).mockReturnValueOnce(card.promise);
    render(<QuickBuyModal open onClose={vi.fn()} onSuccess={vi.fn()} onIncomplete={vi.fn()} />, { wrapper });
    const user = userEvent.setup();
    await preparePrice(user); await user.click(nextButton()); await fillSeller(user);
    await user.click(screen.getByRole('button', { name: 'อ่านบัตรประชาชน' }));
    await waitFor(() => expect(readSmartCard).toHaveBeenCalledOnce());
    await user.click(nextButton());
    expect(screen.getByText('ขั้นที่ 4 / 4')).toBeVisible();
    await user.click(screen.getByRole('checkbox', { name: /ตรวจบัตรประชาชน/ }));
    await user.click(screen.getByRole('checkbox', { name: /ผู้ขายได้อ่านและยอมรับ/ }));
    await user.click(screen.getByRole('button', { name: 'ลงลายเซ็นทดสอบ' }));
    await act(async () => { card.resolve({
      nationalId: '0000000000002', prefix: '', firstName: 'ผู้ขายเก่าจากบัตร', lastName: '',
      prefixEn: '', firstNameEn: '', lastNameEn: '', birthDate: '', gender: '', issuer: '', issueDate: '', expiryDate: '', address: '',
      addressStructured: { houseNo: 'OLD ADDRESS', moo: '', village: '', soi: '', road: '', subdistrict: '', district: '', province: '' },
    }); });
    expect(screen.queryByText('ผู้ขายเก่าจากบัตร')).not.toBeInTheDocument();
    expect(screen.getByText('ผู้ขายทดสอบ')).toBeVisible();
    await user.click(saveButton());
    await waitFor(() => expect(purchaseCalls()).toHaveLength(1));
    expect(purchaseCalls()[0][1]).toEqual(expect.objectContaining({ sellerName: 'ผู้ขายทดสอบ', sellerIdCardNumber: '0000000000001', sellerAddress: '1 Test Road' }));
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
      deviceCondition: 'B', deviceBrand: 'Apple', deviceModel: 'iPhone 15', deviceStorage: '128GB',
      answers: completeAnswers, previewToken: quoted.previewToken, deviceEligibilityConfirmed: true,
      imei: '359000000000081', serialNumber: 'BC-SN-00081',
      declarationVersion: TRADE_IN_DECLARATION_VERSION,
      transferAccountNumber: method === 'TRANSFER' ? '1234567890' : undefined,
    }));
    expect(purchaseCalls()[0][1]).not.toHaveProperty('shopWarrantyDays');
    expect(purchaseCalls()[0][1]).not.toHaveProperty('warrantyTerms');
    expect(vi.mocked(api.get).mock.calls.some(([url]) => String(url).includes('bank-accounts'))).toBe(false);
  });

  it('keeps the entered form after a validation failure', async () => {
    purchaseResponse = async () => { throw new Error('validation'); };
    const close = vi.fn();
    render(<QuickBuyModal open onClose={close} onSuccess={vi.fn()} onIncomplete={vi.fn()} />, { wrapper });
    const user = await prepareBuy();
    await user.click(screen.getByRole('button', { name: /บันทึก \+ ออกใบสำคัญ/ }));
    await waitFor(() => expect(purchaseCalls()).toHaveLength(1));
    expect(close).not.toHaveBeenCalled();
    expect(screen.getByText('ผู้ขายทดสอบ')).toBeInTheDocument();
  });

  it('retries a lost response using the same request key and stores no seller evidence', async () => {
    purchaseResponse = vi.fn().mockRejectedValueOnce(new Error('connection lost')).mockResolvedValue({ data: received });
    render(<QuickBuyModal open onClose={vi.fn()} onSuccess={vi.fn()} onIncomplete={vi.fn()} />, { wrapper });
    const user = await prepareBuy();
    const save = screen.getByRole('button', { name: /บันทึก \+ ออกใบสำคัญ/ });
    await user.click(save);
    await waitFor(() => expect(save).toBeEnabled());
    const key = (purchaseCalls()[0][1] as { requestId: string }).requestId;
    expect(key).toMatch(/^[a-f0-9-]{36}$/);
    expect(sessionStorage.getItem('bc:quick-buy:pending:staff-1')).toBe(key);
    await user.click(save);
    await waitFor(() => expect(purchaseCalls()).toHaveLength(2));
    expect((purchaseCalls()[1][1] as { requestId: string }).requestId).toBe(key);
    await waitFor(() => expect(sessionStorage.getItem('bc:quick-buy:pending:staff-1')).toBeNull());
  });

  it('recovers an already-created purchase on reopen without posting another purchase', async () => {
    const key = '6635859c-cd9e-4f73-91ad-5c5037300a39';
    sessionStorage.setItem('bc:quick-buy:pending:staff-1', key);
    vi.mocked(api.get).mockImplementation(async (url) => ({ data: String(url).includes('/requests/')
      ? { found: true, id: 'original-purchase' } : [{ id: 'branch-1', name: 'สาขาทดสอบ' }] }));
    const incomplete = vi.fn();
    render(<QuickBuyModal open onClose={vi.fn()} onSuccess={vi.fn()} onIncomplete={incomplete} />, { wrapper });
    await waitFor(() => expect(incomplete).toHaveBeenCalledWith('original-purchase'));
    expect(api.post).not.toHaveBeenCalled();
    expect(sessionStorage.getItem('bc:quick-buy:pending:staff-1')).toBeNull();
  });

  it('keeps the pending key when the first request has not reached the server yet', async () => {
    const key = '6635859c-cd9e-4f73-91ad-5c5037300a39';
    sessionStorage.setItem('bc:quick-buy:pending:staff-1', key);
    vi.mocked(api.get).mockImplementation(async (url) => ({ data: String(url).includes('/requests/')
      ? { found: false } : String(url).endsWith('/catalog') ? catalog : String(url).endsWith('/questions') ? questionnaire : [{ id: 'branch-1', name: 'สาขาทดสอบ' }] }));
    render(<QuickBuyModal open onClose={vi.fn()} onSuccess={vi.fn()} onIncomplete={vi.fn()} />, { wrapper });
    const user = await prepareBuy();
    await user.click(screen.getByRole('button', { name: /บันทึก \+ ออกใบสำคัญ/ }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/trade-ins/quick-buy', expect.objectContaining({ requestId: key })));
  });

  it('requires fresh identity confirmation and signature after editing seller evidence', async () => {
    render(<QuickBuyModal open onClose={vi.fn()} onSuccess={vi.fn()} onIncomplete={vi.fn()} />, { wrapper });
    const user = await prepareBuy();
    await user.click(backButton());
    await user.clear(screen.getByLabelText('เบอร์โทรผู้ขาย *'));
    await user.type(screen.getByLabelText('เบอร์โทรผู้ขาย *'), '0812345678');
    await user.click(nextButton());
    expect(screen.getByRole('checkbox', { name: /ตรวจบัตรประชาชน/ })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: /ผู้ขายได้อ่านและยอมรับ/ })).not.toBeChecked();
    await user.click(screen.getByRole('checkbox', { name: /ตรวจบัตรประชาชน/ }));
    await user.click(screen.getByRole('checkbox', { name: /ผู้ขายได้อ่านและยอมรับ/ }));
    await user.click(saveButton());
    expect(purchaseCalls()).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'ลงลายเซ็นทดสอบ' }));
    await user.click(saveButton());
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/trade-ins/quick-buy', expect.objectContaining({ sellerPhone: '0812345678', agreedPrice: 5000 })));
  });

  it('opens the existing record after a partial failure instead of offering to submit a new purchase', async () => {
    purchaseResponse = async () => { throw { isAxiosError: true, response: { data: { tradeInId: 'partial-1' } } }; };
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
      estimatedValue: 5500, offeredPrice: 5500, agreedPrice: null, sellerName: 'ผู้ขาย', sellerPhone: '0000000000', sellerIdCardNumber: '0000000000001', sellerAddress: 'TEST ADDRESS',
      voucherNumber: null, voucherPdfUrl: null, createdAt: '2026-09-08', customer: null };
    render(<AcceptModal item={item} form={{ ...EMPTY_ACCEPT_FORM, idCardVerified: true, sellerConsentSigned: true,
      sellerSignatureBase64: 'signature', paymentMethod: 'TRANSFER', transferBankName: 'STALE', transferAccountName: 'STALE', transferAccountNumber: '123' }}
      isPending={false} onChange={change} onConfirm={confirm} onClose={vi.fn()} />, { wrapper });
    expect(screen.getByLabelText('IMEI')).toHaveValue('359000000000082');
    expect(screen.getByLabelText('Serial Number')).toHaveValue('HANDOFF-SN-82');
    expect(screen.queryByLabelText('ประกันร้าน (วัน)')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('ผู้รับประกันและเงื่อนไขความคุ้มครอง')).not.toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    for (const clause of TRADE_IN_DECLARATION_CLAUSES) expect(screen.getByText(clause)).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'ยืนยันรับเครื่องเทิร์น' }));
    expect(confirm).toHaveBeenCalledWith('exchange-1', expect.objectContaining({
      imei: '359000000000082', serialNumber: 'HANDOFF-SN-82',
      paymentMethod: 'TRADE_IN_CREDIT', transferBankName: '', transferAccountName: '', transferAccountNumber: '',
      declarationVersion: TRADE_IN_DECLARATION_VERSION,
    }));
    await userEvent.type(screen.getByLabelText('Serial Number'), 'A');
    expect(change).toHaveBeenLastCalledWith({ idCardVerified: false, sellerConsentSigned: false, sellerSignatureBase64: '' });
  });

  it('gives SALES a valid product link and asks a manager to set prices', () => {
    auth.user.role = 'SALES';
    render(<TradeInProductHandoff productId="received-product" />, { wrapper });
    expect(screen.getByRole('link', { name: 'เปิดเครื่อง ดูรูปและราคา' })).toHaveAttribute('href', '/products/received-product?zone=shop');
    expect(screen.getByText(/ให้ผู้จัดการตรวจข้อมูลสภาพเครื่องกับตั้งราคาขาย/)).toBeInTheDocument();
    expect(screen.getByText('รับเครื่องแล้ว — รอเตรียมเครื่องก่อนขาย')).toBeInTheDocument();
  });
});
