import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StockReceivedDate } from './StockProductCells';
import type { StockProduct } from '../types';

const product: StockProduct = {
  id: 'stock-date',
  name: 'iPhone 16',
  model: 'iPhone 16',
  brand: 'Apple',
  category: 'PHONE_NEW',
  imeiSerial: null,
  costPrice: '10000',
  cashPrice: '15000',
  installmentPrice: '18000',
  color: 'Black',
  storage: '128GB',
  status: 'IN_STOCK',
  branch: { id: 'branch', name: 'สาขาทดสอบ' },
  supplier: null,
  prices: [],
  createdAt: '2020-01-01T10:00:00+07:00',
  stockInDate: '2026-08-20T23:00:00+07:00',
};

describe('Stock received date and age', () => {
  beforeEach(() =>
    vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-09-09T08:00:00+07:00').getTime()),
  );
  afterEach(() => vi.restoreAllMocks());

  it('uses the latest stock entry instead of record creation and counts calendar days', () => {
    render(<StockReceivedDate product={product} />);
    expect(screen.getByText('20/08/2569')).toBeInTheDocument();
    expect(screen.getByText('ในสต็อก 20 วัน')).toBeInTheDocument();
  });

  it.each([
    ['2026-09-08T23:59:00+07:00', 'ในสต็อก 1 วัน'],
    ['2026-09-09T00:01:00+07:00', 'ในสต็อก 0 วัน'],
  ])('counts entry at %s correctly', (stockInDate, label) => {
    render(<StockReceivedDate product={{ ...product, stockInDate }} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it.each([null, undefined, '', 'invalid'])(
    'does not invent a missing or invalid entry date (%s)',
    (stockInDate) => {
      render(<StockReceivedDate product={{ ...product, stockInDate }} />);
      expect(screen.getByText('ยังไม่ระบุ')).toBeInTheDocument();
      expect(screen.queryByText(/ในสต็อก/)).not.toBeInTheDocument();
    },
  );

  it.each(['SOLD_CASH', 'SOLD_INSTALLMENT', 'SOLD_RESELL', 'LOST', 'DEFECT_RETURN', 'QC_PENDING'])(
    'does not keep counting stock age for %s',
    (status) => {
      render(<StockReceivedDate product={{ ...product, status }} />);
      expect(screen.getByText('20/08/2569')).toBeInTheDocument();
      expect(screen.queryByText(/ในสต็อก/)).not.toBeInTheDocument();
    },
  );

  it('uses the Bangkok calendar for UTC timestamps across Thai midnight', () => {
    vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-09-09T16:00:00Z').getTime());
    render(<StockReceivedDate product={{ ...product, stockInDate: '2026-09-08T17:30:00Z' }} />);
    expect(screen.getByText('09/09/2569')).toBeInTheDocument();
    expect(screen.getByText('ในสต็อก 0 วัน')).toBeInTheDocument();
  });

  it('continues counting while a device is reserved', () => {
    render(<StockReceivedDate product={{ ...product, status: 'RESERVED' }} />);
    expect(screen.getByText('ในสต็อก 20 วัน')).toBeInTheDocument();
  });

  it('does not show an age for a future stock entry', () => {
    render(
      <StockReceivedDate product={{ ...product, stockInDate: '2026-09-10T00:00:00+07:00' }} />,
    );
    expect(screen.getByText('10/09/2569')).toBeInTheDocument();
    expect(screen.queryByText(/ในสต็อก/)).not.toBeInTheDocument();
  });
});
