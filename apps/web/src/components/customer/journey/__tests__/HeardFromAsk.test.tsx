import type { ComponentProps } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { journeySummary } from '@/pages/CustomerDetailPage/__tests__/journeyFixtures';
import HeardFromAsk from '../HeardFromAsk';

/**
 * 🔴 hook ของ vitest ห้าม return ค่า — คร่อมปีกกาเสมอ
 * api ถูก mock ระดับ HTTP (ไม่ mock hook ของ Task 10) — ทดสอบคู่กับ useRecordJourneyEntry / deleteJourneyEntry ตัวจริง
 */
const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  del: vi.fn(),
  /** summary ปัจจุบันของ c1 — POST/DELETE เปลี่ยนค่านี้ ให้ GET ที่ refetch ได้ค่าเดียวกับคำตอบ */
  summary: null as unknown,
}));

vi.mock('@/lib/api', () => ({
  default: { get: mocks.get, post: mocks.post, delete: mocks.del },
  getErrorMessage: () => 'บันทึกไม่สำเร็จ',
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), dismiss: vi.fn() } }));

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHIP_LABELS = ['โฆษณา FB', 'เพจ/โพสต์', 'TikTok', 'LINE', 'Google', 'เพื่อนแนะนำ', 'ผ่านหน้าร้าน', 'ลูกค้าเก่า', 'อื่น ๆ'];

type AskProps = ComponentProps<typeof HeardFromAsk>;
type SavedToast = {
  duration?: number;
  action?: { label: string; onClick: (event: unknown) => void };
  onAutoClose?: () => void;
  onDismiss?: () => void;
};

const walkIn = (over: Parameters<typeof journeySummary>[0] = {}) =>
  journeySummary({ firstChannel: 'WALK_IN', firstSource: 'WALK_IN', firstSourceLabel: 'หน้าร้าน', askHeardFrom: true, ...over });

function renderAsk(props: Partial<AskProps> = {}, options: { seed?: boolean } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  if (options.seed !== false) client.setQueryData(['customer-journey-summary', 'c1'], mocks.summary);
  const onSkip = vi.fn();
  const view = render(
    <QueryClientProvider client={client}>
      <HeardFromAsk customerId="c1" variant="card" onSkip={onSkip} {...props} />
    </QueryClientProvider>,
  );
  return { ...view, onSkip };
}

function savedToast(): SavedToast {
  const call = vi.mocked(toast.success).mock.calls.find(([title]) => title === 'บันทึกแล้ว');
  if (!call) throw new Error('ยังไม่มี toast "บันทึกแล้ว"');
  return call[1] as unknown as SavedToast;
}

async function answerFriend() {
  fireEvent.click(await screen.findByRole('button', { name: 'เพื่อนแนะนำ' }));
  await waitFor(() =>
    expect(screen.getByTestId('heard-from-ask')).toHaveTextContent('ลูกค้าบอกว่ารู้จักร้านจากเพื่อนแนะนำ'),
  );
}

beforeEach(() => {
  mocks.summary = walkIn();
  mocks.get.mockReset();
  mocks.get.mockImplementation(async (url: string) => {
    if (url === '/customers/c1/journey/summary') return { data: mocks.summary };
    throw new Error(`unexpected GET ${url}`);
  });
  mocks.post.mockReset();
  mocks.post.mockImplementation(async (url: string, body: { heardFrom?: string }) => {
    if (url === '/customers/c1/journey/entries') {
      mocks.summary = walkIn({ askHeardFrom: false, heardFrom: body.heardFrom ?? null });
      return { data: { entryId: 'e-hf', event: null, summary: mocks.summary } };
    }
    throw new Error(`unexpected POST ${url}`);
  });
  mocks.del.mockReset();
  mocks.del.mockImplementation(async (url: string) => {
    if (url === '/customers/c1/journey/entries/e-hf') {
      mocks.summary = walkIn();
      return { data: { summary: mocks.summary } };
    }
    throw new Error(`unexpected DELETE ${url}`);
  });
  vi.mocked(toast.success).mockReset().mockReturnValue('toast-1');
  vi.mocked(toast.error).mockReset();
  vi.mocked(toast.dismiss).mockReset();
});

