import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import type { CustomerBlacklistResult } from '@installment/shared';
import CustomerBlacklistBadge from './CustomerBlacklistBadge';

const wrap = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe('CustomerBlacklistBadge', () => {
  it('renders nothing for NONE or a missing result', () => {
    const { container } = wrap(<CustomerBlacklistBadge result={{ level: 'NONE', reasons: [], checkedAt: 't' }} />);
    expect(container).toBeEmptyDOMElement();
    const { container: empty } = wrap(<CustomerBlacklistBadge result={undefined} />);
    expect(empty).toBeEmptyDOMElement();
  });

  it('HARD badge shows the forbidden label and expands reasons with a customer link', async () => {
    const result: CustomerBlacklistResult = { level: 'HARD', checkedAt: 't', reasons: [
      { code: 'PHONE_MATCH', level: 'HARD', message: 'เบอร์โทรตรงกับ สมชาย ที่ติด blacklist', related: { customerId: 'c9', name: 'สมชาย' } },
    ] };
    wrap(<CustomerBlacklistBadge result={result} />);
    const btn = screen.getByRole('button', { name: /ติด blacklist · ห้ามทำสัญญา/ });
    expect(btn).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText(/เบอร์โทรตรงกับ/)).not.toBeInTheDocument();
    await userEvent.click(btn);
    expect(btn).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(/เบอร์โทรตรงกับ/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'สมชาย' })).toHaveAttribute('href', '/customers/c9');
  });

  it('SOFT badge shows the manager-approval label; non-expandable renders a plain badge', () => {
    const result: CustomerBlacklistResult = { level: 'SOFT', checkedAt: 't', reasons: [
      { code: 'REFERENCES_BLACKLISTED', level: 'SOFT', message: 'ผู้อ้างอิง "ก" คือ ข ที่ติด blacklist' },
    ] };
    wrap(<CustomerBlacklistBadge result={result} expandable={false} />);
    expect(screen.getByText('ต้องให้ผู้จัดการอนุมัติ')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
