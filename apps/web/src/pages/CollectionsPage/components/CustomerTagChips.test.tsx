import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import CustomerTagChips from './CustomerTagChips';

describe('CustomerTagChips', () => {
  it('renders nothing when no tags and no emptyLabel', () => {
    const { container } = render(<CustomerTagChips tags={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders empty label when no tags but emptyLabel set', () => {
    render(<CustomerTagChips tags={[]} emptyLabel="ยังไม่มี tag" />);
    expect(screen.getByText('ยังไม่มี tag')).toBeTruthy();
  });

  it('renders the labelled chip per supplied tag', () => {
    render(
      <CustomerTagChips
        tags={[{ tag: 'VIP' }, { tag: 'BLACKLIST' }, { tag: 'NEW' }]}
      />,
    );
    expect(screen.getByText('VIP')).toBeTruthy();
    expect(screen.getByText('BLACKLIST')).toBeTruthy();
    expect(screen.getByText('ลูกค้าใหม่')).toBeTruthy();
  });

  it('uses semantic token classes (no hardcoded hex / 500-suffix colors)', () => {
    render(<CustomerTagChips tags={[{ tag: 'VIP' }]} />);
    const chip = screen.getByTestId('customer-tag-chip-VIP');
    const className = chip.className;
    // Tokens we DO want
    expect(className).toMatch(/bg-success\/10/);
    expect(className).toMatch(/text-success/);
    // Tokens we DO NOT want — guards against accidental gray-* or 500-suffix
    // hardcoded colors creeping back in.
    expect(className).not.toMatch(/bg-gray-/);
    expect(className).not.toMatch(/text-emerald-500/);
    expect(className).not.toMatch(/#[0-9a-fA-F]{6}/);
  });

  it('snapshot — full render of all 5 tag types', () => {
    const { container } = render(
      <CustomerTagChips
        tags={[
          { tag: 'VIP' },
          { tag: 'HIGH_RISK' },
          { tag: 'NEW' },
          { tag: 'LOYAL' },
          { tag: 'BLACKLIST' },
        ]}
      />,
    );
    expect(container.firstChild).toMatchSnapshot();
  });
});
