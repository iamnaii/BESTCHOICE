import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import PricedExchangeFields, { type PricedForm } from './PricedExchangeFields';

const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/api', () => ({ default: { get: mocks.get } }));

const IMEI = '356812345674412';
const REPLACEMENT_ID = 'rp-1';

const BASE_VALUE: PricedForm = {
  buybackPrice: '',
  deviceCondition: 'B',
  newTotalMonths: '12',
  newInterestRatePct: '',
  conditionNote: '',
};

function Harness({ initial = BASE_VALUE }: { initial?: PricedForm }) {
  const [value, setValue] = useState(initial);
  return (
    <PricedExchangeFields
      imei={IMEI}
      replacementProductId={REPLACEMENT_ID}
      value={value}
      onChange={setValue}
    />
  );
}

function renderField(preview: unknown) {
  mocks.get.mockImplementation(async (url: string) => {
    if (url === '/after-sales/exchange/preview') return { data: preview };
    throw new Error(`unexpected GET ${url}`);
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>,
  );
}

const PREVIEW_PRICED = {
  mode: 'PRICED' as const,
  tier: 'REVIEW' as const,
  ncv: '9000.00',
  marketMin: '8000.00',
  expectedPl: '500.00',
  blockers: { overdueBlocked: false, advanceBlocked: false },
  hasUnpaidLateFee: false,
  plan: null,
};

const PREVIEW_MEMO = {
  mode: 'MEMO' as const,
  tier: null,
  ncv: '9000.00',
  marketMin: null,
  expectedPl: null,
  blockers: { overdueBlocked: false, advanceBlocked: false },
  hasUnpaidLateFee: false,
  plan: null,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PricedExchangeFields — ฟอร์มเปลี่ยนแบบมีราคา', () => {
  it('กรอกราคา/สภาพ/งวด/ดอกเบี้ย → query preview ถูกเรียกด้วยพารามิเตอร์ครบ (rate = pct/100)', async () => {
    renderField(PREVIEW_PRICED);

    await waitFor(() => expect(mocks.get).toHaveBeenCalled());

    await userEvent.type(screen.getByLabelText(/ราคารับซื้อเครื่องเดิม/), '9500');
    await userEvent.selectOptions(screen.getByLabelText('สภาพเครื่อง'), 'A');
    await userEvent.clear(screen.getByLabelText(/จำนวนงวดสัญญาใหม่/));
    await userEvent.type(screen.getByLabelText(/จำนวนงวดสัญญาใหม่/), '10');
    await userEvent.type(screen.getByLabelText(/อัตราดอกเบี้ย/), '8');

    // ค้นหาการเรียกครั้งที่พารามิเตอร์ครบทั้ง 4 ค่าตรงกันพอดี (ทุกคีย์ที่พิมพ์ยิง query ใหม่ —
    // ต้องหาแถวที่ state settle ครบแล้วจริง ไม่ใช่แถวกลางทางที่บางฟิลด์ยังไม่อัปเดต)
    await waitFor(() => {
      const match = mocks.get.mock.calls.find(
        ([, config]) =>
          config?.params?.buybackPrice === '9500' &&
          config?.params?.deviceCondition === 'A' &&
          config?.params?.newTotalMonths === '10' &&
          config?.params?.newInterestRate === '0.08',
      );
      expect(match).toBeTruthy();
      expect(match?.[1]?.params).toEqual({
        imei: IMEI,
        replacementProductId: REPLACEMENT_ID,
        buybackPrice: '9500',
        deviceCondition: 'A',
        newTotalMonths: '10',
        newInterestRate: '0.08',
      });
    });

    expect(await screen.findByText('ผจก.สาขาอนุมัติ')).toBeInTheDocument();
  });

  it('mode MEMO → ซ่อนช่องราคา/สภาพ/งวด/ดอกเบี้ย และแสดง "ราคาเท่าเดิม (MEMO)"', async () => {
    renderField(PREVIEW_MEMO);

    expect(await screen.findByText('ราคาเท่าเดิม (MEMO)')).toBeInTheDocument();
    expect(screen.queryByLabelText(/ราคารับซื้อเครื่องเดิม/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText('สภาพเครื่อง')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/จำนวนงวดสัญญาใหม่/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/อัตราดอกเบี้ย/)).not.toBeInTheDocument();
  });
});
