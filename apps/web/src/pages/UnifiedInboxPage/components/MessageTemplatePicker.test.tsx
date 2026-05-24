import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MessageTemplatePicker from './MessageTemplatePicker';

vi.mock('@/lib/api', () => ({
  default: {
    get: vi.fn().mockResolvedValue({ data: [] }),
  },
}));

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

describe('MessageTemplatePicker', () => {
  it('renders modal title when isOpen', () => {
    render(
      wrap(
        <MessageTemplatePicker
          isOpen={true}
          onClose={vi.fn()}
          onInsert={vi.fn()}
          roomId="room-1"
        />,
      ),
    );
    expect(screen.getByText('เลือกข้อความสำเร็จรูป')).toBeInTheDocument();
  });

  it('does not render when isOpen=false', () => {
    render(
      wrap(
        <MessageTemplatePicker
          isOpen={false}
          onClose={vi.fn()}
          onInsert={vi.fn()}
          roomId="room-1"
        />,
      ),
    );
    expect(screen.queryByText('เลือกข้อความสำเร็จรูป')).not.toBeInTheDocument();
  });
});
