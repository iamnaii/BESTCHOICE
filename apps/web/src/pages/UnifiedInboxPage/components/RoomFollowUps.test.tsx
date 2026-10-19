import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Todo } from '@/pages/TodosPage/types';
import RoomFollowUps from './RoomFollowUps';

const task = (id: string, fields: Partial<Todo> = {}): Todo => ({
  id, title: `ติดตาม ${id}`, status: 'TODO', priority: 'MEDIUM', tags: [], createdById: 'user',
  createdAt: '2026-10-01T00:00:00Z', dueDate: '2099-01-01T00:00:00Z', workKind: 'CHAT_FOLLOW_UP', ...fields,
});
const props = () => ({ todos: [], loading: false, error: false, hasMore: false, loadingMore: false,
  onRetry: vi.fn(), onLoadMore: vi.fn(), onNew: vi.fn(), onEdit: vi.fn() });

describe('Room follow-ups', () => {
  it('has one creation action, orders by due date and exposes additional tasks', () => {
    const p = props();
    const soon = task('soon', { dueDate: '2098-01-01T00:00:00Z' });
    render(<RoomFollowUps {...p} todos={[task('later'), task('done', { status: 'DONE' }), task('handoff', { workKind: 'CHAT_HANDOFF' }), task('service', { workKind: 'CHAT_SERVICE' }), task('cancelled', { status: 'CANCELLED' }), task('undated', { dueDate: null }), soon, task('review', { status: 'REVIEW' })]} />);
    expect(screen.getAllByRole('button', { name: 'ตั้งนัดติดตาม' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'ตั้งนัดติดตาม' }));
    expect(p.onNew).toHaveBeenCalledOnce();
    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent('ติดตาม soon');
    fireEvent.click(within(rows[0]).getByRole('button', { name: 'ดู / แก้ไขนัด' }));
    expect(p.onEdit).toHaveBeenCalledWith(soon);
    expect(screen.queryByText(/ติดตาม (done|cancelled|handoff|service)/)).not.toBeInTheDocument();
    expect(screen.getByText('รอตรวจ')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'ดูอีก 1 งาน' }));
    expect(screen.getAllByRole('listitem')).toHaveLength(4);
    expect(screen.getByText('ยังไม่กำหนดเวลา')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'ย่อรายการ' }));
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });

  it('distinguishes loading, failure and empty states while retaining loaded tasks on failure', () => {
    const p = props();
    const { rerender } = render(<RoomFollowUps {...p} loading />);
    expect(screen.getByRole('status')).toHaveTextContent('กำลังโหลด');
    expect(screen.queryByText('ยังไม่มีงานติดตาม')).not.toBeInTheDocument();
    rerender(<RoomFollowUps {...p} error todos={[task('retained')]} />);
    expect(screen.getByRole('alert')).toHaveTextContent('โหลดงานติดตามไม่สำเร็จ');
    expect(screen.getByText('ติดตาม retained')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'ลองใหม่' }));
    expect(p.onRetry).toHaveBeenCalledOnce();
    rerender(<RoomFollowUps {...p} />);
    expect(screen.getByText('ยังไม่มีงานติดตาม')).toBeInTheDocument();
  });

  it('does not report an empty or total list while more room work is available', () => {
    const p = props();
    const { rerender } = render(<RoomFollowUps {...p} hasMore todos={[task('handoff', { workKind: 'CHAT_HANDOFF' })]} />);
    expect(screen.queryByText('ยังไม่มีงานติดตาม')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'โหลดงานในห้องเพิ่มเติม' }));
    expect(p.onLoadMore).toHaveBeenCalledOnce();
    rerender(<RoomFollowUps {...p} hasMore loadingMore />);
    expect(screen.getByRole('button', { name: 'กำลังโหลด…' })).toBeDisabled();
  });
});
