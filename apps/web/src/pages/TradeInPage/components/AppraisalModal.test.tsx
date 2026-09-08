import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  BuybackAnswer,
  BuybackQuestionsResponse,
  BuybackQuoteResult,
} from '@installment/shared';
import AppraisalModal from './AppraisalModal';
import type { TradeIn } from '../types';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn() }));
vi.mock('@/lib/api', () => ({
  default: api,
  getErrorMessage: (error: unknown) => (error instanceof Error ? error.message : 'เกิดข้อผิดพลาด'),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn() } }));

const record: TradeIn = {
  id: 'appraisal-device-1',
  status: 'PENDING_APPRAISAL',
  flow: 'BUYBACK',
  deviceBrand: 'Apple',
  deviceModel: 'iPhone 15',
  deviceStorage: '128GB',
  deviceColor: 'ดำ',
  deviceCondition: 'A',
  imei: '990000000000001',
  serialNumber: 'SYNTHETIC-SN',
  estimatedValue: 4500,
  offeredPrice: null,
  agreedPrice: null,
  sellerName: 'ผู้ขายตัวอย่าง',
  sellerPhone: null,
  voucherNumber: null,
  voucherPdfUrl: null,
  customer: null,
  createdAt: '2026-09-08T00:00:00Z',
};
const questionnaire: BuybackQuestionsResponse = {
  bonusPct: '15',
  questions: [
    {
      id: 'question-screen',
      key: 'screen',
      title: 'สภาพหน้าจอ',
      helpText: null,
      selectType: 'SINGLE',
      choices: [
        { id: 'screen-good', label: 'หน้าจอสมบูรณ์', deductType: 'FIXED', deductValue: '0' },
        {
          id: 'screen-scratched',
          label: 'หน้าจอมีรอย',
          deductType: 'FIXED',
          deductValue: '1876.55',
        },
      ],
    },
    {
      id: 'question-issues',
      key: 'issues',
      title: 'ตรวจฟังก์ชันเครื่อง',
      helpText: 'ตรวจทุกฟังก์ชัน',
      selectType: 'MULTI',
      choices: [
        { id: 'issue-battery', label: 'แบตเตอรี่เสื่อม', deductType: 'PERCENT', deductValue: '10' },
        { id: 'issue-camera', label: 'กล้องมีฝ้า', deductType: 'FIXED', deductValue: '1000' },
      ],
    },
  ],
};
type Preview = BuybackQuoteResult & { previewToken?: string };
function quote(overrides: Partial<Preview> = {}): Preview {
  return {
    available: true,
    price: '8123.45',
    cashPrice: '8123.45',
    exchangePrice: '9341.97',
    bonusPct: '15',
    grade: 'B',
    previewToken: 'server-preview-1',
    breakdown: {
      maxPrice: '10000',
      fixedTotal: '1876.55',
      pctTotal: '0',
      price: '8123.45',
      lines: [
        {
          label: 'ค่าปรับสภาพเครื่อง',
          deductType: 'FIXED',
          deductValue: '1876.55',
          amount: '1876.55',
        },
      ],
    },
    ...overrides,
  };
}
const completeAnswers: BuybackAnswer[] = [
  { questionKey: 'screen', choiceIds: ['screen-good'] },
  { questionKey: 'issues', choiceIds: [] },
];
const clients: QueryClient[] = [];
function setup(item: TradeIn | null = record) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });
  clients.push(client);
  const onClose = vi.fn();
  const onBack = vi.fn();
  const view = render(
    <QueryClientProvider client={client}>
      <AppraisalModal item={item} onClose={onClose} onBack={onBack} />
    </QueryClientProvider>,
  );
  return { ...view, client, onClose, onBack, user: userEvent.setup() };
}
async function answerAll(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('radio', { name: 'หน้าจอสมบูรณ์' }));
  await user.click(screen.getByRole('checkbox', { name: 'ตรวจแล้ว ไม่พบปัญหา' }));
}
const saveButton = () => screen.getByRole('button', { name: 'บันทึกผลตรวจและราคา' });
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.resetAllMocks();
  api.get.mockResolvedValue({ data: questionnaire });
  api.post.mockResolvedValue({ data: quote() });
  api.patch.mockResolvedValue({ data: { id: record.id, status: 'APPRAISED' } });
});
afterEach(() => {
  clients.splice(0).forEach((client) => client.clear());
});

