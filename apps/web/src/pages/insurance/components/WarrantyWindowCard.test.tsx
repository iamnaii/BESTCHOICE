import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WarrantyWindowCard } from './WarrantyWindowCard';

describe('WarrantyWindowCard', () => {
  it('renders "—" for all windows when all values are null', () => {
    render(
      <WarrantyWindowCard windows={{ sevenDayDefect: null, shopWarranty: null, mfrWarranty: null }} />,
    );
    // Three rows — each should show the dash placeholder
    const dashes = screen.getAllByText('—');
    expect(dashes).toHaveLength(3);
  });

  it('renders green "เหลือ 3 วัน" for sevenDayDefect = 3 (pct 3/7 = 43% > 30%)', () => {
    render(
      <WarrantyWindowCard windows={{ sevenDayDefect: 3, shopWarranty: null, mfrWarranty: null }} />,
    );
    const el = screen.getByText('เหลือ 3 วัน');
    expect(el).toBeInTheDocument();
    expect(el).toHaveClass('text-emerald-600');
  });

  it('renders red "หมดประกัน" for sevenDayDefect = 0', () => {
    render(
      <WarrantyWindowCard windows={{ sevenDayDefect: 0, shopWarranty: null, mfrWarranty: null }} />,
    );
    const el = screen.getByText('หมดประกัน');
    expect(el).toBeInTheDocument();
    expect(el).toHaveClass('text-red-600');
  });

  it('renders amber "เหลือ 5 วัน" for shopWarranty = 5 (pct 5/60 = 8% ≤ 30%)', () => {
    render(
      <WarrantyWindowCard windows={{ sevenDayDefect: null, shopWarranty: 5, mfrWarranty: null }} />,
    );
    const el = screen.getByText('เหลือ 5 วัน');
    expect(el).toBeInTheDocument();
    expect(el).toHaveClass('text-amber-600');
  });

  it('renders green "เหลือ 200 วัน" for mfrWarranty = 200 (pct 200/365 = 55% > 30%)', () => {
    render(
      <WarrantyWindowCard windows={{ sevenDayDefect: null, shopWarranty: null, mfrWarranty: 200 }} />,
    );
    const el = screen.getByText('เหลือ 200 วัน');
    expect(el).toBeInTheDocument();
    expect(el).toHaveClass('text-emerald-600');
  });
});
