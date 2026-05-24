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

describe('MessageTemplatePicker — preview', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url === '/staff-chat/canned-responses') {
        return Promise.resolve({
          data: [
            { id: 't1', shortcut: 'iphone16', title: 'iPhone 16', content: 'สวัสดีคุณ {customerName}', category: 'เรทผ่อน iPhone', sortOrder: 1 },
          ],
        });
      }
      if (url.includes('/preview')) {
        return Promise.resolve({
          data: {
            id: 't1',
            shortcut: 'iphone16',
            title: 'iPhone 16',
            content: 'สวัสดีคุณ {customerName}',
            expandedContent: 'สวัสดีคุณ สมชาย',
          },
        });
      }
      return Promise.resolve({ data: null });
    });
  });

  it('shows empty state when no template selected', async () => {
    render(wrap(<MessageTemplatePicker isOpen={true} onClose={vi.fn()} onInsert={vi.fn()} roomId="r1" />));
    expect(await screen.findByText('เลือก template เพื่อดูตัวอย่าง')).toBeInTheDocument();
  });

  it('fetches preview when template selected', async () => {
    render(wrap(<MessageTemplatePicker isOpen={true} onClose={vi.fn()} onInsert={vi.fn()} roomId="r1" />));
    fireEvent.click(await screen.findByText('เรทผ่อน iPhone'));
    fireEvent.click(await screen.findByText('iPhone 16'));
    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith('/staff-chat/rooms/r1/canned-responses/t1/preview');
    });
    expect(await screen.findByText('สวัสดีคุณ สมชาย')).toBeInTheDocument();
  });

  it('insert button disabled when no selection', () => {
    render(wrap(<MessageTemplatePicker isOpen={true} onClose={vi.fn()} onInsert={vi.fn()} roomId="r1" />));
    expect(screen.getByRole('button', { name: /ใส่ข้อความ/ })).toBeDisabled();
  });

  it('insert button calls onInsert with expandedContent then onClose', async () => {
    const onInsert = vi.fn();
    const onClose = vi.fn();
    render(wrap(<MessageTemplatePicker isOpen={true} onClose={onClose} onInsert={onInsert} roomId="r1" />));
    fireEvent.click(await screen.findByText('เรทผ่อน iPhone'));
    fireEvent.click(await screen.findByText('iPhone 16'));
    await screen.findByText('สวัสดีคุณ สมชาย'); // preview loaded
    fireEvent.click(screen.getByRole('button', { name: /ใส่ข้อความ/ }));
    expect(onInsert).toHaveBeenCalledWith('สวัสดีคุณ สมชาย');
    expect(onClose).toHaveBeenCalled();
  });
});

describe('MessageTemplatePicker — search', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockResolvedValue({
      data: [
        { id: 't1', shortcut: 'iphone', title: 'iPhone 16', content: 'iPhone content', category: 'A', sortOrder: 1 },
        { id: 't2', shortcut: 'samsung', title: 'Samsung S25', content: 'samsung content', category: 'B', sortOrder: 2 },
        { id: 't3', shortcut: 'hello', title: 'ทักทาย', content: 'สวัสดี iphone user', category: 'C', sortOrder: 3 },
      ],
    });
  });

  it('filters by title (case-insensitive) and auto-expands matching categories', async () => {
    render(wrap(<MessageTemplatePicker isOpen={true} onClose={vi.fn()} onInsert={vi.fn()} roomId="r1" />));
    await screen.findByText('A');
    const search = screen.getByPlaceholderText(/ค้นหา/);
    fireEvent.change(search, { target: { value: 'iphone' } });
    // iPhone matches by title
    expect(await screen.findByText('iPhone 16')).toBeInTheDocument();
    // ทักทาย matches by content ("สวัสดี iphone user")
    expect(screen.getByText('ทักทาย')).toBeInTheDocument();
    // Samsung does NOT match
    expect(screen.queryByText('Samsung S25')).not.toBeInTheDocument();
  });

  it('clears filter when search emptied', async () => {
    render(wrap(<MessageTemplatePicker isOpen={true} onClose={vi.fn()} onInsert={vi.fn()} roomId="r1" />));
    await screen.findByText('A');
    const search = screen.getByPlaceholderText(/ค้นหา/);
    fireEvent.change(search, { target: { value: 'iphone' } });
    await screen.findByText('iPhone 16');
    fireEvent.change(search, { target: { value: '' } });
    // All categories present, none auto-expanded → expanded items hidden again
    await waitFor(() => {
      expect(screen.queryByText('iPhone 16')).not.toBeInTheDocument();
    });
    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.getByText('B')).toBeInTheDocument();
  });

  it('Escape key closes modal', async () => {
    const onClose = vi.fn();
    render(wrap(<MessageTemplatePicker isOpen={true} onClose={onClose} onInsert={vi.fn()} roomId="r1" />));
    await screen.findByText('A');
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
