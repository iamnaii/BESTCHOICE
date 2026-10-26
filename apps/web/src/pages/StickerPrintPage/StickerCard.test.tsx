import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StickerCard, STICKER_SIZES, stickerStyles } from './StickerCard';
import type { StickerView } from './stickerView';

const base: StickerView = {
  productId: 'p1',
  model: 'iPhone 15 Pro Max 256GB',
  spec: 'ดำ · เครื่องศูนย์ไทย',
  origin: null,
  warrantyLabel: 'ประกันศูนย์ 12/03/27',
  used: { battery: 92, box: true },
  cash: '31,900',
  rates: [
    { no: 1, down: '3,000', monthly: '2,590', months: 12 },
    { no: 2, down: '6,000', monthly: '2,290', months: 12 },
  ],
  qrValue: '357200606382344',
  idLabel: 'IMEI',
  idText: '357200606382344',
};

describe('StickerCard — แบบ ค (เจ้าของเคาะ 2026-10-22)', () => {
  it('พิมพ์ทุกบรรทัด: รุ่น สเปก+ประกันศูนย์ ราคา ชิป เรท 1/2 IMEI ชื่อร้าน และ QR', () => {
    const { container } = render(<StickerCard view={base} size="60x40" showQr />);
    expect(screen.getByTestId('sticker')).toHaveClass('sticker--60x40');
    expect(screen.getByText('iPhone 15 Pro Max 256GB')).toBeInTheDocument();
    expect(screen.getByText(/ดำ · เครื่องศูนย์ไทย/)).toBeInTheDocument();
    expect(screen.getByText('ประกันศูนย์ 12/03/27')).toBeInTheDocument();
    expect(screen.getByText('31,900')).toBeInTheDocument();
    expect(screen.getByText('แบต 92%')).toBeInTheDocument();
    expect(screen.getByText('มีกล่อง')).toBeInTheDocument();
    expect(screen.getByText('เรท 1')).toBeInTheDocument();
    expect(screen.getByText('ดาวน์ 3,000')).toBeInTheDocument();
    expect(screen.getByText('เรท 2')).toBeInTheDocument();
    expect(screen.getByText('ดาวน์ 6,000')).toBeInTheDocument();
    expect(screen.getByText('IMEI')).toBeInTheDocument();
    expect(screen.getByText('357200606382344')).toBeInTheDocument();
    expect(screen.getByText('BESTCHOICE')).toBeInTheDocument();
    expect(screen.getByTestId('sticker-qr').querySelector('svg')).not.toBeNull();
    expect(container.querySelector('.st-rule')).not.toBeNull();
    // สเปก+ประกัน 43 ตัวอักษรยังพอดี 60×40 ที่ 8pt — ไม่ต้องย่อ
    expect(container.querySelector('.st-spec')).not.toHaveClass('st-spec--long');
  });

  it('ปิด QR → ไม่มีกล่อง QR แต่ข้อมูลอื่นครบ', () => {
    render(<StickerCard view={base} size="60x40" showQr={false} />);
    expect(screen.queryByTestId('sticker-qr')).toBeNull();
    expect(screen.getByText('31,900')).toBeInTheDocument();
    expect(screen.getByText('357200606382344')).toBeInTheDocument();
  });

  it('ไม่มีเรท (อุปกรณ์เสริม) → ดวงแบบ simple ไม่มีเส้นคั่น บรรทัดล่างเป็นรหัสสินค้า', () => {
    const { container } = render(
      <StickerCard
        view={{ ...base, model: 'ฟิล์มกระจก iPhone 15 Pro Max', spec: null, warrantyLabel: null, used: null, cash: '290', rates: [], qrValue: 'F17P01', idLabel: 'รหัส', idText: 'F17P01' }}
        size="60x40"
        showQr
      />,
    );
    expect(screen.getByTestId('sticker')).toHaveClass('sticker--simple');
    expect(container.querySelector('.st-rule')).toBeNull();
    expect(screen.queryByText(/เรท/)).toBeNull();
    expect(screen.getByText('รหัส')).toBeInTheDocument();
    expect(screen.getByText('F17P01')).toBeInTheDocument();
  });

  it('มีเรท 1 อย่างเดียว → แถวเรท 2 บอกว่าไม่มีในตาราง GFIN', () => {
    render(<StickerCard view={{ ...base, rates: [base.rates[0]] }} size="60x40" showQr />);
    expect(screen.getByText('ดาวน์ 3,000')).toBeInTheDocument();
    expect(screen.getByText('เรท 2')).toBeInTheDocument();
    expect(screen.getByText('ไม่มีในตาราง GFIN')).toBeInTheDocument();
  });

  it('สเปก+ประกันยาวเกิน 44 ตัวอักษร → ย่อตัวอักษร และถ้ายังยาวก็ย่อ "ประกันศูนย์" เป็น "ศูนย์" แทนการตัดวันที่', () => {
    const { container } = render(
      <StickerCard
        view={{ ...base, spec: 'ไทเทเนียมเทา · เครื่องศูนย์ไทย', warrantyLabel: 'ประกันศูนย์ 30/09/27' }}
        size="60x40"
        showQr
      />,
    );
    expect(container.querySelector('.st-spec')).toHaveClass('st-spec--long');
    expect(screen.getByText('ศูนย์ 30/09/27')).toBeInTheDocument();
  });

  it('ที่มาเครื่องพิมพ์เมื่อมีที่ และเป็นส่วนแรกที่ถูกตัดเมื่อบรรทัดยาวเกิน', () => {
    const { rerender } = render(<StickerCard view={{ ...base, spec: 'ดำ · 256GB', origin: 'ศูนย์ไทย' }} size="60x40" showQr />);
    expect(screen.getByText('ดำ · 256GB · ศูนย์ไทย')).toBeInTheDocument();

    rerender(<StickerCard view={{ ...base, spec: 'ไทเทเนียมเทา · 512GB', origin: 'ศูนย์ไทย' }} size="60x40" showQr />);
    expect(screen.getByText('ไทเทเนียมเทา · 512GB')).toBeInTheDocument();
    expect(screen.queryByText(/ศูนย์ไทย/)).toBeNull();
    expect(screen.getByText('ประกันศูนย์ 12/03/27')).toBeInTheDocument();
  });

  it('stickerStyles ต่อขนาด: @page เท่าม้วนที่เลือก และมีกฎของขนาดนั้น', () => {
    expect(stickerStyles('60x40')).toContain('@page { size: 60mm 40mm; margin: 0; }');
    expect(stickerStyles('50x40')).toContain('@page { size: 50mm 40mm; margin: 0; }');
    expect(stickerStyles('50x40')).toContain('.sticker--50x40');
    expect(stickerStyles('50x30')).toContain('@page { size: 50mm 30mm; margin: 0; }');
    expect(STICKER_SIZES['60x40']).toMatchObject({ w: 60, h: 40, label: '60 × 40 มม.' });
  });

  it('วันหมดประกันไม่ถูก … ตัด: ส่วนสีความจุเท่านั้นที่ย่อได้ (ชื่อสีอังกฤษกว้างกว่าที่นับตัวอักษร)', () => {
    const css = stickerStyles('60x40');
    // .st-spec เป็น flex: ส่วนสเปกหด+ตัดด้วย … ส่วนประกันไม่หด
    expect(css).toMatch(/\.st-spec \{[^}]*display: flex;/);
    expect(css).toMatch(/\.st-spec-text \{[^}]*text-overflow: ellipsis;/);
    expect(css).toMatch(/\.st-warranty \{[^}]*flex-shrink: 0;/);
    const { container } = render(
      <StickerCard view={{ ...base, spec: 'Desert Titanium · 1TB', warrantyLabel: 'ประกันศูนย์ 30/09/27' }} size="60x40" showQr />,
    );
    expect(container.querySelector('.st-warranty')?.textContent).toBe('ประกันศูนย์ 30/09/27');
  });

  it('ม้วน 50×30 ยังรักษาความสูงบรรทัดไทย ≥ 1.35 กับขอบขาว QR 0.8 มม. และเรท/ชื่อร้านพิมพ์ดำล้วน', () => {
    const css = stickerStyles('50x30');
    expect(css).toMatch(/\.sticker--50x30 \{[^}]*--st-model-lh: 1\.35;/);
    expect(css).toMatch(/\.sticker--50x30 \{[^}]*--st-spec-lh: 1\.35;/);
    expect(css).toMatch(/\.sticker--50x30 \{[^}]*--st-qr-pad: 0\.8mm;/);
    expect(css).not.toMatch(/\.st-rate-no \{[^}]*#333/);
    expect(css).toMatch(/\.st-footer \{[^}]*line-height: 1\.35;/);
  });
});
