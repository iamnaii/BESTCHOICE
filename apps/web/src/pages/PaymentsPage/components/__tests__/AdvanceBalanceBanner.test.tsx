import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import Decimal from 'decimal.js';
import { AdvanceBalanceBanner } from '../AdvanceBalanceBanner';

/**
 * M-2: the detail line joined its optional fragments by hard-coding a leading
 * '·' on each one, so a contract with ONLY a park bucket rendered a stray
 * leading dot ("· พักงวดสุดท้าย 354.00 ฿ · พักใน 21-1103 · ..."). The fragments are
 * now joined, so no combination can produce a leading/trailing/doubled dot.
 */

function renderBanner(props: { advance: string; park: string; isLast: boolean }) {
  render(
    <AdvanceBalanceBanner
      amountDue={new Decimal('1515.83')}
      advanceBalance={new Decimal(props.advance)}
      consumeAdvance
      onToggle={() => {}}
      rescheduleAdvanceBalance={new Decimal(props.park)}
      isLastInstallment={props.isLast}
    />,
  );
  return screen.getByText(/พักใน 21-1103/).textContent ?? '';
}

function assertCleanSeparators(line: string) {
  expect(line.trim().startsWith('·')).toBe(false);
  expect(line.trim().endsWith('·')).toBe(false);
  expect(line).not.toMatch(/·\s*·/);
}

describe('AdvanceBalanceBanner detail separators', () => {
  it('park only (generic = 0): no leading dot', () => {
    const line = renderBanner({ advance: '0', park: '354.00', isLast: true });
    assertCleanSeparators(line);
    expect(line).toContain('พักงวดสุดท้าย 354.00 ฿');
    expect(line).not.toContain('จากชำระงวดก่อนเกิน');
  });

  it('generic only: no stray dot where the park fragment would have been', () => {
    const line = renderBanner({ advance: '500.00', park: '0', isLast: true });
    assertCleanSeparators(line);
    expect(line).toContain('จากชำระงวดก่อนเกิน 500.00 ฿');
    expect(line).not.toContain('พักงวดสุดท้าย');
  });

  it('both buckets: exactly one separator between fragments', () => {
    const line = renderBanner({ advance: '500.00', park: '354.00', isLast: true });
    assertCleanSeparators(line);
    expect(line).toContain('จากชำระงวดก่อนเกิน 500.00 ฿ · พักงวดสุดท้าย 354.00 ฿ · พักใน 21-1103');
  });

  it('park exists but this is NOT the last installment: park hidden, no stray dot', () => {
    const line = renderBanner({ advance: '500.00', park: '354.00', isLast: false });
    assertCleanSeparators(line);
    expect(line).not.toContain('พักงวดสุดท้าย');
  });

  it('neither bucket: banner renders nothing at all', () => {
    const { container } = render(
      <AdvanceBalanceBanner
        amountDue={new Decimal('1515.83')}
        advanceBalance={new Decimal(0)}
        consumeAdvance
        onToggle={() => {}}
        rescheduleAdvanceBalance={new Decimal('354.00')}
        isLastInstallment={false}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