describe('Trade-in questionnaire appraisal', () => {
  it('requires reference eligibility for both preview and saved inspection', async () => {
    api.get.mockResolvedValue({
      data: {
        ...questionnaire,
        pricingMode: 'MAX_PERCENT_EXACT',
        source: 'https://www.yellobe.com/buy',
        capturedAt: '2026-09-08T00:00:00Z',
        eligibilityRequired: true,
        eligibilityText: 'เครื่องไม่ติดล็อค iCloud และสามารถรีเซ็ทได้',
      },
    });
    const { user } = setup();
    await answerAll(user);
    expect(api.post).not.toHaveBeenCalled();
    expect(saveButton()).toBeDisabled();
    const eligible = screen.getByRole('checkbox', { name: 'ยืนยันเครื่องผ่านเงื่อนไขรับซื้อ' });
    await user.click(eligible);
    await waitFor(() => expect(saveButton()).toBeEnabled());
    expect(api.post).toHaveBeenLastCalledWith(
      `/trade-ins/${record.id}/appraisal-preview`,
      { answers: completeAnswers, deviceEligibilityConfirmed: true },
      { signal: expect.any(AbortSignal) },
    );
    await user.click(eligible);
    expect(saveButton()).toBeDisabled();
    expect(screen.queryByRole('region', { name: 'รายละเอียดราคาประเมิน' })).not.toBeInTheDocument();
    await user.click(eligible);
    await waitFor(() => expect(saveButton()).toBeEnabled());
    await user.click(saveButton());
    expect(api.patch).toHaveBeenCalledWith(`/trade-ins/${record.id}/appraise-online`, {
      mode: 'REVISED',
      answers: completeAnswers,
      previewToken: 'server-preview-1',
      deviceEligibilityConfirmed: true,
    });
  });
  it('requires a SINGLE answer before requesting a price and has no manual price or grade fields', async () => {
    const { user } = setup();
    await screen.findByRole('radio', { name: 'หน้าจอสมบูรณ์' });
    expect(api.get).toHaveBeenCalledWith('/trade-ins/appraisal-questions', {
      params: { tradeInId: record.id },
      signal: expect.any(AbortSignal),
    });
    expect(screen.getByText(record.imei!)).toBeVisible();
    expect(screen.getByText(record.serialNumber!)).toBeVisible();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('radio', { name: /A ดีเยี่ยม|B ดี|C พอใช้/ }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: 'ตรวจแล้ว ไม่พบปัญหา' }));
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1');
    expect(saveButton()).toBeDisabled();
    expect(api.post).not.toHaveBeenCalled();
    await user.click(screen.getByRole('radio', { name: 'หน้าจอสมบูรณ์' }));
    await waitFor(() => expect(saveButton()).toBeEnabled());
    expect(api.post).toHaveBeenCalledExactlyOnceWith(
      `/trade-ins/${record.id}/appraisal-preview`,
      { answers: completeAnswers },
      { signal: expect.any(AbortSignal) },
    );
  });

  it('requires an explicit no-issues answer and becomes incomplete again when it is unchecked', async () => {
    const { user } = setup();
    await user.click(await screen.findByRole('radio', { name: 'หน้าจอสมบูรณ์' }));
    expect(api.post).not.toHaveBeenCalled();
    expect(saveButton()).toBeDisabled();
    const noIssues = screen.getByRole('checkbox', { name: 'ตรวจแล้ว ไม่พบปัญหา' });
    await user.click(noIssues);
    await waitFor(() => expect(saveButton()).toBeEnabled());
    expect(noIssues).toBeChecked();
    await user.click(noIssues);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1');
    expect(saveButton()).toBeDisabled();
    expect(screen.queryByRole('region', { name: 'รายละเอียดราคาประเมิน' })).not.toBeInTheDocument();
    expect(api.post).toHaveBeenCalledTimes(1);
  });

  it('supports multiple issues but unchecking the last issue does not silently mean no issues', async () => {
    const { user } = setup();
    await user.click(await screen.findByRole('radio', { name: 'หน้าจอสมบูรณ์' }));
    const battery = screen.getByRole('checkbox', { name: 'แบตเตอรี่เสื่อม' });
    const camera = screen.getByRole('checkbox', { name: 'กล้องมีฝ้า' });
    await user.click(camera);
    await user.click(battery);
    await waitFor(() => expect(saveButton()).toBeEnabled());
    expect(api.post).toHaveBeenLastCalledWith(
      `/trade-ins/${record.id}/appraisal-preview`,
      {
        answers: [
          completeAnswers[0],
          { questionKey: 'issues', choiceIds: ['issue-battery', 'issue-camera'] },
        ],
      },
      { signal: expect.any(AbortSignal) },
    );
    await user.click(camera);
    await waitFor(() => expect(saveButton()).toBeEnabled());
    const requestsBeforeUnchecking = api.post.mock.calls.length;
    await user.click(battery);
    expect(screen.getByRole('checkbox', { name: 'ตรวจแล้ว ไม่พบปัญหา' })).not.toBeChecked();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1');
    expect(saveButton()).toBeDisabled();
    expect(api.post).toHaveBeenCalledTimes(requestsBeforeUnchecking);
    await user.click(screen.getByRole('checkbox', { name: 'ตรวจแล้ว ไม่พบปัญหา' }));
    await waitFor(() => expect(saveButton()).toBeEnabled());
    expect(api.post.mock.calls[api.post.mock.calls.length - 1]?.[1]).toEqual({
      answers: completeAnswers,
    });
  });

  it('discards a late preview after the answers change and saves only the current server token', async () => {
    const oldPreview = deferred<{ data: Preview }>();
    const currentPreview = deferred<{ data: Preview }>();
    api.post.mockReturnValueOnce(oldPreview.promise).mockReturnValueOnce(currentPreview.promise);
    const { user } = setup();
    await answerAll(user);
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    expect(saveButton()).toBeDisabled();
    await user.click(screen.getByRole('radio', { name: 'หน้าจอมีรอย' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2));
    await act(async () => {
      currentPreview.resolve({
        data: quote({ price: '7000.25', cashPrice: '7000.25', previewToken: 'current-token' }),
      });
    });
    await waitFor(() => expect(saveButton()).toBeEnabled());
    await act(async () => {
      oldPreview.resolve({
        data: quote({ price: '9999.99', cashPrice: '9999.99', previewToken: 'stale-token' }),
      });
    });
    expect(screen.queryByText('฿9,999.99')).not.toBeInTheDocument();
    expect(screen.getByText('ราคาเสนอรับซื้อ').parentElement).toHaveTextContent('฿7,000.25');
    await user.click(saveButton());
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledExactlyOnceWith(`/trade-ins/${record.id}/appraise-online`, {
        mode: 'REVISED',
        answers: [{ questionKey: 'screen', choiceIds: ['screen-scratched'] }, completeAnswers[1]],
        previewToken: 'current-token',
      }),
    );
  });

  it.each(['BUYBACK', 'EXCHANGE'] as const)(
    'shows authoritative server amounts for %s',
    async (flow) => {
      api.post.mockResolvedValue({
        data: quote({ price: flow === 'EXCHANGE' ? '9341.97' : '8123.45' }),
      });
      const { user } = setup({ ...record, flow });
      await answerAll(user);
      const prices = await screen.findByRole('region', { name: 'รายละเอียดราคาประเมิน' });
      expect(within(prices).getByText('ราคากลางสภาพสมบูรณ์').parentElement).toHaveTextContent(
        '฿10,000',
      );
      expect(within(prices).getByText('ค่าปรับสภาพเครื่อง').parentElement).toHaveTextContent(
        '−฿1,876.55',
      );
      expect(within(prices).getByText('ราคารับซื้อเงินสด').parentElement).toHaveTextContent(
        '฿8,123.45',
      );
      expect(within(prices).getByText('เกรดจากผลประเมิน').parentElement).toHaveTextContent('B');
      if (flow === 'EXCHANGE') {
        expect(within(prices).getByText('ราคาเทิร์นรวมโบนัส 15%').parentElement).toHaveTextContent(
          '฿9,341.97',
        );
        expect(screen.getByText('ราคาเสนอเทิร์นเครื่อง').parentElement).toHaveTextContent(
          '฿9,341.97',
        );
      } else {
        expect(within(prices).queryByText(/ราคาเทิร์นรวมโบนัส/)).not.toBeInTheDocument();
        expect(screen.getByText('ราคาเสนอรับซื้อ').parentElement).toHaveTextContent('฿8,123.45');
      }
      expect(screen.queryByText('฿4,500')).not.toBeInTheDocument();
    },
  );

  it('preserves answers after a preview error and retries the same answers explicitly', async () => {
    api.post.mockRejectedValueOnce(new Error('คำนวณราคาไม่สำเร็จ'));
    const { user, onClose } = setup();
    await answerAll(user);
    expect(await screen.findByRole('alert')).toHaveTextContent('คำนวณราคาไม่สำเร็จ');
    expect(saveButton()).toBeDisabled();
    expect(screen.getByRole('radio', { name: 'หน้าจอสมบูรณ์' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'ตรวจแล้ว ไม่พบปัญหา' })).toBeChecked();
    await user.click(screen.getByRole('button', { name: 'คำนวณราคาใหม่' }));
    await waitFor(() => expect(saveButton()).toBeEnabled());
    expect(api.post).toHaveBeenCalledTimes(2);
    expect(api.post.mock.calls.map((call) => call[1])).toEqual([
      { answers: completeAnswers },
      { answers: completeAnswers },
    ]);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(api.patch).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('preserves answers after a save error and requires a refreshed server token before retrying', async () => {
    const newPreview = deferred<{ data: Preview }>();
    api.post.mockResolvedValueOnce({ data: quote() }).mockReturnValueOnce(newPreview.promise);
    api.patch.mockRejectedValueOnce(new Error('ราคากลางเปลี่ยนแล้ว'));
    const { user, onClose } = setup();
    await answerAll(user);
    await waitFor(() => expect(saveButton()).toBeEnabled());
    await user.click(saveButton());
    expect(await screen.findByRole('alert')).toHaveTextContent('ราคากลางเปลี่ยนแล้ว');
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2));
    expect(saveButton()).toBeDisabled();
    expect(screen.getByRole('radio', { name: 'หน้าจอสมบูรณ์' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'ตรวจแล้ว ไม่พบปัญหา' })).toBeChecked();
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => {
      newPreview.resolve({
        data: quote({ price: '8100', cashPrice: '8100', previewToken: 'refreshed-token' }),
      });
    });
    await waitFor(() => expect(saveButton()).toBeEnabled());
    expect(screen.getByText('ราคาเสนอรับซื้อ').parentElement).toHaveTextContent('฿8,100');
    await user.click(saveButton());
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(api.patch).toHaveBeenCalledTimes(2);
    expect(api.patch.mock.calls[api.patch.mock.calls.length - 1]?.[1]).toEqual({
      mode: 'REVISED',
      answers: completeAnswers,
      previewToken: 'refreshed-token',
    });
  });

  it('blocks edits, duplicate submits, back, cancel, close and Escape while saving', async () => {
    const pendingSave = deferred<{ data: { id: string } }>();
    api.patch.mockReturnValue(pendingSave.promise);
    const { user, onClose, onBack } = setup();
    await answerAll(user);
    await waitFor(() => expect(saveButton()).toBeEnabled());
    const form = saveButton().closest('form')!;
    await user.dblClick(saveButton());
    await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(1));
    expect(form).toHaveAttribute('aria-busy', 'true');
    const saving = screen.getByRole('button', { name: 'กำลังบันทึก...' });
    expect(saving).toBeDisabled();
    for (const name of ['กลับ', 'ยกเลิก', 'ปิดหน้าประเมินราคา']) {
      const button = screen.getByRole('button', { name });
      expect(button).toBeDisabled();
      await user.click(button);
    }
    for (const input of [...screen.getAllByRole('radio'), ...screen.getAllByRole('checkbox')]) {
      expect(input).toBeDisabled();
    }
    await user.click(screen.getByRole('radio', { name: 'หน้าจอมีรอย' }));
    await user.click(screen.getByRole('checkbox', { name: 'ตรวจแล้ว ไม่พบปัญหา' }));
    await user.keyboard('{Escape}');
    fireEvent.pointerDown(document.body);
    fireEvent.submit(form);
    expect(api.patch).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('radio', { name: 'หน้าจอสมบูรณ์' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'ตรวจแล้ว ไม่พบปัญหา' })).toBeChecked();
    expect(onClose).not.toHaveBeenCalled();
    expect(onBack).not.toHaveBeenCalled();
    await act(async () => {
      pendingSave.resolve({ data: { id: record.id } });
    });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('saves only answers and the server token, invalidates list/detail data, and closes on success', async () => {
    const { user, client, onClose, onBack } = setup();
    client.setQueryData(['trade-ins', { branchId: 'branch-1' }], { data: [record] });
    client.setQueryData(['trade-in-detail', record.id], record);
    client.setQueryData(['unrelated-data'], { retained: true });
    await answerAll(user);
    await waitFor(() => expect(saveButton()).toBeEnabled());
    await user.click(saveButton());
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(api.patch).toHaveBeenCalledExactlyOnceWith(`/trade-ins/${record.id}/appraise-online`, {
      mode: 'REVISED',
      answers: completeAnswers,
      previewToken: 'server-preview-1',
    });
    expect(client.getQueryState(['trade-ins', { branchId: 'branch-1' }])?.isInvalidated).toBe(true);
    expect(client.getQueryState(['trade-in-detail', record.id])?.isInvalidated).toBe(true);
    expect(client.getQueryState(['unrelated-data'])?.isInvalidated).toBe(false);
    expect(onBack).not.toHaveBeenCalled();
  });

  it('can retry loading the protected questionnaire after a request error', async () => {
    api.get.mockRejectedValueOnce(new Error('โหลดแบบตรวจไม่ได้'));
    const { user } = setup();
    expect(await screen.findByRole('alert')).toHaveTextContent('โหลดแบบตรวจไม่ได้');
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'โหลดแบบตรวจใหม่' }));
    expect(await screen.findByRole('radio', { name: 'หน้าจอสมบูรณ์' })).toBeVisible();
    expect(api.get).toHaveBeenCalledTimes(2);
    expect(api.post).not.toHaveBeenCalled();
    expect(saveButton()).toBeDisabled();
  });

  it('does not show an actionable appraisal when no questions are configured', async () => {
    api.get.mockResolvedValue({ data: { bonusPct: '15', questions: [] } });
    const { user, onClose } = setup();
    expect(await screen.findByRole('alert')).toHaveTextContent('ยังไม่มีแบบตรวจที่เปิดใช้งาน');
    expect(screen.queryByRole('button', { name: 'บันทึกผลตรวจและราคา' })).not.toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
    expect(api.patch).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'ปิด' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('blocks saving when the server has no valuation for the model and storage', async () => {
    api.post.mockResolvedValue({ data: { available: false } });
    const { user, onClose } = setup();
    await answerAll(user);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'ยังไม่มีราคากลางสำหรับรุ่นและความจุนี้',
    );
    expect(saveButton()).toBeDisabled();
    fireEvent.submit(saveButton().closest('form')!);
    expect(api.patch).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByRole('region', { name: 'รายละเอียดราคาประเมิน' })).not.toBeInTheDocument();
  });

  it.each([
    { label: 'zero price', overrides: { price: '0' } },
    { label: 'negative price', overrides: { price: '-1' } },
    { label: 'non-numeric price', overrides: { price: 'NaN' } },
    { label: 'infinite price', overrides: { price: 'Infinity' } },
    { label: 'missing preview token', overrides: { previewToken: undefined } },
  ])('blocks saving an unconfirmable quote: $label', async ({ overrides }) => {
    api.post.mockResolvedValue({ data: quote(overrides) });
    const { user } = setup();
    await answerAll(user);
    expect(await screen.findByRole('alert')).toHaveTextContent('ยังไม่มีราคารับซื้อที่ยืนยันได้');
    expect(saveButton()).toBeDisabled();
    fireEvent.submit(saveButton().closest('form')!);
    expect(api.patch).not.toHaveBeenCalled();
  });

  it.each([
    {
      deviceBrand: 'Samsung',
      deviceModel: 'Galaxy S25',
      deviceStorage: '128GB',
      message: 'รับซื้อเฉพาะ iPhone',
    },
    {
      deviceBrand: 'Apple',
      deviceModel: 'iPad Pro',
      deviceStorage: '128GB',
      message: 'รับซื้อเฉพาะ iPhone',
    },
    {
      deviceBrand: 'Apple',
      deviceModel: 'iPhone 15',
      deviceStorage: null,
      message: 'ยังไม่มีความจุเครื่อง',
    },
  ])(
    'blocks unsupported or incomplete device metadata: $deviceBrand $deviceModel $deviceStorage',
    async ({ message, ...device }) => {
      setup({ ...record, ...device });
      expect(await screen.findByRole('alert')).toHaveTextContent(message);
      expect(screen.queryByRole('radio')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'บันทึกผลตรวจและราคา' })).not.toBeInTheDocument();
      expect(api.post).not.toHaveBeenCalled();
      expect(api.patch).not.toHaveBeenCalled();
    },
  );

  it('renders nothing and makes no requests without a selected trade-in', () => {
    setup(null);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalled();
    expect(api.post).not.toHaveBeenCalled();
    expect(api.patch).not.toHaveBeenCalled();
  });
});
