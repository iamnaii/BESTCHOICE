import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TodoFilters } from './TodoFilters';
import type { TodoView } from '../types';

const counts: Record<TodoView, number> = {
  all: 0,
  today: 0,
  upcoming: 0,
  priority: 0,
  cancelled: 0,
  completed: 0,
};

describe('TodoFilters assignee filter', () => {
  it('lets NativeSelect own the user icon and its left padding', () => {
    const onAssignee = vi.fn();
    render(
      <TodoFilters
        view="all"
        onViewChange={vi.fn()}
        search=""
        onSearchChange={vi.fn()}
        tabCounts={counts}
        staffUsers={[{ id: 'u1', name: 'สมชาย ใจดี', nickname: 'ชาย' }]}
        assigneeFilter=""
        onAssigneeFilterChange={onAssignee}
      />,
    );
    const select = screen.getByRole('combobox', { name: 'ผู้รับมอบหมาย' });
    expect(select).toHaveClass('pl-10');
    expect(select).not.toHaveClass('pl-9');

    const wrapper = select.closest('[data-slot="native-select-wrapper"]') as HTMLElement;
    const slot = wrapper.querySelector('[data-slot="native-select-leading-icon"]');
    expect(slot?.querySelector('svg')).not.toBeNull();
    // No hand-positioned icon left outside the primitive.
    expect((wrapper.parentElement as HTMLElement).querySelectorAll(':scope > svg')).toHaveLength(0);

    fireEvent.change(select, { target: { value: 'me' } });
    expect(onAssignee).toHaveBeenCalledWith('me');
  });
});
