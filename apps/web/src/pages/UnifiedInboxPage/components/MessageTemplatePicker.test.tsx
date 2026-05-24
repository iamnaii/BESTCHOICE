import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MessageTemplatePicker from './MessageTemplatePicker';
import api from '@/lib/api';

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

describe('MessageTemplatePicker — tree', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockResolvedValue({
      data: [
        { id: 't1', shortcut: 'iphone16-256', title: 'iPhone 16 Pro 256GB', content: 'iPhone 16 Pro 256GB ...', category: 'เรทผ่อน iPhone', sortOrder: 1 },
        { id: 't2', shortcut: 'iphone16-512', title: 'iPhone 16 Pro 512GB', content: 'iPhone 16 Pro 512GB ...', category: 'เรทผ่อน iPhone', sortOrder: 2 },
        { id: 't3', shortcut: 'shop-hours', title: 'เวลาทำการ', content: 'ร้านเปิด 10-20', category: 'ข้อมูลร้าน', sortOrder: 1 },
        { id: 't4', shortcut: 'misc', title: 'อื่นๆ', content: 'misc', category: null, sortOrder: 99 },
      ],
    });
  });

  it('groups templates by category', async () => {
    render(wrap(<MessageTemplatePicker isOpen={true} onClose={vi.fn()} onInsert={vi.fn()} roomId="r1" />));
    expect(await screen.findByText('เรทผ่อน iPhone')).toBeInTheDocument();
    expect(screen.getByText('ข้อมูลร้าน')).toBeInTheDocument();
    expect(screen.getByText('อื่นๆ')).toBeInTheDocument(); // null category bucket
  });

  it('shows count badge per category', async () => {
    render(wrap(<MessageTemplatePicker isOpen={true} onClose={vi.fn()} onInsert={vi.fn()} roomId="r1" />));
    const iphoneRow = (await screen.findByText('เรทผ่อน iPhone')).closest('button');
    expect(iphoneRow).toHaveTextContent('2');
  });

  it('expands category on click and reveals templates', async () => {
    render(wrap(<MessageTemplatePicker isOpen={true} onClose={vi.fn()} onInsert={vi.fn()} roomId="r1" />));
    const header = await screen.findByText('เรทผ่อน iPhone');
    expect(screen.queryByText('iPhone 16 Pro 256GB')).not.toBeInTheDocument();
    fireEvent.click(header);
    expect(await screen.findByText('iPhone 16 Pro 256GB')).toBeInTheDocument();
    expect(screen.getByText('iPhone 16 Pro 512GB')).toBeInTheDocument();
  });

  it('selects template on click and highlights it', async () => {
    render(wrap(<MessageTemplatePicker isOpen={true} onClose={vi.fn()} onInsert={vi.fn()} roomId="r1" />));
    fireEvent.click(await screen.findByText('เรทผ่อน iPhone'));
    const item = await screen.findByText('iPhone 16 Pro 256GB');
    fireEvent.click(item);
    await waitFor(() => {
      expect(item.closest('button')).toHaveAttribute('aria-selected', 'true');
    });
  });
});
