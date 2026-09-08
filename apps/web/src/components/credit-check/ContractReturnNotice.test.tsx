import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import ContractReturnNotice from './ContractReturnNotice';
import { contractReturnUrl, customerCreditUrl } from '@/lib/contract-return';

const target = '/contracts/create?customerId=customer-a&productId=product-a&fromRoom=room-a&resume=1';
describe('credit return destination', () => {
  it('offers the matching contract return and preserves the source room', () => {
    render(<MemoryRouter initialEntries={[customerCreditUrl('customer-a', target)]}><ContractReturnNotice customerId="customer-a" /></MemoryRouter>);
    expect(screen.getByRole('link', { name: 'กลับไปทำสัญญาต่อ' })).toHaveAttribute('href', target);
  });
  it.each(['https://evil.example', '//evil.example', '/\\evil.example', 'javascript:alert(1)', '/contracts/create/../../settings', '/settings', '/contracts/create#https://evil.example'])('rejects unsafe/unrelated return %s', value => {
    expect(contractReturnUrl(value)).toBeNull();
  });
  it('drops untrusted approval flags and prevents carrying one customer draft into another credit record', () => {
    expect(contractReturnUrl(`${target}&creditApproved=true&approvedMonthlyPayment=999999`)).toBe(target);
    expect(customerCreditUrl('customer-b', target)).toBe('/customers/customer-b?tab=credit');
    render(<MemoryRouter initialEntries={[`/customers/customer-b?returnTo=${encodeURIComponent(target)}`]}><ContractReturnNotice customerId="customer-b" /></MemoryRouter>);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});
