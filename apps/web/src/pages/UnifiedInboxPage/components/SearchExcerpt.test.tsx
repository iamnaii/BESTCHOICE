import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import SearchExcerpt from './SearchExcerpt';
import ConversationItem from './ConversationItem';

describe('message search result', () => {
  it('centers a late match and escapes markup instead of rendering message HTML', () => {
    const { container } = render(<SearchExcerpt text={`${'ก่อนหน้า '.repeat(100)}<script>สีน้ำเงิน</script> รายละเอียดท้ายข้อความ`} search="สีน้ำเงิน" />);
    expect(container.querySelector('mark')).toHaveTextContent('สีน้ำเงิน');
    expect(container.querySelector('script')).toBeNull();
    expect(container.textContent!.length).toBeLessThan(120);
    expect(container.textContent).toContain('…');
  });
  it('finds case-insensitive English without changing displayed spelling', () => {
    const { container } = render(<SearchExcerpt text="สนใจ iPhone 15" search="iphone" />);
    expect(container.querySelector('mark')).toHaveTextContent('iPhone');
  });
  it('opens the matching message with mouse or keyboard, and normal rows open latest', () => {
    const onSelect = vi.fn();
    const session = { id: 'room', channel: 'LINE_SHOP', priority: 'NORMAL', totalMessages: 151,
      displayName: 'ลูกค้าตัวอย่าง', lastMessageAt: new Date().toISOString(),
      searchMatch: { id: 'old-message', text: 'สนใจสีดำ', role: 'CUSTOMER', createdAt: new Date().toISOString() } };
    const { rerender } = render(<ConversationItem session={session} isActive={false} onSelect={onSelect} search="สีดำ" />);
    const row = screen.getByRole('button');
    fireEvent.click(row);
    expect(onSelect).toHaveBeenLastCalledWith('room', 'old-message');
    fireEvent.keyDown(row, { key: 'Enter' });
    expect(onSelect).toHaveBeenLastCalledWith('room', 'old-message');
    rerender(<ConversationItem session={session} isActive={false} onSelect={onSelect} />);
    fireEvent.click(row);
    expect(onSelect).toHaveBeenLastCalledWith('room', undefined);
  });
});
