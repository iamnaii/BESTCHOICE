import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
  allowedMonths?: number[];
  defaultMonths?: number;
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
function setup(
  id = 'device-1',
  price = 20000,
  initialDown?: number | null,
  initialMonths?: number | null,
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  clients.push(client);
  const view = (productId: string) => (
    <QueryClientProvider client={client}>
      <InstallmentCalculatorCard
        productId={productId}
        cashPrice={12000}
        installmentPrice={price}
        initialDown={initialDown}
        initialMonths={initialMonths}
      />
    </QueryClientProvider>
  );
  const rendered = render(view(id));
  return { ...rendered, changeDevice: (next: string) => rendered.rerender(view(next)) };
}
const BC_TERM = 'จำนวนงวด เรท 1';
const GFIN_TERM = 'จำนวนงวด เรท 2';
const provider = (request: Request) => request.params.get('provider');
async function answer(batch: Request[], monthlyPayment: number, extra: Partial<Result> = {}) {
  await act(async () =>
    batch.forEach((request) =>
      request.resolve({
        data: {
          available: true,
          monthlyPayment,
          downAmount: 3000,
          months: Number(request.params.get('months') ?? 12),
          allowedMonths: [6, 8, 10, 12],
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
    expect(await screen.findAllByText('฿1,235')).toHaveLength(2);
    // ลดดาวน์/งวดของ BESTCHOICE คิดใหม่แค่ BESTCHOICE — GFIN มีงวดของตัวเอง
    fireEvent.change(screen.getByLabelText(BC_TERM), { target: { value: '6' } });
    const older = requests.slice(-1);
    expect(older.map(provider)).toEqual(['BC']);
    expect(screen.getAllByText('฿1,235')).toHaveLength(1);
    expect(screen.getByText('กำลังคำนวณค่างวดล่าสุด…')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(BC_TERM), { target: { value: '8' } });
    const latest = requests.slice(-1);
    expect(older.every((request) => request.signal.aborted)).toBe(true);
    await answer(latest, 2567.89);
    expect(await screen.findAllByText('฿2,568')).toHaveLength(1);
    await answer(older, 9999);
    expect(screen.queryByText('฿9,999')).not.toBeInTheDocument();
    expect(screen.getAllByText('฿2,568')).toHaveLength(1);
  });

  it('distinguishes request errors from unavailable plans and retries only the failed provider', async () => {
    setup();
    await act(async () => {
      requests[0].reject(new Error('offline'));
      requests[1].resolve({ data: { available: false } });
    });
    const retry = await screen.findByRole('button', { name: 'ลองคำนวณ เรท 1 อีกครั้ง' });
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
    fireEvent.change(screen.getByLabelText(BC_TERM), { target: { value: '6' } });
    changeDevice('device-2');
    expect(screen.getByLabelText(BC_TERM)).toHaveValue('12');
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
  it('rounds the percentage-derived minimum and prefill up to the next 100 baht', async () => {
    setup('device-1', 25900);
    await answer(requests.slice(), 1290, { minDownPct: 15, downAmount: 3900 });
    expect(
      await screen.findByText('พิมพ์เป็น % หรือเป็นบาทก็ได้ · ขั้นต่ำ 15% (฿3,900)'),
    ).toBeInTheDocument();
    const pct = screen.getByLabelText('เงินดาวน์ เป็นเปอร์เซ็นต์');
    fireEvent.change(pct, { target: { value: '20' } });
    fireEvent.blur(pct);
    await waitFor(() => expect(screen.getByLabelText('เงินดาวน์ เป็นบาท')).toHaveValue(5200));
  });
  it('offers only the terms that have an interest rate (from the BC answer)', async () => {
    setup();
    await answer(requests.slice(), 3139, { allowedMonths: [10, 12] });
    const select = screen.getByLabelText(BC_TERM);
    await waitFor(() =>
      expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['10 งวด', '12 งวด']),
    );
  });

  it('moves to 12, else the first allowed term, when the current term has no rate', async () => {
    setup();
    await answer(requests.slice(), 3139, { allowedMonths: [10] });
    await waitFor(() => expect(screen.getByLabelText(BC_TERM)).toHaveValue('10'));
    expect(requests.slice(-1).map((r) => [provider(r), r.params.get('months')])).toEqual([['BC', '10']]);
  });

  // final manual check B2 — GFIN ใช้งวดของฝั่ง GFIN (iPhone 17 Pro: 15 งวด ตรงกับหน้า "ราคาและเรทผ่อน" / บอท / สติกเกอร์)
  it('GFIN: first request has no term — the server picks the staff-quote term · options come from the GFIN answer', async () => {
    setup('device-17pro', 39000);
    const [bc, gfin] = requests;
    expect(provider(bc)).toBe('BC');
    expect(bc.params.get('months')).toBe('12');
    expect(provider(gfin)).toBe('GFIN');
    expect(gfin.params.has('months')).toBe(false);
    await answer([bc], 3424, { allowedMonths: [10, 12], downAmount: 5900 });
    await answer([gfin], 4403, { months: 15, allowedMonths: [10, 12, 15], defaultMonths: 15, downAmount: 9700 });
    const gfinSelect = await screen.findByLabelText(GFIN_TERM);
    expect(within(gfinSelect).getAllByRole('option').map((o) => o.textContent)).toEqual(['10 งวด', '12 งวด', '15 งวด']);
    expect(gfinSelect).toHaveValue('15');
    expect(within(screen.getByLabelText(BC_TERM)).getAllByRole('option').map((o) => o.textContent)).toEqual([
      '10 งวด',
      '12 งวด',
    ]);
    expect(screen.getByText('฿4,403')).toBeInTheDocument();
    expect(screen.getByText('ดาวน์ ฿9,700 · 15 งวด')).toBeInTheDocument();
  });

  it('GFIN: picking a GFIN term asks only GFIN for that term', async () => {
    setup('device-17pro', 39000);
    await answer([requests[0]], 3424, { allowedMonths: [10, 12] });
    await answer([requests[1]], 4403, { months: 15, allowedMonths: [10, 12, 15], defaultMonths: 15 });
    const before = requests.length;
    fireEvent.change(await screen.findByLabelText(GFIN_TERM), { target: { value: '12' } });
    const asked = requests.slice(before);
    expect(asked.map((r) => [provider(r), r.params.get('months')])).toEqual([['GFIN', '12']]);
    expect(screen.getByLabelText(BC_TERM)).toHaveValue('12');
  });

  it('shows the monthly payment rounded up to whole baht', async () => {
    setup();
    await answer(requests.slice(), 3138.66);
    expect(await screen.findAllByText('฿3,139')).toHaveLength(2);
  });

  // สเปค 2026-11-25 หัวข้อ 7 — เรท 2 เปิดที่ค่าตั้งต้นของมัน (ตรงกับการ์ดหน้ารวม) จนกว่าลูกค้าจะแก้ช่องเงินดาวน์
  it('เรท 2: คำขอแรกไม่ส่ง % ดาวน์ · ลูกค้าแก้ช่องเงินดาวน์แล้วส่งทั้งสองเรท', async () => {
    setup();
    const [bc, gfin] = requests;
    expect(bc.params.get('downPct')).toBe('0.15');
    expect(gfin.params.has('downPct')).toBe(false);
    expect(gfin.params.has('customDownAmount')).toBe(false);
    await answer(requests.slice(), 1290);
    const amount = screen.getByLabelText('เงินดาวน์ เป็นบาท');
    fireEvent.change(amount, { target: { value: '4567' } });
    fireEvent.blur(amount);
    const after = requests.slice(-2);
    expect(after.map(provider)).toEqual(['BC', 'GFIN']);
    expect(after.every((r) => r.params.get('downPct') === '0.23')).toBe(true);
  });

  it('เรท 2 ดาวน์ 0 → ป้าย "ฟรีดาวน์" และบรรทัด "ไม่ต้องวางดาวน์"', async () => {
    setup();
    await answer([requests[0]], 2890, { downAmount: 4485 });
    await answer([requests[1]], 4061, { downAmount: 0, months: 15, allowedMonths: [12, 15], defaultMonths: 15 });
    expect(await screen.findByText('ฟรีดาวน์')).toBeInTheDocument();
    expect(screen.getByText('ไม่ต้องวางดาวน์ · 15 งวด')).toBeInTheDocument();
    expect(screen.getByText('ค่างวดต่ำกว่า')).toBeInTheDocument();
    expect(screen.getByText('ผ่อนจบเร็วกว่า')).toBeInTheDocument();
    expect(screen.queryByText('ดาวน์น้อยกว่า')).not.toBeInTheDocument();
  });

  it('สองเรทต่างกัน → ป้ายบอกความต่างตามตัวเลขจริง ไม่มีชื่อผู้ให้ผ่อน ไม่มียอดรวม', async () => {
    const { container } = setup();
    await answer([requests[0]], 4848, { downAmount: 6000 });
    await answer([requests[1]], 4821, { downAmount: 5900, months: 15, allowedMonths: [12, 15], defaultMonths: 15 });
    expect(await screen.findByText('ดาวน์น้อยกว่า')).toBeInTheDocument();
    expect(screen.getByText('ค่างวดต่ำกว่า')).toBeInTheDocument();
    expect(screen.getByText('ผ่อนจบเร็วกว่า')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/GFIN|BESTCHOICE|รวมจ่าย/);
  });
});

// สเปค 2026-11-25 หัวข้อ 7 (คำตัดสิน ข1) — เปิดจากการ์ดหน้ารวมที่ลูกค้าพิมพ์เงินดาวน์ไว้ (?down=)
describe('เปิดด้วยเงินดาวน์จากหน้ารวม (initialDown)', () => {
  it('เรท 1 ขอที่เงินดาวน์นั้น · เรท 2 ยังไม่ส่งดาวน์ · ไม่นับว่าลูกค้าแก้ช่อง จนกว่าจะพิมพ์เอง', async () => {
    setup('device-1', 20000, 5000);
    const [bc, gfin] = requests;
    expect(provider(bc)).toBe('BC');
    expect(bc.params.get('customDownAmount')).toBe('5000');
    expect(bc.params.get('downPct')).toBe('0.25');
    expect(provider(gfin)).toBe('GFIN');
    expect(gfin.params.has('downPct')).toBe(false);
    expect(gfin.params.has('customDownAmount')).toBe(false);
    expect(screen.getByLabelText('เงินดาวน์ เป็นบาท')).toHaveValue(5000);
    await answer([bc], 1960, { downAmount: 5000 });
    await answer([gfin], 4061, {
      downAmount: 0,
      months: 15,
      allowedMonths: [12, 15],
      defaultMonths: 15,
    });
    expect(await screen.findByText('ไม่ต้องวางดาวน์ · 15 งวด')).toBeInTheDocument();
    expect(requests).toHaveLength(2);

    const amount = screen.getByLabelText('เงินดาวน์ เป็นบาท');
    fireEvent.change(amount, { target: { value: '6000' } });
    fireEvent.blur(amount);
    const after = requests.slice(-2);
    expect(after.map(provider)).toEqual(['BC', 'GFIN']);
    expect(after.every((r) => r.params.get('customDownAmount') === '6000')).toBe(true);
  });

  it('เกินเพดาน 90% ของราคาผ่อน → ใช้เพดาน', () => {
    setup('device-1', 20000, 50000);
    const [bc, gfin] = requests;
    expect(bc.params.get('customDownAmount')).toBe('18000');
    expect(bc.params.get('downPct')).toBe('0.9');
    expect(gfin.params.has('customDownAmount')).toBe(false);
    expect(screen.getByLabelText('เงินดาวน์ เป็นบาท')).toHaveValue(18000);
  });

  it('ต่ำกว่าขั้นต่ำของเครื่อง → เรท 1 ถอยไปดาวน์ขั้นต่ำเอง โดยเรท 2 ยังไม่ถูกส่งดาวน์', async () => {
    setup('device-1', 20000, 1000);
    const [bc, gfin] = requests;
    expect(bc.params.get('customDownAmount')).toBe('1000');
    expect(
      screen.getByText('ต่ำกว่าขั้นต่ำ — กำลังปรับขึ้นเป็น 15% (฿3,000)'),
    ).toBeInTheDocument();
    await act(async () => {
      bc.resolve({ data: { available: false, minDownPct: 15, allowedMonths: [6, 8, 10, 12] } });
    });
    await answer([gfin], 4061, {
      downAmount: 0,
      months: 15,
      allowedMonths: [12, 15],
      defaultMonths: 15,
    });
    // ตัว clamp เดิมของช่องปรับขึ้นเองเมื่อค่านิ่ง (~0.9 วินาที) — จบที่ 15% = ฿3,000
    await waitFor(
      () => {
        const lastBc = requests.filter((r) => provider(r) === 'BC').slice(-1)[0];
        expect(lastBc.params.get('downPct')).toBe('0.15');
        expect(['3000', null]).toContain(lastBc.params.get('customDownAmount'));
      },
      { timeout: 3000 },
    );
    expect(screen.getByLabelText('เงินดาวน์ เป็นบาท')).toHaveValue(3000);
    const gfinRequests = requests.filter((r) => provider(r) === 'GFIN');
    expect(
      gfinRequests.every((r) => !r.params.has('downPct') && !r.params.has('customDownAmount')),
    ).toBe(true);
  });

  it('ไม่ส่ง / 0 / ไม่ใช่จำนวนเต็ม → พฤติกรรมเดิม (ดาวน์ขั้นต่ำเป็น %)', () => {
    for (const bad of [undefined, null, 0, 12.5]) {
      requests.length = 0;
      const view = setup('device-1', 20000, bad);
      const [bc] = requests;
      expect(bc.params.get('downPct')).toBe('0.15');
      expect(bc.params.has('customDownAmount')).toBe(false);
      view.unmount();
    }
  });
});

describe('เปิดด้วยจำนวนงวดจากการ์ด (initialMonths)', () => {
  it('เรท 1 ขอที่งวดนั้น · เรท 2 ไม่ส่งงวดและไม่ส่งดาวน์ · ไม่นับว่าลูกค้าแก้ช่องเงินดาวน์', async () => {
    setup('device-1', 20000, null, 6);
    const [bc, gfin] = requests;
    expect(provider(bc)).toBe('BC');
    expect(bc.params.get('months')).toBe('6');
    expect(provider(gfin)).toBe('GFIN');
    expect(gfin.params.has('months')).toBe(false);
    expect(gfin.params.has('downPct')).toBe(false);
    expect(gfin.params.has('customDownAmount')).toBe(false);
    await answer([bc], 1960);
    await answer([gfin], 4061, { months: 15, allowedMonths: [12, 15], defaultMonths: 15 });
    expect(screen.getByLabelText(BC_TERM)).toHaveValue('6');
    expect(requests).toHaveLength(2);
  });

  it('งวดที่ส่งมาไม่อยู่ในงวดที่เรท 1 รับ → ใช้กติกาเดิม (12 ถ้ามี) ไม่ค้างที่งวดนั้น', async () => {
    setup('device-1', 20000, null, 7);
    const [bc, gfin] = requests;
    expect(bc.params.get('months')).toBe('7');
    await answer([bc], 1960);
    await answer([gfin], 4061, { allowedMonths: [12, 15], defaultMonths: 15 });
    await waitFor(() => expect(requests.at(-1)!.params.get('months')).toBe('12'));
    expect(screen.getByLabelText(BC_TERM)).toHaveValue('12');
  });

  it('ไม่ส่ง / null → เปิดที่ 12 เหมือนเดิม', () => {
    setup('device-1', 20000, null, null);
    expect(requests[0].params.get('months')).toBe('12');
  });
});
