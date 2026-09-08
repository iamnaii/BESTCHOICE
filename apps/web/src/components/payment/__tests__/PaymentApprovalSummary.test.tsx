import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import PaymentApprovalSummary from '../PaymentApprovalSummary';

describe('payment approval evidence', () => {
  it('lets the reviewer open the submitted receipt evidence', () => {
    render(<PaymentApprovalSummary payload={{ amount: 3000, slipUrl: 'https://storage.example.test/slip.pdf' }} />);
    expect(screen.getByRole('link', { name: 'เปิดสลิป / หลักฐาน' })).toHaveAttribute('href', 'https://storage.example.test/slip.pdf');
  });
  it('never turns an unsafe evidence value into a link', () => {
    render(<PaymentApprovalSummary payload={{ amount: 3000, slipUrl: 'javascript:alert(1)' }} />);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});
