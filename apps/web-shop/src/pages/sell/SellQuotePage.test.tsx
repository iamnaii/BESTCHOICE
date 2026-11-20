import '@testing-library/jest-dom/vitest';
import type { ReactNode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useNavigate, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BuybackQuestionsResponse, BuybackQuoteResult } from '@/types/buyback';
import SellQuotePage from './SellQuotePage';

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
  await click('ซีรีส์ 12');
  await click('ไอโฟน 12');
  await click('64 กิกะไบต์');
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
  await screen.findByRole('heading', { name: 'ราคาของเครื่องคุณ', level: 1 });
}
async function ready() {
  mount();
  await device();
  await answers();
  await quote();
}
async function seller() {
  await click('เลือกขายสด · กรอกข้อมูล');
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
describe('guided sell assessment', () => {
  it('renders a focused sell form and only asks questions for the selected device', async () => {
    mount();
    await screen.findByRole('heading', { name: 'คุณใช้ไอโฟนรุ่นไหน?' });
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
    await click('ไอโฟน 12');
    await click('128 กิกะไบต์');
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
    await click('ซีรีส์ 12');
    await click('ไอโฟน 12');
    await click('64 กิกะไบต์');
    await screen.findByText('โหลดแบบประเมินไม่สำเร็จ');
    mocks.get.mockResolvedValue({ data: { ...config, questions: [] } });
    await click('โหลดใหม่');
    await screen.findByText('ยังไม่มีแบบประเมินสำหรับรุ่นและความจุนี้ กรุณาสอบถามร้าน');
    await click('เปลี่ยนเครื่อง');
    expect(await screen.findByRole('button', { name: 'ซีรีส์ 12' })).toBeEnabled();
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
    ['?model=bad&storage=64GB', 'คุณใช้ไอโฟนรุ่นไหน?'],
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
    expect(
      screen.queryByRole('button', { name: 'เลือกขายสด · กรอกข้อมูล' }),
    ).not.toBeInTheDocument();
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
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('ราคาของเครื่องคุณ');
    expect(screen.getByText('4,750 บาท')).toBeInTheDocument();
    expect(screen.queryByText('4,321.65 บาท')).not.toBeInTheDocument();
    expect(screen.getByText(/ไม่จ่ายเป็นเงินสด/)).toBeInTheDocument();
    expect(screen.getByText('โบนัสเทิร์น 7%')).toBeInTheDocument();
    expect(mocks.post).toHaveBeenCalledTimes(1);
  });
  it('edits one answer via review and requests a new quote only when reviewing finishes', async () => {
    await ready();
    await click('ตรวจหรือแก้คำตอบ');
    await click('แก้ ตัวเครื่อง');
    await click('มีรอย');
    await screen.findByRole('heading', { name: 'ทบทวนคำตอบ' });
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
      expect(
        screen.getByText('กรอกเบอร์โทร 10 หลัก เริ่มด้วย 0 โดยใช้ตัวเลขเท่านั้น'),
      ).toBeInTheDocument();
    },
  );
  it('normalizes phone spaces/hyphens, submits the chosen credit flow and preserves data after an error', async () => {
    await ready();
    await click('เทิร์นซื้อเครื่อง');
    await click('ใช้เครดิตเทิร์น · กรอกข้อมูล');
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
  it('keeps server source attribution and omits a zero bonus badge', async () => {
    mocks.post.mockResolvedValue({ data: { ...result, bonusPct: '0' } });
    await ready();
    fireEvent.click(screen.getByText('ดูที่มาของราคา'));
    expect(screen.getByText(/เงื่อนไขอ้างอิง Yellobe/)).toHaveTextContent('2569');
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
    await screen.findByRole('heading', { name: 'คุณใช้ไอโฟนรุ่นไหน?', level: 1 });
    expect(screen.queryByRole('button', { name: 'ซีรีส์ 12' })).not.toBeInTheDocument();
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
    expect(screen.queryByRole('button', { name: '64 กิกะไบต์' })).not.toBeInTheDocument();
    expect(mocks.post).not.toHaveBeenCalled();
  });
});
