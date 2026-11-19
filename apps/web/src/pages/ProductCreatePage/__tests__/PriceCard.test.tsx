import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ModelQuote } from '@installment/shared';
import PriceCard, { type PriceCardProps } from '../components/PriceCard';
import type { PriceFields } from '../utils/priceCard';

const TPL: PriceFields = { cash: '25900', bc: '25900', finance: '25900' };
const QUOTE: ModelQuote = {
  cash: { price: 25900, profit: 100 },
  // `allowedMonths` — ช่วง 2ก เพิ่มใน Rate1Quote (บอทบอกงวดที่เลือกได้)
  rate1: { price: 25900, downAmount: 3900, months: 12, monthlyContract: 3138.66, monthlyDisplay: 3139, recordedSalePrice: 28100, profit: 2300, allowedMonths: [10, 12] },
  rate2: { available: true, salePrice: 25900, submitPrice: 25900, downAmount: 6500, months: 12, monthly: 3403, recordedSalePrice: 28738, profit: 2938, originNote: false },
};
const paragraph = (text: string) => (_: string, el: Element | null) => el?.tagName === 'P' && el.textContent === text;

function renderCard(over: Partial<PriceCardProps> = {}) {
  const props: PriceCardProps = {
    category: 'PHONE_NEW',
    fields: TPL,
    onFieldChange: vi.fn(),
    templatePrices: TPL,
    templateLabel: 'iPhone 15 128GB มือ 1',
    templateNotFound: false,
    onUseTemplate: vi.fn(),
    quote: QUOTE,
    gfinBlocked: false,
    bcConfigMissing: false,
    accessoryProfit: null,
    costEntered: true,
    ...over,
  };
  render(<PriceCard {...props} />);
  return props;
}

