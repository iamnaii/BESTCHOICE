import { render, screen } from '@testing-library/react';
import { BrowserRouter } from 'react-router';
import { describe, it, expect } from 'vitest';
import { BcCalculatorCard } from '../BcCalculatorCard';

const config = {
  minDownPct: 0.15,
  commissionPct: 0.1,
  vatPct: 0.07,
  ratePctByMonths: { 5: 0.4, 6: 0.4, 7: 0.5, 8: 0.5, 10: 0.5, 12: 0.5 },
  allowedMonths: [5, 6, 7, 8, 10, 12],
};

describe('BcCalculatorCard', () => {
  it('renders canonical worked example monthly payment', () => {
    render(
      <BrowserRouter>
        <BcCalculatorCard productId="p1" installmentPrice={19900} config={config} />
      </BrowserRouter>,
    );
    expect(screen.getByText(/2,413\.21/)).toBeInTheDocument();
  });

  it('hides commission when hideCommission=true (SALES role)', () => {
    render(
      <BrowserRouter>
        <BcCalculatorCard
          productId="p1"
          installmentPrice={19900}
          hideCommission
          config={config}
        />
      </BrowserRouter>,
    );
    // No row labeled "คอม"
    const rows = screen.queryAllByText(/^คอม/);
    expect(rows.length).toBe(0);
  });
});
