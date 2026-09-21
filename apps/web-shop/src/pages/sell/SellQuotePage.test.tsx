import '@testing-library/jest-dom/vitest';
import type { ReactNode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BuybackQuestionsResponse, BuybackQuoteResult } from '@/types/buyback';
import SellQuotePage from './SellQuotePage';

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), track: vi.fn(), error: vi.fn(), success: vi.fn() }));
vi.mock('@/lib/api', () => ({ api: { get: mocks.get, post: mocks.post } }));
vi.mock('@/hooks/useTrackEvent', () => ({ useTrackEvent: () => mocks.track }));
vi.mock('sonner', () => ({ toast: { error: mocks.error, success: mocks.success } }));
vi.mock('@/components/layout/ShopLayout', () => ({ default: ({ children }: { children: ReactNode }) => <main>{children}</main> }));

const eligibility = 'เครื่องไม่ติดล็อก iCloud หรือระบบผ่อนชำระ สามารถรีเซ็ตและใช้งานได้ปกติ';
const config: BuybackQuestionsResponse = {
  pricingMode: 'MAX_PERCENT_EXACT', source: 'https://www.yellobe.com/buy', capturedAt: '2026-09-08T10:00:00Z',
  bonusPct: '10', eligibilityRequired: true, eligibilityText: eligibility,
  questions: [
    { id: 'body', key: 'body', title: 'ตัวเครื่อง', selectType: 'SINGLE', helpText: null, choices: [
      { id: 'good', label: 'ตัวเครื่องปกติ', deductType: 'PERCENT', deductValue: '0', helpText: 'ตรวจทุกมุมก่อนเลือก' },
      { id: 'scratch', label: 'มีรอย', deductType: 'PERCENT', deductValue: '15' },
    ] },
    { id: 'functions', key: 'functions', title: 'การใช้งาน', selectType: 'MULTI', helpText: null, choices: [
      { id: 'sound', label: 'ลำโพงผิดปกติ', deductType: 'PERCENT', deductValue: '22' },
      { id: 'camera', label: 'กล้องผิดปกติ', deductType: 'PERCENT', deductValue: '37' },
    ] },
  ],
};
const result: BuybackQuoteResult = { available: true, price: '4321.65', cashPrice: '4321.65', exchangePrice: '4750', bonusPct: '10', grade: 'A',
  breakdown: { maxPrice: '5001', fixedTotal: '0', pctTotal: '0', price: '4321.65', lines: [
    { label: 'การหักที่ไม่ได้ใช้', deductType: 'PERCENT', deductValue: '15', amount: '750', applied: false },
  ] } };
const catalog = { models: [
  { model: 'iPhone 12', storages: [{ storage: '64GB', maxPrice: '5001' }, { storage: '128GB', maxPrice: '6000' }] },
  { model: 'iPhone 17', storages: [{ storage: '256GB', maxPrice: '20000' }] },
] };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/sell/quote']}><Routes>
    <Route path="/sell/quote" element={<SellQuotePage />} />
    <Route path="/sell/:id" element={<div>ส่งข้อมูลสำเร็จแล้ว</div>} />
  </Routes></MemoryRouter></QueryClientProvider>);
  return client;
}
async function device() {
  fireEvent.change(await screen.findByLabelText('รุ่น'), { target: { value: 'iPhone 12' } });
  fireEvent.change(screen.getByLabelText('ความจุ'), { target: { value: '64GB' } });
  await screen.findByRole('radio', { name: 'ตัวเครื่องปกติ' });
}
async function answerAll() {
  fireEvent.click(screen.getByRole('radio', { name: 'ตัวเครื่องปกติ' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'ไม่มีอาการเหล่านี้' }));
  fireEvent.click(screen.getByRole('checkbox', { name: eligibility }));
}
function viewPrice() { fireEvent.click(screen.getAllByRole('button', { name: 'ดูราคา' })[0]); }
async function seller() {
  fireEvent.click(await screen.findByRole('radio', { name: /ขายรับเงินสด/ }));
  fireEvent.change(screen.getByLabelText(/ชื่อ-นามสกุล/), { target: { value: 'ลูกค้าทดสอบ' } });
  fireEvent.change(screen.getByLabelText(/เบอร์โทร/), { target: { value: '0812345678' } });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.get.mockImplementation((url: string) => Promise.resolve({ data: url.endsWith('/catalog') ? catalog : config }));
  mocks.post.mockResolvedValue({ data: result });
});