describe('PriceCard (แบบ D)', () => {
  it('ตามราคากลาง: ป้ายหัวการ์ด + 3 แถวพร้อมดาวน์ / ค่างวด / กำไร', () => {
    renderCard();
    expect(screen.getByText('ตามตารางราคากลาง · iPhone 15 128GB มือ 1')).toBeInTheDocument();
    expect(screen.getByLabelText('ราคาเงินสด')).toHaveValue('25,900');
    expect(screen.getByText(paragraph('ดาวน์ 3,900 · ผ่อน 3,139 × 12 งวด'))).toBeInTheDocument();
    expect(screen.getByText(paragraph('ยอดจัด 22,000'))).toBeInTheDocument();
    expect(screen.getByText(paragraph('ดาวน์ 6,500 · ผ่อน 3,403 × 12 งวด'))).toBeInTheDocument();
    expect(screen.getByText(paragraph('ส่ง GFIN 25,900'))).toBeInTheDocument();
    for (const t of ['กำไร 100', 'กำไร 2,300', 'กำไร 2,938']) expect(screen.getByText(t)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'ใช้ราคากลางทั้งหมด' })).not.toBeInTheDocument();
  });

  it('แก้ราคาเอง: กรอบเตือน + "ราคากลาง X" + ปุ่ม "ใช้ราคากลางทั้งหมด"', async () => {
    const props = renderCard({ fields: { ...TPL, bc: '27000' } });
    const bc = screen.getByLabelText('ราคาผ่อน BESTCHOICE');
    expect(bc.className).toContain('border-warning');
    expect(screen.getByText('ราคากลาง 25,900')).toBeInTheDocument();
    expect(screen.getByText('แก้ 1 ราคาจากตารางราคากลาง')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'ใช้ราคากลางทั้งหมด' }));
    expect(props.onUseTemplate).toHaveBeenCalled();
  });

  it('พิมพ์ราคา → แจ้งช่องที่แก้', async () => {
    const props = renderCard({ fields: { cash: '', bc: '', finance: '' } });
    await userEvent.type(screen.getByLabelText('ราคาเงินสด'), '9');
    expect(props.onFieldChange).toHaveBeenLastCalledWith('cash', '9');
  });

  it('ขาดทุน: ป้าย "ขาดทุน X" มีไอคอน + คำ', () => {
    renderCard({ quote: { ...QUOTE, cash: { price: 25900, profit: -500 } } });
    const badge = screen.getByText('ขาดทุน 500');
    expect(badge.querySelector('svg')).not.toBeNull();
  });

  it('GFIN ไม่รับรุ่นนี้: ช่องปิด ว่าง + ข้อความ', () => {
    renderCard({
      gfinBlocked: true,
      quote: { ...QUOTE, rate2: { available: false, reason: 'NO_PRICE_LIST', message: 'GFIN ไม่รับรุ่นนี้' } },
    });
    const finance = screen.getByLabelText('ราคาขาย GFIN');
    expect(finance).toBeDisabled();
    expect(finance).toHaveValue('');
    expect(screen.getByText('GFIN ไม่รับรุ่นนี้ — ขายได้แค่เงินสดและผ่อน BESTCHOICE')).toBeInTheDocument();
  });

  it('GFIN ไม่รับรุ่นนี้ แม้ยังไม่กรอกราคา (ตัวคำนวณตอบ NO_PRICE): ช่องปิด + ข้อความ · ไม่นับเป็นช่องที่แก้', () => {
    renderCard({
      gfinBlocked: true,
      fields: { cash: '', bc: '', finance: '' },
      quote: { cash: null, rate1: null, rate2: { available: false, reason: 'NO_PRICE', message: 'กรอกราคาขาย GFIN หรือราคาผ่อน' } },
    });
    expect(screen.getByLabelText('ราคาขาย GFIN')).toBeDisabled();
    expect(screen.getByText('GFIN ไม่รับรุ่นนี้ — ขายได้แค่เงินสดและผ่อน BESTCHOICE')).toBeInTheDocument();
    expect(screen.queryByText('กรอกราคาขาย GFIN หรือราคาผ่อน')).not.toBeInTheDocument();
  });

  it('ยังไม่เลือกเครื่องไทย/นอก: หมายเหตุใต้แถว GFIN (สเปคข้อ 3.4)', () => {
    renderCard({ quote: { ...QUOTE, rate2: { ...(QUOTE.rate2 as Extract<ModelQuote['rate2'], { available: true }>), originNote: true } } });
    expect(
      screen.getByText(
        'ยังไม่ระบุเครื่องไทย/เครื่องนอก — คิด OVER ครึ่งเดียวไว้ก่อน (ราคาส่งที่ GFIN รับแน่นอน) · ถ้าเป็นเครื่องไทย เลือกเครื่องไทยในฟอร์มนี้ ราคาส่งจะได้ OVER เต็ม',
      ),
    ).toBeInTheDocument();
  });

  it('ไม่พบรุ่นในราคากลาง: ช่องว่างให้กรอกเอง + ข้อความ · ไม่มีป้ายราคากลาง', () => {
    renderCard({
      fields: { cash: '', bc: '', finance: '' },
      templatePrices: null,
      templateNotFound: true,
      quote: { cash: null, rate1: null, rate2: { available: false, reason: 'NO_PRICE', message: 'กรอกราคาขาย GFIN หรือราคาผ่อน' } },
    });
    expect(screen.getByText('ไม่พบรุ่นนี้ในตารางราคากลาง — กรอกราคาเอง')).toBeInTheDocument();
    expect(screen.getByLabelText('ราคาเงินสด')).toHaveValue('');
    expect(screen.queryByText(/ตามตารางราคากลาง/)).not.toBeInTheDocument();
  });

  it('อุปกรณ์เสริม: แถวเดียว "ราคาขาย"', () => {
    renderCard({ category: 'ACCESSORY', fields: { cash: '290', bc: '', finance: '' }, templatePrices: null, quote: null, accessoryProfit: 265 });
    expect(screen.getByLabelText('ราคาขาย')).toHaveValue('290');
    expect(screen.queryByLabelText('ราคาผ่อน BESTCHOICE')).not.toBeInTheDocument();
    expect(screen.getByText('กำไร 265')).toBeInTheDocument();
  });

  it('ยังไม่กรอกทุน → ไม่มีป้ายกำไร + บอกให้กรอกทุน', () => {
    renderCard({
      costEntered: false,
      quote: {
        cash: { price: 25900, profit: null },
        rate1: { ...QUOTE.rate1!, profit: null },
        rate2: { ...(QUOTE.rate2 as Extract<ModelQuote['rate2'], { available: true }>), profit: null },
      },
    });
    expect(screen.queryByText(/^กำไร /)).not.toBeInTheDocument();
    expect(screen.getByText('กรอกราคาทุนเพื่อดูกำไร')).toBeInTheDocument();
  });
});
