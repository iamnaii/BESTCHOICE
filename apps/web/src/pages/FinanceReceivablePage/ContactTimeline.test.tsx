import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import type { FinanceContactLog } from '@/lib/api/finance-contacts';
import ContactTimeline from './ContactTimeline';

it.each([
  ['นัดสำเร็จ', 'check-circle', '2026-11-24T09:00:00Z', null],
  ['ผิดนัด', 'xcircle', null, '2026-11-24T09:00:00Z'],
  ['นัดไว้', 'clock', null, null],
])('shows the appointment outcome %s with a decorative status glyph', (label, icon, kept, broken) => {
  const log: FinanceContactLog = {
    id: 'contact-log',
    contactedAt: '2026-11-23T09:00:00Z',
    channel: 'CALL',
    result: 'PROMISED',
    notes: null,
    promisedDate: '2026-11-24T09:00:00Z',
    promisedAmount: '1000',
    promisedBrokenAt: broken,
    promisedKeptAt: kept,
    contact: null,
    contactedBy: { id: 'staff', name: 'พนักงานทดสอบ' },
  };

  render(<ContactTimeline logs={[log]} />);

  const status = screen.getByText(label);
  expect(status).toBeVisible();
  expect(status.parentElement).toHaveTextContent('1,000 บาท');
  expect(status.parentElement?.querySelector('svg.app-icon-' + icon)).toHaveAttribute('aria-hidden', 'true');
});
