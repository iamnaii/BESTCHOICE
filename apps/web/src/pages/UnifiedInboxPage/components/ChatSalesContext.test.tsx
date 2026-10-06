import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { SalesContextView } from './ChatSalesContext';
import { journeySummary, stageSteps } from '../../CustomerDetailPage/__tests__/journeyFixtures';
describe('Evidence-based chat sales context', () => {
  it('shows server-supplied cash purchase and skipped credit without a manual purchase control', () => {
    render(<SalesContextView context={{ customerId: 'c', journey: journeySummary({ stage: 'PURCHASED', stageLabel: 'ซื้อแล้ว', path: 'CASH', steps: stageSteps({ CONTACTED: 'done', IDENTIFIED: 'done', INTERESTED: 'done', CREDIT: 'not_needed', PURCHASED: 'current' }) }), nextAction: null, evidenceLinks: [] }} onLink={vi.fn()} onNew={vi.fn()} onEvidence={vi.fn()} />);
    expect(screen.getByLabelText('ขั้นการขาย')).toHaveTextContent('ซื้อแล้ว');
    expect(screen.getByText('ไม่ต้องตรวจ (ซื้อสด)')).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /ซื้อแล้ว/ })).not.toBeInTheDocument();
  });
  it('keeps the original customer linking action and allows an unlinked room appointment', () => {
    const link = vi.fn(); const create = vi.fn();
    render(<SalesContextView context={{ customerId: null, journey: null, nextAction: null, evidenceLinks: [] }} onLink={link} onNew={create} onEvidence={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'ผูกข้อมูลลูกค้า' })); expect(link).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'ตั้งนัดติดตาม' })); expect(create).toHaveBeenCalledOnce();
    expect(screen.queryByText('มีข้อเสนอ')).not.toBeInTheDocument();
  });
});
