import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import CostProfitStrip from '../CostProfitStrip';

describe('CostProfitStrip — แถบทุน/กำไร (แทนการ์ดใหญ่ 2 ใบ)', () => {
  it('OWNER/FM/ACCOUNTANT เห็นต้นทุน กำไร และ % ของราคาผ่อน', () => {
    render(
      <CostProfitStrip
        canSeeCost
        costPrice="15920"
        profit={3980}
        profitBasis="installment"
        basisPrice={19900}
      />,
    );
    expect(screen.getByText('15,920 ฿')).toBeInTheDocument();
    expect(screen.getByText('3,980 ฿')).toBeInTheDocument();
    expect(screen.getByText('(20% ของราคาผ่อน)')).toBeInTheDocument();
    expect(screen.getByText(/เห็นเฉพาะ/)).toBeInTheDocument();
  });

  it('SALES (canSeeCost=false) ไม่ render อะไรเลย — server strip costPrice อยู่แล้ว', () => {
    const { container } = render(
      <CostProfitStrip canSeeCost={false} costPrice={undefined} profit={null} profitBasis="cash" basisPrice={null} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('ไม่มีราคาขาย → กำไร "-" และไม่มี %', () => {
    render(
      <CostProfitStrip canSeeCost costPrice="15920" profit={null} profitBasis="cash" basisPrice={null} />,
    );
    expect(screen.getByText('15,920 ฿')).toBeInTheDocument();
    expect(screen.getByText('-')).toBeInTheDocument();
    expect(screen.queryByText(/ของราคา/)).toBeNull();
  });

  it('ขาดทุน → กำไรเป็นสีแดง (text-destructive)', () => {
    render(
      <CostProfitStrip canSeeCost costPrice="21000" profit={-1100} profitBasis="cash" basisPrice={19900} />,
    );
    expect(screen.getByText('-1,100 ฿')).toHaveClass('text-destructive');
  });
});
