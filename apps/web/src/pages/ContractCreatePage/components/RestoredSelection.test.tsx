import { expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CustomerSelectStep } from './CustomerSelectStep';
import { ProductSelectStep } from './ProductSelectStep';
import type { Customer, Product } from '../types';

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { role: 'SALES' } }) }));
it('shows the restored customer outside the search page and starts credit from the existing selection', () => {
  const onOpenCredit = vi.fn();
  render(<CustomerSelectStep customers={[]} customerSearch="" setCustomerSearch={vi.fn()}
    selectedCustomer={{ id: 'customer-a', name: 'ลูกค้าที่กู้คืน', nationalId: '1234567890123' } as Customer}
    setSelectedCustomer={vi.fn()} onNext={vi.fn()} latestCreditCheck={null} customerCreditApproved={false}
    onOpenCredit={onOpenCredit} onOpenCustomerModal={vi.fn()} overrideActiveContractCheck={false} setOverrideActiveContractCheck={vi.fn()} />);
  expect(screen.getByText('ลูกค้าที่กู้คืน')).toBeVisible();
  expect(screen.queryByText('ไม่พบลูกค้า')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'ไปตรวจเครดิต' }));
  expect(onOpenCredit).toHaveBeenCalledOnce();
});
it('shows the restored stock item even outside the current product search page', () => {
  render(<ProductSelectStep products={[]} productSearch="" setProductSearch={vi.fn()}
    selectedProduct={{ id: 'product-a', name: 'สินค้าที่กู้คืน', brand: 'Apple', model: '15', prices: [] } as unknown as Product}
    setSelectedProduct={vi.fn()} onNext={vi.fn()} />);
  expect(screen.getByText('สินค้าที่กู้คืน')).toBeVisible();
  expect(screen.queryByText('ไม่พบสินค้าที่พร้อมขาย')).not.toBeInTheDocument();
});
