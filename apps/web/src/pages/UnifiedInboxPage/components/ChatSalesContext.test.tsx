import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { SalesContextView } from './ChatSalesContext';
import { journeySummary, stageSteps } from '../../CustomerDetailPage/__tests__/journeyFixtures';
describe('Evidence-based chat sales context', () => {
  it('shows server-supplied cash purchase and skipped credit without a manual purchase control', () => {
    render(<SalesContextView context={{ customerId: 'c', journey: journeySummary({ stage: 'PURCHASED', stageLabel: 'ซื้อแล้ว', path: 'CASH', steps: stageSteps({ CONTACTED: 'done', IDENTIFIED: 'done', INTERESTED: 'done', CREDIT: 'not_needed', PURCHASED: 'current' }) }), nextAction: null, evidenceLinks: [] }} onEvidence={vi.fn()} />);
    expect(screen.getByLabelText('ขั้นการขาย')).toHaveTextContent('ซื้อแล้ว');
    expect(screen.getByText('ไม่ต้องตรวจ (ซื้อสด)')).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /ซื้อแล้ว/ })).not.toBeInTheDocument();
  });
  it('omits the redundant unlinked-customer and follow-up card', () => {
    render(<SalesContextView context={{ customerId: null, journey: null, nextAction: null, evidenceLinks: [] }} onEvidence={vi.fn()} />);
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /ตั้งนัด|ผูกข้อมูลลูกค้า/ })).not.toBeInTheDocument();
  });
  it('still opens evidence for a room without a linked customer', () => {
    const evidence = { id: 'credit-1', kind: 'CREDIT' as const, label: 'ผลตรวจเครดิต' };
    const open = vi.fn();
    render(<SalesContextView context={{ customerId: null, journey: null, nextAction: null, evidenceLinks: [evidence] }} onEvidence={open} />);
    fireEvent.click(screen.getByRole('button', { name: 'ผลตรวจเครดิต' }));
    expect(open).toHaveBeenCalledWith(evidence);
    expect(screen.queryByRole('button', { name: /ตั้งนัด|ผูกข้อมูลลูกค้า/ })).not.toBeInTheDocument();
  });
});
