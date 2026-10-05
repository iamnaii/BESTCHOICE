import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import WorkQueue from './WorkQueue';
import type { ChatWorkPage } from '@installment/shared';
const data: ChatWorkPage = { data: [{ key: 'ROOM_WAIT:r', kind: 'ROOM_WAIT', roomId: 'r', title: 'ลูกค้ารอคำตอบ', assigneeId: null, dueAt: null, waitingSince: '2026-10-06T00:00:00Z', targetType: 'ROOM', targetId: 'r' }], total: 2, page: 1, limit: 50, counts: { WAITING: 2, UNASSIGNED: 1, TODAY: 0, OVERDUE: 0, FOR_ME: 1 }, observedAt: '2026-10-06T01:00:00Z' };
describe('WorkQueue', () => {
  it('distinguishes waiting from read state and exposes independent personal work count', () => {
    const onView = vi.fn(); const onOpen = vi.fn();
    render(<WorkQueue data={data} view="WAITING" onView={onView} onOpen={onOpen} onRetry={vi.fn()} onPage={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'ถึงฉัน 1' }));
    expect(onView).toHaveBeenCalledWith('FOR_ME');
    fireEvent.click(screen.getByRole('button', { name: /ลูกค้ารอคำตอบ/ }));
    expect(onOpen).toHaveBeenCalledWith(data.data[0]);
    expect(screen.getByText(/เปิดอ่านแล้วก็ยังรอตอบ/)).toBeInTheDocument();
  });
  it('shows an actionable error without pretending all counts are zero', () => {
    const retry = vi.fn();
    render(<WorkQueue error view="WAITING" onView={vi.fn()} onOpen={vi.fn()} onRetry={retry} onPage={vi.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent('โหลดคิวงานไม่ได้');
    fireEvent.click(screen.getByRole('button', { name: 'ลองใหม่' }));
    expect(retry).toHaveBeenCalledOnce();
    expect(screen.queryByText('ไม่มีงานในมุมมองนี้')).not.toBeInTheDocument();
  });
});
