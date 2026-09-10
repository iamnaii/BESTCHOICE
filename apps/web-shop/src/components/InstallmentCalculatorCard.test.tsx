import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InstallmentCalculatorCard } from './InstallmentCalculatorCard';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/api', () => ({ api: { get } }));
type Result = {
  available: boolean;
  monthlyPayment?: number;
  downAmount?: number;
  months?: number;
  minDownPct?: number;
};
type Request = {
  params: URLSearchParams;
  signal: AbortSignal;
  resolve: (response: { data: Result }) => void;
  reject: (error: Error) => void;
};
let requests: Request[];
const clients: QueryClient[] = [];
beforeEach(() => {
  requests = [];
  get.mockReset().mockImplementation(
    (url: string, { signal }: { signal: AbortSignal }) =>
      new Promise((resolve, reject) => {
        requests.push({
          params: new URL(url, 'https://example.test').searchParams,
          signal,
          resolve,
          reject,
        });
      }),
  );
});
afterEach(() => clients.splice(0).forEach((client) => client.clear()));
function setup(id = 'device-1') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  clients.push(client);
  const view = (productId: string) => (
    <QueryClientProvider client={client}>
      <InstallmentCalculatorCard productId={productId} cashPrice={12000} installmentPrice={20000} />
    </QueryClientProvider>
  );
  const rendered = render(view(id));
  return { ...rendered, changeDevice: (next: string) => rendered.rerender(view(next)) };
}
async function answer(batch: Request[], monthlyPayment: number, extra: Partial<Result> = {}) {
  await act(async () =>
    batch.forEach((request) =>
      request.resolve({
        data: {
          available: true,
          monthlyPayment,
          downAmount: 3000,
          months: Number(request.params.get('months')),
          ...extra,
        },
      }),
    ),
  );
}

describe('installment quote interactions', () => {
  it('hides stale prices while loading and ignores late responses to older selections', async () => {
    setup();
    await answer(requests.slice(), 1234.56);
    expect(await screen.findAllByText('฿1,234.56')).toHaveLength(2);
    fireEvent.change(screen.getByLabelText('จำนวนงวด:'), { target: { value: '6' } });
    const older = requests.slice(-2);
    expect(screen.queryByText('฿1,234.56')).not.toBeInTheDocument();
    expect(screen.getByText('กำลังคำนวณค่างวดล่าสุด…')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('จำนวนงวด:'), { target: { value: '8' } });
    const latest = requests.slice(-2);
    expect(older.every((request) => request.signal.aborted)).toBe(true);
    await answer(latest, 2567.89);
    expect(await screen.findAllByText('฿2,567.89')).toHaveLength(2);
    await answer(older, 9999);
    expect(screen.queryByText('฿9,999')).not.toBeInTheDocument();
    expect(screen.getAllByText('฿2,567.89')).toHaveLength(2);
  });

  it('distinguishes request errors from unavailable plans and retries only the failed provider', async () => {
    setup();
    await act(async () => {
      requests[0].reject(new Error('offline'));
      requests[1].resolve({ data: { available: false } });
    });
    const retry = await screen.findByRole('button', { name: 'ลองคำนวณ BESTCHOICE อีกครั้ง' });
    expect(
      screen.getByText('ยังไม่มีแผนผ่อนสำหรับตัวเลือกนี้ ลองเปลี่ยนเงินดาวน์หรืองวด'),
    ).toBeInTheDocument();
    fireEvent.click(retry);
    expect(requests).toHaveLength(3);
    expect(requests[2].params.get('provider')).toBe('BC');
    await answer([requests[2]], 1456);
    expect(await screen.findByText('฿1,456')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /ลองคำนวณ/ })).not.toBeInTheDocument();
  });

  it('sends exact baht to both providers and resets selections when the device changes', async () => {
    const { changeDevice } = setup();
    await answer(requests.slice(), 1290);
    await screen.findAllByText('฿1,290');
    const amount = screen.getByLabelText('เงินดาวน์ เป็นบาท');
    fireEvent.change(amount, { target: { value: '4567' } });
    fireEvent.blur(amount);
    const exact = requests.slice(-2);
    expect(exact.map((request) => request.params.get('provider'))).toEqual(['BC', 'GFIN']);
    expect(
      exact.every(
        (request) =>
          request.params.get('customDownAmount') === '4567' &&
          request.params.get('downPct') === '0.23',
      ),
    ).toBe(true);
    fireEvent.change(screen.getByLabelText('จำนวนงวด:'), { target: { value: '6' } });
    changeDevice('device-2');
    expect(screen.getByLabelText('จำนวนงวด:')).toHaveValue('12');
    expect(screen.getByLabelText('เงินดาวน์ เป็นเปอร์เซ็นต์')).toHaveValue(15);
    expect(
      requests
        .slice(-2)
        .every(
          (request) =>
            request.params.get('productId') === 'device-2' &&
            !request.params.has('customDownAmount'),
        ),
    ).toBe(true);
  });

  it('uses the server minimum and clamps committed down payments to that floor', async () => {
    setup();
    await answer(requests.slice(), 1290, { minDownPct: 25, downAmount: 5000 });
    const pct = screen.getByLabelText('เงินดาวน์ เป็นเปอร์เซ็นต์');
    await waitFor(() => expect(pct).toHaveAttribute('min', '25'));
    fireEvent.change(pct, { target: { value: '10' } });
    fireEvent.blur(pct);
    expect(pct).toHaveValue(25);
    expect(requests.slice(-2).every((request) => request.params.get('downPct') === '0.25')).toBe(
      true,
    );
  });
});
