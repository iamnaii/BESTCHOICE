import { render, screen, fireEvent } from '@testing-library/react';
import { it, expect, vi } from 'vitest';
import CreditCheckCard, { type CreditCheckItem } from './CreditCheckCard';

it('shows the chat source and actual affordable amount without a legacy analyze action', () => {
  const cc: CreditCheckItem = {
    id: 'c',
    status: 'PENDING',
    bankName: null,
    statementFiles: [],
    statementMonths: 0,
    aiScore: null,
    aiSummary: null,
    aiRecommendation: null,
    aiAnalysis: {
      source: 'chat-statement',
      roomId: 'room',
      affordablePayment: 2500,
      dateRange: 'มกราคม',
    },
    reviewNotes: null,
    checkedBy: null,
    contract: null,
    createdAt: '2026-09-07T00:00:00Z',
  };
  const onOverride = vi.fn();
  const view = render(
    <CreditCheckCard
      cc={cc}
      canOverride
      isAnalyzing={false}
      onAnalyze={vi.fn()}
      onOverride={onOverride}
    />,
  );
  expect(screen.getByRole('link', { name: 'เปิดแชทต้นทาง' })).toHaveAttribute(
    'href',
    '/inbox/room',
  );
  expect(screen.getByText(/ผ่อนไหวเดือนละ.*2,500/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'AI วิเคราะห์' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'ปรับแก้สถานะ' }));
  expect(onOverride).toHaveBeenCalledWith('c');
  view.rerender(
    <CreditCheckCard
      cc={cc}
      canOverride={false}
      isAnalyzing={false}
      onAnalyze={vi.fn()}
      onOverride={onOverride}
    />,
  );
  expect(screen.queryByRole('button', { name: 'ปรับแก้สถานะ' })).toBeNull();
});
