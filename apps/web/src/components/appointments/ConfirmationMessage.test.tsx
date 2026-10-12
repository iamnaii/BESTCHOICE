import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ConfirmationMessage from './ConfirmationMessage';
const confirmation = {
  id: 'message',
  kind: 'BOOKED',
  status: 'PENDING',
  text: 'BESTCHOICE ยืนยันนัด\nเวลา 18:30–19:15 น.',
  sentAt: null,
};
describe('appointment confirmation delivery feedback', () => {
  it('distinguishes a saved booking from confirmed message delivery', () => {
    const { rerender } = render(<ConfirmationMessage confirmation={confirmation} />);
    expect(screen.queryByText('ส่งข้อความยืนยันเข้าแชทแล้ว')).not.toBeInTheDocument();
    expect(screen.getByText('กำลังส่งข้อความยืนยันเข้าแชทเดิม')).toBeInTheDocument();
    rerender(<ConfirmationMessage confirmation={{ ...confirmation, status: 'SENT' }} />);
    expect(screen.getByText('ส่งข้อความยืนยันเข้าแชทแล้ว')).toBeInTheDocument();
  });
  it('offers retry only for definite failure, not an uncertain result', () => {
    const retry = vi.fn();
    const { rerender } = render(
      <ConfirmationMessage confirmation={{ ...confirmation, status: 'FAILED' }} onRetry={retry} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'ลองส่งข้อความอีกครั้ง' }));
    expect(retry).toHaveBeenCalledOnce();
    rerender(
      <ConfirmationMessage confirmation={{ ...confirmation, status: 'UNKNOWN' }} onRetry={retry} />,
    );
    expect(screen.queryByRole('button', { name: 'ลองส่งข้อความอีกครั้ง' })).not.toBeInTheDocument();
    expect(screen.getByText('ยังยืนยันผลการส่งข้อความไม่ได้')).toBeInTheDocument();
  });
  it('keeps confirmation text available if clipboard access fails', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    });
    render(<ConfirmationMessage confirmation={confirmation} />);
    fireEvent.click(screen.getByText('ดูข้อความยืนยัน'));
    fireEvent.click(screen.getByRole('button', { name: 'คัดลอกข้อความยืนยัน' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('คัดลอกไม่ได้');
    expect(screen.getByLabelText('ข้อความยืนยันนัดหมาย')).toHaveValue(confirmation.text);
  });
});
