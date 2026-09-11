import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router';

// role ของผู้ใช้ (vi.mock hoisted — อ้างผ่าน holder เหมือน RBAC component tests อื่นใน repo)
const authState = vi.hoisted(() => ({ role: 'OWNER' as string }));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { role: authState.role } }),
}));

import { InstallmentCalculatorCard } from '../InstallmentCalculatorCard';
import { resolveQuotes } from '../../utils/resolveQuotes';
import { INITIAL_CALC_STATE, type CalcState } from '../../hooks/useInstallmentCalcState';
import type { GfinTables } from '../../utils/gfinQuote';

// golden config เดียวกับ bcQuote.test.ts (19,900 → 12 งวด/2,985/2,413.20)
const bcConfig = {
  minDownPct: 0.15,
  commissionPct: 0.1,
  vatPct: 0.07,
  ratePctByMonths: { 5: 0.4, 6: 0.4, 7: 0.5, 8: 0.5, 10: 0.5, 12: 0.5 },
  allowedMonths: [5, 6, 7, 8, 10, 12],
};

// ตาราง GFIN: iPhone 15 128GB มือ 1 = 23,000 + OVER 1,000 · ผ่อนสูงสุด 12 → 12 งวด ดาวน์ 25% = 3,327/เดือน
const gfinTables: GfinTables = {
  mappings: [
    {
      id: 'm15',
      gfinSeries: 'iPhone 15',
      gfinVariant: null,
      storage: '128GB',
      condition: 'HAND_1',
      maxPrice: '23000',
      modelMatchPattern: 'iPhone 15',
      isActive: true,
    },
  ],
  rules: [
    {
      id: 'r15',
      label: 'iPhone 15 มือ 1',
      seriesPattern: 'iPhone 15',
      condition: 'HAND_1',
      allowance: '1000',
      maxMonths: 12,
      isActive: true,
    },
  ],
  factors: [
    { id: 'f10', months: 10, shopCommissionPct: 15, factor: '0.200952', feePerInstallment: '100', isActive: true },
    { id: 'f12', months: 12, shopCommissionPct: 15, factor: '0.179238', feePerInstallment: '100', isActive: true },
    { id: 'f12c5', months: 12, shopCommissionPct: 5, factor: '0.16', feePerInstallment: '100', isActive: true },
  ],
  settings: {
    minDownPct: 25,
    maxDownPct: 80,
    downStepPct: 5,
    contractFee: 100,
    commissionPctByCategory: { PHONE: 15, TABLET: 5 },
  },
};

const iphone15 = {
  id: 'p1',
  category: 'PHONE_NEW',
  brand: 'Apple',
  model: 'iPhone 15',
  storage: '128GB',
  cashPrice: '19900',
  installmentPrice: '19900',
  prices: [],
};

function renderCard({
  product = iphone15,
  state = INITIAL_CALC_STATE,
  onChange = vi.fn(),
  canEditPrice = true,
  onEditPrice = vi.fn(),
  tables = gfinTables as GfinTables | undefined,
  config = bcConfig as typeof bcConfig | undefined,
}: {
  product?: typeof iphone15;
  state?: CalcState;
  onChange?: ReturnType<typeof vi.fn>;
  canEditPrice?: boolean;
  onEditPrice?: ReturnType<typeof vi.fn>;
  tables?: GfinTables | undefined;
  config?: typeof bcConfig | undefined;
} = {}) {
  const quotes = resolveQuotes({ product, state, bcConfig: config, gfinTables: tables });
  render(
    <BrowserRouter>
      <InstallmentCalculatorCard
        product={product}
        state={state}
        quotes={quotes}
        onChange={onChange}
        canEditPrice={canEditPrice}
        onEditPrice={onEditPrice}
        gfinSettings={tables?.settings}
        loading={false}
      />
    </BrowserRouter>,
  );
  return { onChange, onEditPrice };
}

