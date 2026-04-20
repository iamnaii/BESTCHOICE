import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import CustomerTierBadge from './CustomerTierBadge';

describe('CustomerTierBadge', () => {
  it('renders GOLD label', () => {
    render(<CustomerTierBadge tier="GOLD" />);
    expect(screen.getByText('VIP (Gold)')).toBeInTheDocument();
  });

  it('renders GOOD label', () => {
    render(<CustomerTierBadge tier="GOOD" />);
    expect(screen.getByText('ลูกค้าดี')).toBeInTheDocument();
  });

  it('renders NEW label', () => {
    render(<CustomerTierBadge tier="NEW" />);
    expect(screen.getByText('ลูกค้าใหม่')).toBeInTheDocument();
  });

  it('renders RISKY label', () => {
    render(<CustomerTierBadge tier="RISKY" />);
    expect(screen.getByText('ต้องระวัง')).toBeInTheDocument();
  });

  it('renders BLACKLIST label', () => {
    render(<CustomerTierBadge tier="BLACKLIST" />);
    expect(screen.getByText('ห้ามทำสัญญา')).toBeInTheDocument();
  });

  it('applies GOLD colour tokens', () => {
    const { container } = render(<CustomerTierBadge tier="GOLD" />);
    const el = container.firstChild as HTMLElement;
    expect(el.className).toMatch(/amber/);
  });
});