describe('SellQuotePage scoped assessment', () => {
  it('labels AppleHouse as the benchmark and shop rules as the deductions', async () => {
    mocks.get.mockImplementation((url: string) => Promise.resolve({ data: url.endsWith('/catalog') ? catalog : {
      ...config, source: 'https://applehouseth.com/', pricingMode: 'SUM_PERCENT_FLOOR10', eligibilityRequired: false,
    } }));
    mount();
    await device();
    expect(screen.getByText(/ราคากลางอ้างอิง AppleHouse/)).toHaveTextContent('หักสภาพตามเกณฑ์ร้าน');
    expect(screen.queryByText(/Yellobe/)).not.toBeInTheDocument();
  });
  it('requests questions only for the selected device and sends explicit eligibility with server-price quote', async () => {
    mount();
    await screen.findByLabelText('รุ่น');
    expect(mocks.get).toHaveBeenCalledTimes(1);
    await device();
    expect(mocks.get).toHaveBeenCalledWith('/api/shop/buyback/questions', { params: { model: 'iPhone 12', storage: '64GB' } });
    expect(screen.getByText(/เงื่อนไขอ้างอิง Yellobe/)).toHaveTextContent('2569');
    expect(screen.getByRole('radio', { name: 'ตัวเครื่องปกติ' })).toHaveAccessibleName('ตัวเครื่องปกติ');
    expect(screen.getByText('ตรวจทุกมุมก่อนเลือก')).toBeInTheDocument();
    await answerAll();
    expect(screen.getByText('ขายรับเงินสด ~฿5,001')).toBeInTheDocument();
    viewPrice();
    await screen.findByRole('radio', { name: /ขายรับเงินสด/ });
    expect(mocks.post).toHaveBeenCalledWith('/api/shop/buyback/quote', {
      model: 'iPhone 12', storage: '64GB', deviceEligibilityConfirmed: true,
      answers: [{ questionKey: 'body', choiceIds: ['good'] }, { questionKey: 'functions', choiceIds: [] }],
    });
    expect(screen.getByText('฿4,321.65')).toBeInTheDocument();
    expect(screen.getByText('฿4,750')).toBeInTheDocument();
    expect(screen.queryByText('การหักที่ไม่ได้ใช้')).not.toBeInTheDocument();
  });

  it('requires explicit no-issues and resets MULTI completeness when the last issue is unchecked', async () => {
    mount(); await device();
    fireEvent.click(screen.getByRole('radio', { name: 'ตัวเครื่องปกติ' }));
    fireEvent.click(screen.getByRole('checkbox', { name: eligibility }));
    expect(screen.getAllByRole('button', { name: 'ตอบแบบประเมินให้ครบก่อน' })[0]).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: 'ลำโพงผิดปกติ' }));
    expect(screen.getAllByRole('button', { name: 'ดูราคา' })[0]).toBeEnabled();
    fireEvent.click(screen.getByRole('checkbox', { name: 'ลำโพงผิดปกติ' }));
    expect(screen.getAllByRole('button', { name: 'ตอบแบบประเมินให้ครบก่อน' })[0]).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: 'ไม่มีอาการเหล่านี้' }));
    expect(screen.getAllByRole('button', { name: 'ดูราคา' })[0]).toBeEnabled();
    fireEvent.click(screen.getByRole('checkbox', { name: 'ไม่มีอาการเหล่านี้' }));
    expect(screen.getAllByRole('button', { name: 'ตอบแบบประเมินให้ครบก่อน' })[0]).toBeDisabled();
  });

  it('clears answers and eligibility when storage, model, or the questionnaire changes', async () => {
    const client = mount(); await device(); await answerAll();
    fireEvent.change(screen.getByLabelText('ความจุ'), { target: { value: '128GB' } });
    expect(await screen.findByRole('radio', { name: 'ตัวเครื่องปกติ' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('checkbox', { name: eligibility })).not.toBeChecked();
    await answerAll();
    act(() => { client.setQueryData(['buyback-questions', 'iPhone 12', '128GB'], { ...config, capturedAt: '2026-09-09T10:00:00Z' }); });
    expect(await screen.findByRole('radio', { name: 'ตัวเครื่องปกติ' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('checkbox', { name: eligibility })).not.toBeChecked();
    await answerAll();
    fireEvent.change(screen.getByLabelText('รุ่น'), { target: { value: 'iPhone 17' } });
    expect(screen.getByLabelText('ความจุ')).toHaveValue('');
    fireEvent.change(screen.getByLabelText('ความจุ'), { target: { value: '256GB' } });
    expect(await screen.findByRole('radio', { name: 'ตัวเครื่องปกติ' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('checkbox', { name: eligibility })).not.toBeChecked();
    expect(mocks.get).toHaveBeenCalledWith('/api/shop/buyback/questions', { params: { model: 'iPhone 17', storage: '256GB' } });
  });

  it('discards a late quote after the customer changes an answer', async () => {
    const pending = deferred<{ data: BuybackQuoteResult }>();
    mocks.post.mockReturnValueOnce(pending.promise);
    mount(); await device(); await answerAll(); viewPrice();
    await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('checkbox', { name: 'ลำโพงผิดปกติ' }));
    await act(async () => { pending.resolve({ data: result }); await pending.promise; });
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'ดูราคา' })[0]).toBeEnabled());
    expect(screen.queryByRole('radio', { name: /ขายรับเงินสด/ })).not.toBeInTheDocument();
    expect(screen.getByText('ขายรับเงินสด ~฿3,900.78')).toBeInTheDocument();
  });

  it('requires eligibility before quoting and removes the quote when confirmation is withdrawn', async () => {
    mount(); await device();
    fireEvent.click(screen.getByRole('radio', { name: 'ตัวเครื่องปกติ' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'ไม่มีอาการเหล่านี้' }));
    expect(screen.getAllByRole('button', { name: 'ยืนยันสถานะเครื่องก่อนดูราคา' })[0]).toBeDisabled();
    expect(mocks.post).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('checkbox', { name: eligibility })); viewPrice();
    await seller();
    fireEvent.click(screen.getByRole('checkbox', { name: eligibility }));
    expect(screen.queryByRole('button', { name: 'ยืนยันขาย — รับเงินสดที่ร้าน' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'ยืนยันสถานะเครื่องก่อนดูราคา' })[0]).toBeDisabled();
  });

  it('preserves answers and eligibility after a quote error for retry', async () => {
    mocks.post.mockRejectedValueOnce({ response: { data: { message: 'ลองดูราคาอีกครั้ง' } } });
    mount(); await device(); await answerAll(); viewPrice();
    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith('ลองดูราคาอีกครั้ง'));
    expect(screen.getByRole('checkbox', { name: eligibility })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'ไม่มีอาการเหล่านี้' })).toHaveAttribute('aria-checked', 'true');
    viewPrice();
    await screen.findByRole('radio', { name: /ขายรับเงินสด/ });
    expect(mocks.post.mock.calls[1][1]).toEqual(mocks.post.mock.calls[0][1]);
  });

  it('sends eligibility with submission and locks edits and duplicate submission until completion', async () => {
    const pending = deferred<{ data: { id: string; status: string; price: string } }>();
    mocks.post.mockResolvedValueOnce({ data: result }).mockReturnValueOnce(pending.promise);
    mount(); await device(); await answerAll(); viewPrice(); await seller();
    const button = screen.getByRole('button', { name: 'ยืนยันขาย — รับเงินสดที่ร้าน' });
    fireEvent.click(button); fireEvent.click(button);
    await waitFor(() => expect(button).toBeDisabled());
    expect(mocks.post).toHaveBeenCalledTimes(2);
    expect(mocks.post).toHaveBeenLastCalledWith('/api/shop/buyback/submit', expect.objectContaining({
      model: 'iPhone 12', storage: '64GB', deviceEligibilityConfirmed: true,
      sellerName: 'ลูกค้าทดสอบ', sellerPhone: '0812345678', flow: 'BUYBACK',
    }));
    expect(screen.getByLabelText('รุ่น')).toBeDisabled();
    expect(screen.getByLabelText('ความจุ')).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: eligibility })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'ลำโพงผิดปกติ' })).toBeDisabled();
    expect(screen.getByLabelText(/ชื่อ-นามสกุล/)).toBeDisabled();
    expect(screen.getByRole('radio', { name: /เทิร์นแลกเครื่องใหม่/ })).toBeDisabled();
    await act(async () => { pending.resolve({ data: { id: 'new-request', status: 'APPRAISED', price: '4321.65' } }); await pending.promise; });
    await screen.findByText('ส่งข้อมูลสำเร็จแล้ว');
    expect(mocks.track).toHaveBeenCalledTimes(1);
  });

  it('keeps the device selector usable and blocks quoting when its questionnaire fails or is empty', async () => {
    mocks.get.mockImplementation((url: string) => url.endsWith('/catalog') ? Promise.resolve({ data: catalog }) : Promise.reject(new Error('offline')));
    mount();
    fireEvent.change(await screen.findByLabelText('รุ่น'), { target: { value: 'iPhone 12' } });
    fireEvent.change(screen.getByLabelText('ความจุ'), { target: { value: '64GB' } });
    await screen.findByText('โหลดแบบประเมินไม่สำเร็จ');
    expect(screen.getByLabelText('ความจุ')).toHaveValue('64GB');
    mocks.get.mockResolvedValue({ data: { ...config, questions: [] } });
    fireEvent.click(screen.getByRole('button', { name: 'โหลดใหม่' }));
    await screen.findByText('ยังไม่มีแบบประเมินสำหรับรุ่นและความจุนี้ กรุณาสอบถามร้าน');
    expect(screen.getAllByRole('button', { name: 'ตอบแบบประเมินให้ครบก่อน' })[0]).toBeDisabled();
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it('keeps legacy questionnaires usable without a device-eligibility requirement', async () => {
    mocks.get.mockImplementation((url: string) => Promise.resolve({ data: url.endsWith('/catalog') ? catalog : {
      questions: config.questions, bonusPct: '10',
    } }));
    mount(); await device();
    fireEvent.click(screen.getByRole('radio', { name: 'ตัวเครื่องปกติ' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'ไม่มีอาการเหล่านี้' }));
    expect(screen.queryByRole('checkbox', { name: eligibility })).not.toBeInTheDocument();
    expect(screen.getByText('ขายรับเงินสด ~฿5,000')).toBeInTheDocument();
    viewPrice();
    await screen.findByRole('radio', { name: /ขายรับเงินสด/ });
    expect(mocks.post).toHaveBeenCalledWith('/api/shop/buyback/quote', expect.objectContaining({ deviceEligibilityConfirmed: undefined }));
  });
});
