import '@testing-library/jest-dom/vitest';
import type { ReactNode } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useNavigate, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BuybackQuestionsResponse, BuybackQuoteResult } from '@/types/buyback';
import SellQuotePage from './SellQuotePage';
import DeviceOriginStep from './components/DeviceOriginStep';
import QuestionStep from './components/QuestionStep';
import QuoteResultStep from './components/QuoteResultStep';
import { copy, shopInfo } from '@/lib/copy';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const summaryCss = readFileSync(resolve(__dirname, 'components/quote-summary.css'), 'utf8');

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  track: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
}));
vi.mock('@/lib/api', () => ({ api: { get: mocks.get, post: mocks.post } }));
vi.mock('@/hooks/useTrackEvent', () => ({ useTrackEvent: () => mocks.track }));
vi.mock('sonner', () => ({ toast: { error: mocks.error, success: mocks.success } }));
vi.mock('@/components/layout/ShopLayout', () => ({
  default: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));

const eligibility = 'เครื่องไม่ติดล็อก iCloud หรือระบบผ่อนชำระ สามารถรีเซ็ตและใช้งานได้ปกติ';
const config: BuybackQuestionsResponse = {
  pricingMode: 'MAX_PERCENT_EXACT',
  source: 'https://www.yellobe.com/buy',
  capturedAt: '2026-09-08T10:00:00Z',
  bonusPct: '10',
  eligibilityRequired: true,
  eligibilityText: eligibility,
  questions: [
    {
      id: 'body',
      key: 'body',
      title: 'ตัวเครื่อง',
      selectType: 'SINGLE',
      helpText: null,
      choices: [
        {
          id: 'good',
          label: 'ตัวเครื่องปกติ',
          deductType: 'PERCENT',
          deductValue: '0',
          helpText: 'ตรวจทุกมุมก่อนเลือก',
        },
        { id: 'scratch', label: 'มีรอย', deductType: 'PERCENT', deductValue: '15' },
      ],
    },
    {
      id: 'functions',
      key: 'functions',
      title: 'การใช้งาน',
      selectType: 'MULTI',
      helpText: null,
      choices: [
        { id: 'sound', label: 'ลำโพงผิดปกติ', deductType: 'PERCENT', deductValue: '22' },
        { id: 'camera', label: 'กล้องผิดปกติ', deductType: 'PERCENT', deductValue: '37' },
      ],
    },
  ],
};
const result: BuybackQuoteResult = {
  assessedAt: '2026-11-21T06:41:00Z',
  expiresAt: '2026-11-22T06:41:00Z',
  serverNow: '2026-11-21T06:41:00Z',
  quoteToken: 'test-window',
  available: true,
  price: '4321.65',
  cashPrice: '4321.65',
  exchangePrice: '4750',
  bonusPct: '10',
  grade: 'A',
  breakdown: {
    maxPrice: '5001',
    fixedTotal: '0',
    pctTotal: '0',
    price: '4321.65',
    lines: [
      {
        label: 'การหักที่ไม่ได้ใช้',
        deductType: 'PERCENT',
        deductValue: '15',
        amount: '750',
        applied: false,
      },
    ],
  },
};
const catalog = {
  models: [
    {
      model: 'iPhone 12',
      storages: [
        { storage: '64GB', maxPrice: '5001' },
        { storage: '128GB', maxPrice: '6000' },
      ],
    },
    { model: 'iPhone 17', storages: [{ storage: '256GB', maxPrice: '20000' }] },
  ],
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

let testNavigate: ReturnType<typeof useNavigate>;
let testSearch = '';
function NavigationProbe() {
  testNavigate = useNavigate();
  testSearch = useLocation().search;
  return null;
}
function mount(entry = '/sell/quote') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[entry]}>
        <NavigationProbe />
        <Routes>
          <Route path="/sell/quote" element={<SellQuotePage />} />
          <Route path="/sell/:id" element={<div>ส่งข้อมูลสำเร็จแล้ว</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}
async function click(name: string) {
  fireEvent.click(await screen.findByRole('button', { name }));
}
async function device() {
  await click('กลุ่ม iPhone 12');
  await click('iPhone 12');
  await click('64 GB');
  await screen.findByRole('heading', { name: 'ตัวเครื่อง', level: 1 });
}
async function body() {
  await click('ตัวเครื่องปกติ');
  await screen.findByRole('heading', { name: 'การใช้งาน', level: 1 });
}
async function answers() {
  await body();
  await click('ใช้งานได้ปกติทุกอย่าง');
}
async function quote() {
  await screen.findByRole('heading', { name: 'ยืนยันสถานะเครื่อง', level: 1 });
  fireEvent.click(screen.getByRole('checkbox', { name: eligibility }));
  await click('ดูราคาประเมิน');
  await screen.findByRole('heading', { name: 'สรุปราคาเครื่องของคุณ', level: 1 });
}
async function ready() {
  mount();
  await device();
  await answers();
  await quote();
}
async function seller() {
  await click('นัดตรวจเครื่องที่ร้าน');
  fireEvent.change(await screen.findByLabelText('ชื่อ-นามสกุล'), {
    target: { value: 'ลูกค้าทดสอบ' },
  });
  fireEvent.change(screen.getByLabelText('เบอร์โทร (10 หลัก)'), {
    target: { value: '0812345678' },
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  mocks.get.mockImplementation((url: string) =>
    Promise.resolve({ data: url.endsWith('/catalog') ? catalog : config }),
  );
  mocks.post.mockResolvedValue({ data: result });
});
describe('sell contact links', () => {
  function contact() {
    return within(screen.getByRole('region', { name: 'ติดต่อร้านเรื่องขายหรือเทิร์น' }));
  }
  function lineMessage() {
    return decodeURIComponent(
      new URL(contact().getByRole('link', { name: 'ทัก LINE' }).getAttribute('href')!).search.slice(
        1,
      ),
    );
  }
  it('offers add friend, a prepared message and the configured Google Maps destination from the first step', async () => {
    mount();
    await screen.findByRole('heading', { name: 'คุณใช้ iPhone รุ่นไหน?' });
    expect(contact().getByRole('link', { name: 'แอด LINE' })).toHaveAttribute(
      'href',
      shopInfo.lineUrl,
    );
    expect(contact().getByRole('link', { name: 'แผนที่ร้าน' })).toHaveAttribute(
      'href',
      shopInfo.mapsUrl,
    );
    expect(lineMessage()).toContain('สอบถามเรื่องขายหรือเทิร์น iPhone');
    expect(mocks.post).not.toHaveBeenCalled();
  });
  it('prepares the selected device and authoritative cash/credit estimate without contact details', async () => {
    await ready();
    expect(lineMessage()).toContain('iPhone 12 64GB');
    expect(lineMessage()).toContain('ราคาขายสดโดยประมาณ 4,321.65 บาท');
    await click('เทิร์นซื้อเครื่อง');
    expect(lineMessage()).toContain('เครดิตเทิร์นโดยประมาณ 4,750 บาท');
    expect(lineMessage()).toContain('ไม่จ่ายเป็นเงินสด');
    expect(lineMessage()).not.toContain('4,321.65');
    await click('นัดตรวจเครื่องที่ร้าน');
    fireEvent.change(await screen.findByLabelText('ชื่อ-นามสกุล'), {
      target: { value: 'ชื่อส่วนตัวทดสอบ' },
    });
    fireEvent.change(screen.getByLabelText('เบอร์โทร (10 หลัก)'), {
      target: { value: '0812345678' },
    });
    expect(lineMessage()).not.toContain('ชื่อส่วนตัวทดสอบ');
    expect(lineMessage()).not.toContain('0812345678');
    expect(mocks.post).toHaveBeenCalledTimes(1);
  });
  it('drops the old estimate from LINE after returning to review', async () => {
    await ready();
    await click('ตรวจหรือแก้คำตอบ');
    expect(lineMessage()).not.toContain('4,321.65');
    expect(lineMessage()).toContain('iPhone 12 64GB');
  });
});
describe('guided sell assessment', () => {
  it('renders a focused sell form and only asks questions for the selected device', async () => {
    mount();
    await screen.findByRole('heading', { name: 'คุณใช้ iPhone รุ่นไหน?' });
    expect(screen.getByRole('banner')).toHaveTextContent('เบสท์ช้อยส์');
    expect(mocks.get).toHaveBeenCalledTimes(1);
    await device();
    expect(mocks.get).toHaveBeenCalledWith('/api/shop/buyback/questions', {
      params: { model: 'iPhone 12', storage: '64GB' },
    });
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    expect(screen.getByText('ตรวจทุกมุมก่อนเลือก')).toBeInTheDocument();
  });
  it('sends explicit no issues and eligibility, displaying the server price instead of preview', async () => {
    await ready();
    expect(mocks.post).toHaveBeenCalledWith('/api/shop/buyback/quote', {
      model: 'iPhone 12',
      storage: '64GB',
      deviceEligibilityConfirmed: true,
      answers: [
        { questionKey: 'body', choiceIds: ['good'] },
        { questionKey: 'functions', choiceIds: [] },
      ],
    });
    expect(screen.getByText('4,321.65 บาท')).toBeInTheDocument();
    expect(screen.queryByText('การหักที่ไม่ได้ใช้')).not.toBeInTheDocument();
  });
  it('requires an explicit MULTI answer and keeps multiple issues on the same step', async () => {
    mount();
    await device();
    await body();
    await click('มีอาการผิดปกติ');
    expect(screen.getByRole('button', { name: 'ยืนยันอาการ' })).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: 'ลำโพงผิดปกติ' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'กล้องผิดปกติ' }));
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('การใช้งาน');
    fireEvent.click(screen.getByRole('checkbox', { name: 'ลำโพงผิดปกติ' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'กล้องผิดปกติ' }));
    expect(screen.getByRole('button', { name: 'ยืนยันอาการ' })).toBeDisabled();
    expect(mocks.post).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('checkbox', { name: 'กล้องผิดปกติ' }));
    await click('ยืนยันอาการ');
    await quote();
    expect(mocks.post).toHaveBeenCalledWith(
      '/api/shop/buyback/quote',
      expect.objectContaining({
        answers: [
          { questionKey: 'body', choiceIds: ['good'] },
          { questionKey: 'functions', choiceIds: ['camera'] },
        ],
      }),
    );
  });
  it('preserves a selected answer on back without automatically advancing again', async () => {
    mount();
    await device();
    await body();
    await click('ย้อนกลับ');
    expect(await screen.findByRole('button', { name: 'ตัวเครื่องปกติ' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await new Promise((resolve) => setTimeout(resolve, 260));
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('ตัวเครื่อง');
  });
  it('clears answers when storage changes', async () => {
    mount();
    await device();
    await body();
    await click('เปลี่ยนเครื่อง');
    await click('iPhone 12');
    await click('128 GB');
    expect(await screen.findByRole('button', { name: 'ตัวเครื่องปกติ' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(mocks.post).not.toHaveBeenCalled();
  });
  it('clears answers when the questionnaire changes while on its next question', async () => {
    const client = mount();
    await device();
    await body();
    act(() =>
      client.setQueryData(['buyback-questions', 'iPhone 12', '64GB'], {
        ...config,
        capturedAt: '2026-11-21T00:00:00Z',
      }),
    );
    expect(await screen.findByRole('button', { name: 'ตัวเครื่องปกติ' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });
  it('discards late quote success after navigating back to edit', async () => {
    const pending = deferred<{ data: BuybackQuoteResult }>();
    mocks.post.mockReturnValueOnce(pending.promise);
    mount();
    await device();
    await answers();
    fireEvent.click(await screen.findByRole('checkbox', { name: eligibility }));
    await click('ดูราคาประเมิน');
    await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(1));
    await click('ย้อนกลับ');
    await act(async () => {
      pending.resolve({ data: result });
      await pending.promise;
    });
    expect(screen.queryByText('4,321.65 บาท')).not.toBeInTheDocument();
  });
  it('does not request a quote before required eligibility is confirmed', async () => {
    mount();
    await device();
    await answers();
    expect(await screen.findByRole('button', { name: 'ดูราคาประเมิน' })).toBeDisabled();
    expect(mocks.post).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('checkbox', { name: eligibility }));
    fireEvent.click(screen.getByRole('checkbox', { name: eligibility }));
    expect(screen.getByRole('button', { name: 'ดูราคาประเมิน' })).toBeDisabled();
  });
  it('keeps answers on quote error and retries only when requested', async () => {
    mocks.post.mockRejectedValueOnce({ response: { data: { message: 'ลองดูราคาอีกครั้ง' } } });
    mount();
    await device();
    await answers();
    fireEvent.click(await screen.findByRole('checkbox', { name: eligibility }));
    await click('ดูราคาประเมิน');
    expect(await screen.findByRole('alert')).toHaveTextContent('ลองดูราคาอีกครั้ง');
    await click('ลองขอราคาอีกครั้ง');
    await screen.findByText('4,321.65 บาท');
    expect(mocks.post.mock.calls[1][1]).toEqual(mocks.post.mock.calls[0][1]);
  });
  it('keeps selection usable when questions fail or are empty', async () => {
    mocks.get.mockImplementation((url: string) =>
      url.endsWith('/catalog')
        ? Promise.resolve({ data: catalog })
        : Promise.reject(new Error('offline')),
    );
    mount();
    await click('กลุ่ม iPhone 12');
    await click('iPhone 12');
    await click('64 GB');
    await screen.findByText('โหลดคำถามไม่สำเร็จ');
    mocks.get.mockResolvedValue({ data: { ...config, questions: [] } });
    await click('โหลดใหม่');
    await screen.findByText('รุ่นและความจุนี้ยังประเมินออนไลน์ไม่ได้ กรุณาสอบถามร้าน');
    await click('เปลี่ยนเครื่อง');
    expect(await screen.findByRole('button', { name: 'กลุ่ม iPhone 12' })).toBeEnabled();
    expect(mocks.post).not.toHaveBeenCalled();
  });
  it('accepts legacy configuration without eligibility and supports changing source metadata', async () => {
    mocks.get.mockImplementation((url: string) =>
      Promise.resolve({
        data: url.endsWith('/catalog')
          ? catalog
          : {
              questions: config.questions,
              bonusPct: '7',
              source: 'https://applehouseth.com/',
              pricingMode: 'SUM_PERCENT_FLOOR10',
            },
      }),
    );
    mount();
    await device();
    await answers();
    await screen.findByText('4,321.65 บาท');
    expect(mocks.post).toHaveBeenCalledWith(
      '/api/shop/buyback/quote',
      expect.objectContaining({ deviceEligibilityConfirmed: undefined }),
    );
    expect(screen.queryByRole('checkbox', { name: eligibility })).not.toBeInTheDocument();
  });
  it.each([
    ['?model=iPhone%2012&storage=64GB&utm_source=line', 'ตัวเครื่อง'],
    ['?model=iPhone%2012&storage=bad', 'เครื่องมีความจุเท่าไร?'],
    ['?model=bad&storage=64GB', 'คุณใช้ iPhone รุ่นไหน?'],
  ])('validates device deep links %s', async (search, title) => {
    mount('/sell/quote' + search);
    expect(await screen.findByRole('heading', { level: 1, name: title })).toBeInTheDocument();
  });
  it('reads a changed question count and stops only after the last question', async () => {
    const extra = { ...config.questions[0], id: 'extra', key: 'extra', title: 'คำถามเพิ่มเติม' };
    mocks.get.mockImplementation((url: string) =>
      Promise.resolve({
        data: url.endsWith('/catalog')
          ? catalog
          : { ...config, questions: [...config.questions, extra], eligibilityRequired: false },
      }),
    );
    mount();
    await device();
    await answers();
    await screen.findByRole('heading', { name: 'คำถามเพิ่มเติม' });
    expect(mocks.post).not.toHaveBeenCalled();
    await click('ตัวเครื่องปกติ');
    await screen.findByText('4,321.65 บาท');
  });
  it.each([
    { ...result, available: false },
    { ...result, cashPrice: '0' },
    { ...result, cashPrice: undefined, price: undefined },
    { ...result, exchangePrice: 'NaN' },
  ])('blocks an unavailable or incomplete quote', async (bad) => {
    mocks.post.mockResolvedValue({ data: bad });
    mount();
    await device();
    await answers();
    fireEvent.click(await screen.findByRole('checkbox', { name: eligibility }));
    await click('ดูราคาประเมิน');
    expect(await screen.findByRole('alert')).toHaveTextContent('สอบถามร้าน');
    expect(screen.queryByRole('button', { name: 'นัดตรวจเครื่องที่ร้าน' })).not.toBeInTheDocument();
  });
  it('submits once and locks edits until the response, preserving the existing payload', async () => {
    const pending = deferred<{ data: { id: string; status: string; price: string } }>();
    mocks.post.mockResolvedValueOnce({ data: result }).mockReturnValueOnce(pending.promise);
    await ready();
    await seller();
    const button = screen.getByRole('button', { name: 'ส่งข้อมูลขายสด' });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(button).toBeDisabled());
    expect(screen.getByLabelText('ชื่อ-นามสกุล')).toBeDisabled();
    expect(mocks.post).toHaveBeenCalledTimes(2);
    expect(mocks.post).toHaveBeenLastCalledWith(
      '/api/shop/buyback/submit',
      expect.objectContaining({
        model: 'iPhone 12',
        storage: '64GB',
        deviceEligibilityConfirmed: true,
        sellerName: 'ลูกค้าทดสอบ',
        sellerPhone: '0812345678',
        flow: 'BUYBACK',
      }),
    );
    await act(async () => {
      pending.resolve({ data: { id: 'new-request', status: 'APPRAISED', price: '4321.65' } });
      await pending.promise;
    });
    await screen.findByText('ส่งข้อมูลสำเร็จแล้ว');
    expect(mocks.track).toHaveBeenCalledTimes(1);
  });
});
describe('price review and contact', () => {
  it('compares cash and credit without advancing or requesting another quote', async () => {
    mocks.post.mockResolvedValue({ data: { ...result, bonusPct: '7' } });
    await ready();
    await click('เทิร์นซื้อเครื่อง');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('สรุปราคาเครื่องของคุณ');
    expect(screen.getByText('4,750 บาท')).toBeInTheDocument();
    expect(screen.queryByText('4,321.65 บาท')).not.toBeInTheDocument();
    expect(screen.getByText(/ไม่จ่ายเป็นเงินสด/)).toBeInTheDocument();
    expect(screen.getByText('โบนัสเทิร์น +428.35 บาท')).toBeInTheDocument();
    expect(mocks.post).toHaveBeenCalledTimes(1);
  });
  it('edits one answer via review and requests a new quote only when reviewing finishes', async () => {
    await ready();
    await click('ตรวจหรือแก้คำตอบ');
    await click('แก้ ตัวเครื่อง');
    await click('มีรอย');
    await screen.findByRole('heading', { name: 'ตรวจคำตอบ' });
    expect(screen.getByText('มีรอย')).toBeInTheDocument();
    expect(mocks.post).toHaveBeenCalledTimes(1);
    await click('ดูราคาประเมิน');
    await screen.findByText('4,321.65 บาท');
    expect(mocks.post).toHaveBeenCalledTimes(2);
  });
  it.each(['081', '08123456789', '081a2345678'])(
    'explains invalid phone %s next to the field',
    async (phone) => {
      await ready();
      await seller();
      const input = screen.getByLabelText('เบอร์โทร (10 หลัก)');
      fireEvent.change(input, { target: { value: phone } });
      fireEvent.blur(input);
      expect(input).toHaveAttribute('aria-invalid', 'true');
      expect(screen.getByRole('button', { name: 'ส่งข้อมูลขายสด' })).toBeDisabled();
      expect(screen.getByText('กรอกเบอร์โทร 10 หลัก เริ่มด้วย 0')).toBeInTheDocument();
      expect(screen.getByText('กรอกเบอร์โทรให้ครบก่อนส่งข้อมูล')).toBeInTheDocument();
    },
  );
  it('normalizes phone spaces/hyphens, submits the chosen credit flow and preserves data after an error', async () => {
    await ready();
    await click('เทิร์นซื้อเครื่อง');
    await click('นัดตรวจเครื่องที่ร้าน');
    fireEvent.change(await screen.findByLabelText('ชื่อ-นามสกุล'), {
      target: { value: 'ลูกค้าทดสอบ' },
    });
    fireEvent.change(screen.getByLabelText('เบอร์โทร (10 หลัก)'), {
      target: { value: '081-234-5678' },
    });
    mocks.post.mockRejectedValueOnce({
      response: { data: { message: 'ส่งไม่สำเร็จ ลองอีกครั้ง' } },
    });
    await click('ส่งข้อมูลเทิร์น');
    await screen.findByText('ส่งไม่สำเร็จ ลองอีกครั้ง');
    expect(screen.getByRole('alert')).toHaveFocus();
    expect(screen.getByLabelText('เบอร์โทร (10 หลัก)')).toHaveValue('081-234-5678');
    expect(mocks.post).toHaveBeenLastCalledWith(
      '/api/shop/buyback/submit',
      expect.objectContaining({
        sellerPhone: '0812345678',
        flow: 'EXCHANGE',
        imei: undefined,
        notes: undefined,
        preferredVisitDate: undefined,
      }),
    );
    mocks.post.mockResolvedValueOnce({
      data: { id: 'new-request', status: 'APPRAISED', price: '4750' },
    });
    await click('ส่งข้อมูลเทิร์น');
    await screen.findByText('ส่งข้อมูลสำเร็จแล้ว');
  });
});
describe('request and history boundaries', () => {
  it('discards unconfirmed issue edits on Back and Forward before requesting a price', async () => {
    await ready();
    await click('ตรวจหรือแก้คำตอบ');
    await click('แก้ การใช้งาน');
    await click('มีอาการผิดปกติ');
    fireEvent.click(screen.getByRole('checkbox', { name: 'กล้องผิดปกติ' }));
    await click('ย้อนกลับ');
    expect(screen.getByText('ใช้งานได้ปกติทุกอย่าง')).toBeInTheDocument();
    act(() => testNavigate(1));
    expect(
      screen.queryByRole('checkbox', { name: 'กล้องผิดปกติ', checked: true }),
    ).not.toBeInTheDocument();
    await click('ใช้งานได้ปกติทุกอย่าง');
    await screen.findByRole('heading', { name: 'ตรวจคำตอบ' });
    await click('ดูราคาประเมิน');
    await screen.findByText('4,321.65 บาท');
    expect(mocks.post).toHaveBeenLastCalledWith(
      '/api/shop/buyback/quote',
      expect.objectContaining({
        answers: [
          { questionKey: 'body', choiceIds: ['good'] },
          { questionKey: 'functions', choiceIds: [] },
        ],
      }),
    );
  });
  it('restores the contact draft and retry error after Back during a rejected submission', async () => {
    let reject!: (error: unknown) => void;
    const pending = new Promise((_resolve, fail) => {
      reject = fail;
    });
    await ready();
    await seller();
    mocks.post.mockReturnValueOnce(pending);
    await click('ส่งข้อมูลขายสด');
    act(() => testNavigate(-1));
    await act(async () => {
      reject({ response: { data: { message: 'ส่งไม่สำเร็จ ลองอีกครั้ง' } } });
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('ส่งไม่สำเร็จ ลองอีกครั้ง');
    expect(screen.getByLabelText('ชื่อ-นามสกุล')).toHaveValue('ลูกค้าทดสอบ');
    expect(screen.getByLabelText('เบอร์โทร (10 หลัก)')).toHaveValue('0812345678');
    expect(screen.getByRole('button', { name: 'ส่งข้อมูลขายสด' })).toBeEnabled();
    mocks.post.mockResolvedValueOnce({
      data: { id: 'retry-success', status: 'APPRAISED', price: '4321.65' },
    });
    await click('ส่งข้อมูลขายสด');
    await screen.findByText('ส่งข้อมูลสำเร็จแล้ว');
  });
  it('backs out of a shared device link through capacity to model without looping', async () => {
    mount('/sell/quote?model=iPhone%2012&storage=64GB&utm_source=line');
    await screen.findByRole('heading', { name: 'ตัวเครื่อง', level: 1 });
    await click('ย้อนกลับ');
    await screen.findByRole('heading', { name: 'เครื่องมีความจุเท่าไร?', level: 1 });
    await click('ย้อนกลับ');
    await screen.findByRole('heading', { name: 'คุณใช้ iPhone รุ่นไหน?', level: 1 });
    expect(new URLSearchParams(testSearch).get('utm_source')).toBe('line');
  });
  it('locks result controls even when browser Back is pressed during submission', async () => {
    const pending = deferred<{ data: { id: string; status: string; price: string } }>();
    mocks.post.mockResolvedValueOnce({ data: result }).mockReturnValueOnce(pending.promise);
    await ready();
    await seller();
    await click('ส่งข้อมูลขายสด');
    act(() => testNavigate(-1));
    expect(screen.queryByRole('button', { name: 'เทิร์นซื้อเครื่อง' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('ชื่อ-นามสกุล')).toBeDisabled();
    await act(async () => {
      pending.resolve({ data: { id: 'new-request', status: 'APPRAISED', price: '4321.65' } });
      await pending.promise;
    });
    await screen.findByText('ส่งข้อมูลสำเร็จแล้ว');
  });
  it('retains marketing parameters while stepping through a shared link', async () => {
    mount('/sell/quote?model=iPhone%2012&storage=64GB&utm_source=line');
    await screen.findByRole('button', { name: 'ตัวเครื่องปกติ' });
    await body();
    expect(new URLSearchParams(testSearch).get('utm_source')).toBe('line');
  });
  it('removes price-source disclosure and omits a zero bonus badge', async () => {
    mocks.post.mockResolvedValue({
      data: { ...result, bonusPct: '0', exchangePrice: result.cashPrice },
    });
    await ready();
    expect(screen.queryByText('ดูที่มาของราคา')).not.toBeInTheDocument();
    expect(screen.queryByText(/เงื่อนไขอ้างอิง Yellobe/)).not.toBeInTheDocument();
    await click('เทิร์นซื้อเครื่อง');
    expect(screen.queryByText(/โบนัสเทิร์น/)).not.toBeInTheDocument();
  });
  it('does not interpret shared device data before catalog loads', async () => {
    const pending = deferred<{ data: typeof catalog }>();
    mocks.get.mockReturnValueOnce(pending.promise);
    mount('/sell/quote?model=iPhone%2012&storage=64GB');
    expect(screen.getByRole('heading')).toHaveTextContent('โหลดรายชื่อรุ่น');
    expect(mocks.get).toHaveBeenCalledTimes(1);
    await act(async () => {
      pending.resolve({ data: catalog });
      await pending.promise;
    });
    await screen.findByRole('heading', { name: 'ตัวเครื่อง' });
  });
});

describe('catalog availability changes', () => {
  it('returns to device selection when the selected model is removed', async () => {
    const client = mount();
    await device();
    await body();
    act(() => client.setQueryData(['buyback-catalog'], { models: [catalog.models[1]] }));
    await screen.findByRole('heading', { name: 'คุณใช้ iPhone รุ่นไหน?', level: 1 });
    expect(screen.queryByRole('button', { name: 'กลุ่ม iPhone 12' })).not.toBeInTheDocument();
    expect(mocks.post).not.toHaveBeenCalled();
  });
  it('returns to storage selection when the selected capacity is removed', async () => {
    const client = mount();
    await device();
    await body();
    act(() =>
      client.setQueryData(['buyback-catalog'], {
        models: [{ ...catalog.models[0], storages: [catalog.models[0].storages[1]] }],
      }),
    );
    await screen.findByRole('heading', { name: 'เครื่องมีความจุเท่าไร?', level: 1 });
    expect(screen.queryByRole('button', { name: '64 GB' })).not.toBeInTheDocument();
    expect(mocks.post).not.toHaveBeenCalled();
  });
});

// ข้อความและสีที่เจ้าของเคาะเมื่อ 28/11/2569 (รายงานรอบที่ 1 ของขั้นตอนเช็กราคา)
describe('copy approved on 2026-11-28', () => {
  const question = (over: Partial<BuybackQuestionsResponse['questions'][number]>) => ({
    id: 'q',
    key: 'q',
    title: 'คำถาม',
    selectType: 'SINGLE' as const,
    helpText: null,
    choices: [],
    ...over,
  });
  const choice = (id: string, label: string) => ({
    id,
    label,
    deductType: 'PERCENT' as const,
    deductValue: '0',
  });
  const noop = () => {};

  it('counts the four steps in the progress label, following the real question count', async () => {
    mount();
    expect(await screen.findByText('1/4 · เลือกเครื่อง')).toBeInTheDocument();
    await device();
    expect(screen.getByText('2/4 · เช็กสภาพ · ข้อ 1 จาก 2')).toBeInTheDocument();
    await answers();
    await screen.findByRole('heading', { name: 'ยืนยันสถานะเครื่อง', level: 1 });
    expect(screen.getByText('2/4 · เช็กสภาพ')).toBeInTheDocument();
    expect(screen.getByText('ติ๊กยืนยันก่อนดูราคา')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: eligibility }));
    await click('ดูราคาประเมิน');
    expect(await screen.findByText('3/4 · ราคาประเมิน')).toBeInTheDocument();
    await click('นัดตรวจเครื่องที่ร้าน');
    expect(await screen.findByText('4/4 · ข้อมูลติดต่อ')).toBeInTheDocument();
  });

  it('names the two device levels as group and model, with one instruction per level', async () => {
    mount();
    await screen.findByRole('heading', { name: 'คุณใช้ iPhone รุ่นไหน?' });
    expect(screen.queryByText(/เลือกรุ่นย่อย/)).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '1. เลือกกลุ่ม iPhone' })).toBeInTheDocument();
    expect(screen.getByText('ไม่ต้องสมัครสมาชิก ไม่ต้องถ่ายรูปเครื่อง')).toBeInTheDocument();
    await click('กลุ่ม iPhone 12');
    expect(screen.getByRole('heading', { name: '2. เลือกรุ่นของ iPhone 12' })).toBeInTheDocument();
  });

  it('labels a Thai-model answer as โมเดลไทย in the price summary', async () => {
    mocks.get.mockImplementation((url: string) =>
      Promise.resolve({
        data: url.endsWith('/catalog')
          ? catalog
          : {
              ...config,
              eligibilityRequired: false,
              questions: [
                question({
                  id: 'origin',
                  key: 'device-origin',
                  title: 'เครื่องศูนย์',
                  choices: [
                    choice('th', 'เครื่องศูนย์ไทย (TH)'),
                    choice('im', 'เครื่องนอก (โมเดลอื่น)'),
                  ],
                }),
                config.questions[1],
              ],
            },
      }),
    );
    mount();
    await click('กลุ่ม iPhone 12');
    await click('iPhone 12');
    await click('64 GB');
    await screen.findByRole('heading', { name: 'เครื่องนี้เป็นโมเดลไทยไหม?', level: 1 });
    await click('เครื่องโมเดลไทย');
    await click('ใช้งานได้ปกติทุกอย่าง');
    await screen.findByRole('heading', { name: 'สรุปราคาเครื่องของคุณ', level: 1 });
    // หัวข้อจอราคาขึ้นก่อนผลประเมินมาถึง — รอแถวสรุปเอง
    expect(await screen.findByText('โมเดลไทย · รหัส M')).toBeInTheDocument();
    expect(screen.queryByText(/เครื่องศูนย์ไทย/)).not.toBeInTheDocument();
  });

  it('names the check step while the questions are still loading', async () => {
    const pending = deferred<{ data: BuybackQuestionsResponse }>();
    mocks.get.mockImplementation((url: string) =>
      url.endsWith('/catalog') ? Promise.resolve({ data: catalog }) : pending.promise,
    );
    mount();
    await click('กลุ่ม iPhone 12');
    await click('iPhone 12');
    await click('64 GB');
    expect(
      await screen.findByRole('heading', { name: 'เช็กสภาพเครื่อง', level: 1 }),
    ).toBeInTheDocument();
    await act(async () => {
      pending.resolve({ data: config });
    });
    await screen.findByRole('heading', { name: 'ตัวเครื่อง', level: 1 });
  });

  it('offers the shop LINE when a price cannot be given', async () => {
    mocks.post.mockResolvedValue({ data: { ...result, available: false } });
    mount();
    await device();
    await answers();
    fireEvent.click(await screen.findByRole('checkbox', { name: eligibility }));
    await click('ดูราคาประเมิน');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /^ยังประเมินราคาเครื่องนี้ไม่ได้ กรุณาสอบถามร้าน$/,
    );
    expect(screen.getByRole('link', { name: 'สอบถามร้านทาง LINE' })).toHaveAttribute(
      'href',
      shopInfo.lineUrl,
    );
  });

  it('keeps the shared price sentences word for word', () => {
    expect(copy.sell.exchangeCreditNote).toBe(
      'เครดิตเทิร์นใช้เป็นส่วนลดซื้อเครื่องในร้าน ไม่จ่ายเป็นเงินสด',
    );
    expect(copy.sell.priceCondition).toBe(
      'ราคายืนยันจริงตอนตรวจเครื่องที่ร้าน คุณปฏิเสธได้ ไม่มีค่าใช้จ่าย',
    );
  });

  it('keeps the intake conditions verbatim and shortens only the reference-window line', async () => {
    await ready();
    const intake = screen.getByRole('complementary', { name: 'เงื่อนไขรับซื้อและเทิร์น' });
    expect(intake.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      'เงื่อนไขรับซื้อ / เทิร์น' +
        'ต้องตรวจเครื่องจริงก่อนยืนยันราคา' +
        'เครื่องต้อง ล้างข้อมูลได้ และเจ้าของเครื่องต้อง ออกจาก iCloud ได้' +
        'หากล้างเครื่องหรือออกจาก iCloud ไม่ได้ ร้านยังรับซื้อหรือเทิร์นไม่ได้',
    );
    expect(screen.getByText('เวลาไทย')).toBeInTheDocument();
    expect(screen.getByText('ช่วงอ้างอิง 24 ชั่วโมง')).toBeInTheDocument();
    expect(screen.getByText('พ้นเวลานี้ต้องประเมินใหม่ · ไม่ใช่การล็อกราคา')).toBeInTheDocument();
    await click('เทิร์นซื้อเครื่อง');
    expect(screen.getByText(copy.sell.exchangeCreditNote)).toBeInTheDocument();
    expect(screen.getByText(/โบนัสเทิร์น \+/)).toHaveClass('bg-promo');
    const line = decodeURIComponent(
      new URL(screen.getByRole('link', { name: 'ทัก LINE' }).getAttribute('href')!).search.slice(1),
    );
    expect(line).toContain('ช่วงอ้างอิง 24 ชั่วโมงไม่ใช่การล็อกราคา');
  });

  it('reserves yellow for the trade-in bonus badge, including after the reference window ends', () => {
    render(
      <QuoteResultStep
        quote={result}
        model="iPhone 12"
        storage="64GB"
        conditions={[]}
        expired
        flow="EXCHANGE"
        onFlowChange={noop}
        onContinue={noop}
        onReview={noop}
        onReassess={noop}
        onChangeDevice={noop}
      />,
    );
    const status = screen.getByText('พ้นช่วงอ้างอิงแล้ว');
    const notice = screen.getByText('กรุณาประเมินใหม่ก่อนนัดหมาย').parentElement!;
    expect(status).not.toHaveClass('bg-promo');
    expect(notice).not.toHaveClass('bg-promo');
    expect(status).toHaveClass('border-sell-header-foreground');
    expect(notice).toHaveClass('border-sell-header-foreground');
    expect(screen.getByText('ราคาที่แสดงเป็นผลประเมินเดิม ไม่ใช่ราคาปัจจุบัน')).toBeInTheDocument();
    expect(screen.getByText(/โบนัสเทิร์น \+/)).toHaveClass('bg-promo');
    const intakeRule = /\.sell-summary \.summary-intake\s*\{([^}]*)\}/.exec(summaryCss)?.[1] ?? '';
    expect(intakeRule).toContain('border');
    expect(intakeRule).not.toContain('promo');
    expect(intakeRule).toContain('var(--color-sell-header-foreground)');
  });

  it('calls the Thai model by one name and stops imported devices in one short line', () => {
    const origin = question({
      key: 'device-origin',
      title: 'เครื่องศูนย์',
      choices: [choice('th', 'เครื่องศูนย์ไทย (TH)'), choice('im', 'เครื่องนอก (โมเดลอื่น)')],
    });
    const { container } = render(
      <DeviceOriginStep
        question={origin}
        answer={['im']}
        disabled={false}
        onSelect={noop}
        model="iPhone 17 Pro"
        storage="256GB"
      />,
    );
    expect(screen.getByText('ยืนยันว่าเป็นโมเดลไทย รหัสขึ้นต้น M')).toBeInTheDocument();
    expect(screen.getByText('เครื่องที่ขายในต่างประเทศ · ร้านไม่รับ')).toBeInTheDocument();
    expect(screen.getByText('ขออภัย ร้านไม่รับเครื่องโมเดลนอก')).toBeInTheDocument();
    expect(
      screen.getByText('จึงประเมินราคาต่อไม่ได้ · ถ้าเลือกผิด แตะคำตอบด้านบน'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/เปิดแชทพร้อมข้อความ/)).not.toBeInTheDocument();
    expect(container).not.toHaveTextContent('เครื่องศูนย์ไทย');
    expect(container).not.toHaveTextContent('รุ่นย่อย');
    expect(container).toHaveTextContent('iPhone 13 ทุกรุ่น: TH/A');
    expect(container).toHaveTextContent('iPhone 14, 15, 16, 17 ทุกรุ่น: ZP/A');
    expect(container).toHaveTextContent(
      'ZP/A ใช้ร่วมกันหลายประเทศ รหัสตรงอย่างเดียวจึงยังยืนยันว่าเป็นโมเดลไทยไม่ได้',
    );
    expect(container).toHaveTextContent('รับเครื่องโมเดลไทย · รหัสขึ้นต้น M เท่านั้น');
  });

  it('tells a customer with exactly four months of warranty which answer to pick', () => {
    render(
      <QuestionStep
        question={question({
          key: 'warranty',
          title: 'ประกัน Apple',
          choices: [
            choice('more', 'ประกันเหลือมากกว่า 4 เดือน'),
            choice('less', 'ประกันเหลือน้อยกว่า 4 เดือน'),
            choice('none', 'หมดประกัน'),
          ],
        })}
        answer={undefined}
        showIssues={false}
        disabled={false}
        onSingle={noop}
        onNone={noop}
        onToggleIssue={noop}
        onShowIssues={noop}
        onConfirmIssues={noop}
      />,
    );
    expect(screen.getByText('ถ้าเหลือพอดี 4 เดือน ให้เลือกน้อยกว่า 4 เดือน')).toBeInTheDocument();
    expect(screen.queryByText(/ให้สอบถามร้านก่อนเลือก/)).not.toBeInTheDocument();
  });

  it('explains the Sensor issue under the label the back office still uses', () => {
    render(
      <QuestionStep
        question={question({
          key: 'functional-issues',
          title: 'ปัญหาการใช้งาน',
          selectType: 'MULTI',
          choices: [choice('sensor', 'Sensor'), choice('wifi', 'WiFi / Bluetooth / GPS')],
        })}
        answer={[]}
        showIssues
        disabled={false}
        onSingle={noop}
        onNone={noop}
        onToggleIssue={noop}
        onShowIssues={noop}
        onConfirmIssues={noop}
      />,
    );
    expect(screen.getByRole('checkbox', { name: /Sensor/ })).toHaveTextContent(
      'แนบหูตอนโทรแล้วจอไม่ดับ',
    );
    expect(screen.getByRole('checkbox', { name: /WiFi/ })).not.toHaveTextContent('แนบหู');
  });

  it('labels the optional contact fields plainly and reuses the shared price-condition line', async () => {
    await ready();
    await click('นัดตรวจเครื่องที่ร้าน');
    await screen.findByLabelText('ชื่อ-นามสกุล');
    expect(screen.getByLabelText('เลขประจำเครื่อง (IMEI)')).toBeInTheDocument();
    expect(screen.getByLabelText('หมายเหตุ')).toBeInTheDocument();
    expect(screen.getByText(copy.sell.priceCondition)).toBeInTheDocument();
    expect(screen.getByText('กรอกชื่อ-นามสกุลก่อนส่งข้อมูล')).toBeInTheDocument();
  });

  it('reports a failed submission with the same word the button uses', async () => {
    await ready();
    await seller();
    mocks.post.mockRejectedValueOnce(new Error('offline'));
    await click('ส่งข้อมูลขายสด');
    expect(await screen.findByRole('alert')).toHaveTextContent('ส่งข้อมูลไม่สำเร็จ กรุณาลองใหม่');
  });
});