describe('HeardFromAsk', () => {
  it('ลูกค้าหน้าร้านที่ยังไม่ตอบ: ชิป 9 ตัว · แบนเนอร์พื้น primary/5 · การ์ดพื้น card', async () => {
    const banner = renderAsk({ variant: 'banner' });
    expect(await screen.findByTestId('heard-from-ask')).toHaveClass('rounded-lg', 'border-primary/20', 'bg-primary/5', 'p-3');
    for (const label of CHIP_LABELS) expect(screen.getByRole('button', { name: label })).toBeEnabled();
    banner.unmount();

    renderAsk({ variant: 'card' });
    expect(await screen.findByTestId('heard-from-ask')).toHaveClass('mt-4', 'rounded-xl', 'border-border', 'bg-card', 'p-4');
  });

  it('askHeardFrom = false · summary เป็น redirect · summary ยังโหลด → ไม่แสดงอะไร', async () => {
    mocks.summary = walkIn({ askHeardFrom: false, heardFrom: 'FRIEND' });
    const answeredView = renderAsk();
    expect(screen.queryByTestId('heard-from-ask')).toBeNull();
    answeredView.unmount();

    mocks.summary = { redirectToCustomerId: 'c2' };
    const redirectView = renderAsk();
    expect(screen.queryByTestId('heard-from-ask')).toBeNull();
    redirectView.unmount();

    mocks.get.mockImplementation(() => new Promise(() => {}));
    renderAsk({}, { seed: false });
    await waitFor(() => expect(mocks.get).toHaveBeenCalledWith('/customers/c1/journey/summary'));
    expect(screen.queryByTestId('heard-from-ask')).toBeNull();
  });

  it('แตะชิป = POST HEARD_FROM พร้อม UUID → ยุบเป็นบรรทัด + ลิงก์เลิกทำ + toast 10 วินาที', async () => {
    renderAsk();
    await answerFriend();

    const [url, body] = mocks.post.mock.calls[0];
    expect(url).toBe('/customers/c1/journey/entries');
    expect(body).toEqual({ kind: 'HEARD_FROM', heardFrom: 'FRIEND', clientRequestId: expect.stringMatching(UUID_RE) });

    const line = screen.getByTestId('heard-from-ask');
    expect(line).toHaveClass('mt-4', 'flex', 'items-center', 'gap-2', 'rounded-xl', 'border-border', 'bg-card', 'px-4', 'py-3', 'text-sm', 'leading-snug');
    expect(screen.getByRole('button', { name: 'เลิกทำ' })).toHaveClass('text-xs');
    expect(screen.queryByRole('button', { name: 'โฆษณา FB' })).toBeNull();
    expect(savedToast()).toEqual(
      expect.objectContaining({
        duration: 10000,
        action: expect.objectContaining({ label: 'เลิกทำ' }),
        onAutoClose: expect.any(Function),
        onDismiss: expect.any(Function),
      }),
    );
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('ระหว่างรอผล ชิปทุกตัวกดไม่ได้ และแตะซ้ำไม่ยิงซ้ำ', async () => {
    let finish!: () => void;
    mocks.post.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = () => {
            mocks.summary = walkIn({ askHeardFrom: false, heardFrom: 'FRIEND' });
            resolve({ data: { entryId: 'e-hf', event: null, summary: mocks.summary } });
          };
        }),
    );
    renderAsk();
    const friend = await screen.findByRole('button', { name: 'เพื่อนแนะนำ' });
    const google = screen.getByRole('button', { name: 'Google' });

    fireEvent.click(friend);
    await waitFor(() => expect(google).toBeDisabled());
    expect(friend).toBeDisabled();
    fireEvent.click(google);
    fireEvent.click(friend);
    expect(mocks.post).toHaveBeenCalledTimes(1);

    await act(async () => {
      finish();
    });
    expect(await screen.findByRole('button', { name: 'เลิกทำ' })).toBeInTheDocument();
  });

  it('ลิงก์ "เลิกทำ" ในการ์ด → DELETE รายการเดียวกัน · ปิด toast · กลับเป็นชิป', async () => {
    renderAsk();
    await answerFriend();

    fireEvent.click(screen.getByRole('button', { name: 'เลิกทำ' }));

    expect(await screen.findByRole('button', { name: 'เพื่อนแนะนำ' })).toBeEnabled();
    expect(mocks.del.mock.calls[0][0]).toBe('/customers/c1/journey/entries/e-hf');
    expect(toast.dismiss).toHaveBeenCalledWith('toast-1');
    expect(vi.mocked(toast.success).mock.calls.some(([title]) => title === 'เลิกทำแล้ว')).toBe(true);
    expect(screen.queryByText(/ลูกค้าบอกว่ารู้จักร้านจาก/)).toBeNull();
  });

  it('"เลิกทำ" จาก toast ลบรายการเดียวกัน โดยไม่สั่งปิด toast ซ้ำ', async () => {
    renderAsk();
    await answerFriend();

    await act(async () => {
      savedToast().action?.onClick({});
    });

    expect(await screen.findByRole('button', { name: 'เพื่อนแนะนำ' })).toBeInTheDocument();
    expect(mocks.del.mock.calls[0][0]).toBe('/customers/c1/journey/entries/e-hf');
    expect(toast.dismiss).not.toHaveBeenCalled();
  });

  it('toast หมดเวลา: การ์ดคงบรรทัดไว้แต่ไม่มีลิงก์เลิกทำ', async () => {
    renderAsk();
    await answerFriend();

    act(() => {
      savedToast().onAutoClose?.();
    });

    expect(screen.getByTestId('heard-from-ask')).toHaveTextContent('ลูกค้าบอกว่ารู้จักร้านจากเพื่อนแนะนำ');
    expect(screen.queryByRole('button', { name: 'เลิกทำ' })).toBeNull();
  });

  it('toast หมดเวลา: แบนเนอร์หายไปทั้งแถบ', async () => {
    renderAsk({ variant: 'banner' });
    await answerFriend();
    expect(screen.getByTestId('heard-from-ask')).toHaveClass('rounded-lg', 'border-primary/20', 'bg-primary/5', 'px-3', 'py-2');

    act(() => {
      savedToast().onAutoClose?.();
    });

    expect(screen.queryByTestId('heard-from-ask')).toBeNull();
  });

  it('"ข้าม" เรียก onSkip และไม่บันทึกอะไร', async () => {
    const { onSkip } = renderAsk();
    fireEvent.click(await screen.findByRole('button', { name: 'ข้าม' }));
    expect(onSkip).toHaveBeenCalledOnce();
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it('บันทึกไม่สำเร็จ → toast.error · ชิปกลับมากดได้ · ไม่มีบรรทัดยุบ', async () => {
    mocks.post.mockImplementation(() => Promise.reject(new Error('network')));
    renderAsk();
    fireEvent.click(await screen.findByRole('button', { name: 'เพื่อนแนะนำ' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('บันทึกไม่สำเร็จ'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'เพื่อนแนะนำ' })).toBeEnabled());
    expect(screen.queryByText(/ลูกค้าบอกว่ารู้จักร้านจาก/)).toBeNull();
    expect(toast.success).not.toHaveBeenCalled();
  });
});