describe('InstallmentCalculatorCard — การ์ดเดียว สลับ BESTCHOICE | GFIN', () => {
  beforeEach(() => {
    authState.role = 'OWNER';
  });

  it('เริ่มที่ BESTCHOICE: ค่างวด 2,413.20 · dropdown บอกค่างวดในตัวเลือก · แถวคอม (กางรายละเอียด) · ปุ่มทำสัญญา · บรรทัดเทียบ GFIN 3,327', async () => {
    renderCard();
    expect(screen.getByRole('tab', { name: /BESTCHOICE/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getAllByText(/2,413\.20/).length).toBeGreaterThan(0);
    expect(screen.getByRole('combobox', { name: 'งวด' })).toHaveTextContent('12 งวด · ผ่อนเดือนละ 2,413.20');
    // รายละเอียดพับเป็นค่าเริ่มต้น — กางแล้วต้องเห็นแถวคอม
    expect(screen.queryByText(/^คอม/)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'รายละเอียดการคำนวณ' }));
    expect(screen.getByText(/^คอม/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ใช้ราคานี้ทำสัญญา' })).toBeInTheDocument();
    expect(screen.getByText(/3,327/)).toBeInTheDocument();
  });

  it('คลิกแท็บ GFIN → onChange({ fin: "gfin" })', async () => {
    const { onChange } = renderCard();
    await userEvent.click(screen.getByRole('tab', { name: /GFIN/ }));
    expect(onChange).toHaveBeenCalledWith({ fin: 'gfin' });
  });

  it('ฝั่ง GFIN: ดาวน์ที่แจ้ง GFIN 6,000 → ลูกค้าจ่ายจริง 1,900 · รวมเงินผ่อนต่องวด 3,327 · แผงเฉพาะร้าน (คอม 2,700 · โอนให้ร้าน 20,600) · ไม่มีปุ่มทำสัญญา', () => {
    renderCard({ state: { ...INITIAL_CALC_STATE, fin: 'gfin' } });
    expect(screen.getByRole('tab', { name: /GFIN/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('ดาวน์ที่แจ้ง GFIN (25%)')).toBeInTheDocument();
    expect(screen.getByText('6,000 ฿')).toBeInTheDocument();
    expect(screen.getByText('1,900 ฿')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'ผ่อนชำระ' })).toHaveTextContent('12 งวด · ผ่อนเดือนละ 3,327');
    expect(screen.getByText('2,700.00')).toBeInTheDocument();
    expect(screen.getByText('20,600.00')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'ใช้ราคานี้ทำสัญญา' })).toBeNull();
  });

  it('SALES: ไม่เห็นแถวคอม BESTCHOICE · ช่อง % คอมมิชชั่น · แผงเฉพาะร้านค้า', async () => {
    authState.role = 'SALES';
    const first = renderCard();
    await userEvent.click(screen.getByRole('button', { name: 'รายละเอียดการคำนวณ' }));
    expect(screen.getByText(/^ดอกเบี้ย/)).toBeInTheDocument();
    expect(screen.queryByText(/^คอม/)).toBeNull();
    expect(first.onChange).not.toHaveBeenCalled();
    cleanup();

    renderCard({ state: { ...INITIAL_CALC_STATE, fin: 'gfin' } });
    expect(screen.queryByRole('combobox', { name: '% คอมมิชชั่น' })).toBeNull();
    expect(screen.queryByText('เฉพาะร้านค้า')).toBeNull();
    // แต่ยังเห็นค่างวดที่ถูกต้อง (เรทของคอม 15 ตามหมวด)
    expect(screen.getByRole('combobox', { name: 'ผ่อนชำระ' })).toHaveTextContent('3,327');
  });

  it('รุ่นไม่อยู่ในตารางราคา GFIN → แท็บ GFIN กดไม่ได้ + บอกเหตุผล', () => {
    const samsung = {
      ...iphone15,
      brand: 'Samsung',
      model: 'Galaxy S24',
      storage: '256GB',
      category: 'PHONE_USED',
    };
    renderCard({ product: samsung });
    expect(screen.getByRole('tab', { name: /GFIN/ })).toBeDisabled();
    expect(screen.getByText(/รุ่นนี้ไม่อยู่ในตารางราคาของ GFIN/)).toBeInTheDocument();
  });

  it('ไม่มีราคาผ่อน → กล่องเตือนเดิม + ปุ่มไปแก้ราคาเมื่อ canEditPrice', async () => {
    const { onEditPrice } = renderCard({
      product: { ...iphone15, installmentPrice: null },
    });
    expect(screen.getByText(/ยังไม่ได้กำหนดราคาเงินผ่อน/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'ไปแก้ราคา' }));
    expect(onEditPrice).toHaveBeenCalled();
  });

  it('พิมพ์เงินดาวน์ใหม่ → onChange อัปเดต bc.downAmount', async () => {
    const { onChange } = renderCard();
    const down = screen.getByRole('spinbutton', { name: 'เงินดาวน์ (฿)' });
    await userEvent.clear(down);
    await userEvent.type(down, '5000');
    expect(onChange).toHaveBeenLastCalledWith(expect.any(Function));
  });
});
