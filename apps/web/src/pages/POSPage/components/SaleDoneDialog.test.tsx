import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

vi.mock('@/components/sales/SaleReceiptActions', () => ({
  __esModule: true,
  default: ({ sale }: { sale: { id: string } }) => <div data-testid="receipt-actions" data-sale={sale.id} />,
}));

import SaleDoneDialog from './SaleDoneDialog';

describe('SaleDoneDialog — กล่องหลังขายสำเร็จ', () => {
  it('shows the sale number, net amount and receipt actions; ขายต่อ closes', () => {
    const onClose = vi.fn();
    render(<SaleDoneDialog sale={{ id: 's1', saleNumber: 'TEST-SALE-1', saleType: 'CASH', netAmount: '22900', downPaymentAmount: null }} onClose={onClose} />);
    expect(screen.getByText('ขายสำเร็จ · TEST-SALE-1')).toBeInTheDocument();
    expect(screen.getByText(/ยอดสุทธิ/)).toBeInTheDocument();
    expect(screen.getByText(/22,900/)).toBeInTheDocument();
    expect(screen.getByTestId('receipt-actions')).toHaveAttribute('data-sale', 's1');
    fireEvent.click(screen.getByRole('button', { name: 'ขายต่อ' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('labels the amount as เงินดาวน์ for external-finance sales', () => {
    render(<SaleDoneDialog sale={{ id: 's2', saleNumber: 'TEST-SALE-2', saleType: 'EXTERNAL_FINANCE', netAmount: '41900', downPaymentAmount: '5000' }} onClose={() => {}} />);
    expect(screen.getByText(/เงินดาวน์/)).toBeInTheDocument();
    expect(screen.getByText(/5,000/)).toBeInTheDocument();
  });

  it('renders nothing when there is no sale', () => {
    const { container } = render(<SaleDoneDialog sale={null} onClose={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });
});
