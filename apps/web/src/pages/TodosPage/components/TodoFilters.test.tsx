import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TodoFilters } from './TodoFilters';
import type { TodoView } from '../types';
import { pickComboOption } from '@/test/combobox';

const counts: Record<TodoView, number> = {
  all: 0,
  today: 0,
  upcoming: 0,
  priority: 0,
  cancelled: 0,
  completed: 0,
};

function renderFilters(assigneeFilter: string, onAssignee = vi.fn()) {
  const view = render(
    <TodoFilters
      view="all"
      onViewChange={vi.fn()}
      search=""
      onSearchChange={vi.fn()}
      tabCounts={counts}
      staffUsers={[{ id: 'u1', name: 'สมชาย ใจดี', nickname: 'ชาย' }]}
      assigneeFilter={assigneeFilter}
      onAssigneeFilterChange={onAssignee}
    />,
  );
  return { ...view, onAssignee };
}

describe('TodoFilters assignee filter', () => {
  it('keeps the user icon inside the trigger and filters by the picked assignee (R2-4a)', async () => {
    const user = userEvent.setup();
    const { container, onAssignee } = renderFilters('');
    const trigger = screen.getByRole('combobox', { name: 'ผู้รับมอบหมาย' });
    expect(trigger).toHaveAttribute('data-slot', 'combobox-trigger');
    expect(trigger).toHaveTextContent('ผู้รับมอบหมายทั้งหมด');
    // One user icon, drawn by renderValue inside the trigger — none hand-positioned outside it.
    const icons = container.querySelectorAll('svg.lucide-user');
    expect(icons).toHaveLength(1);
    expect(trigger).toContainElement(icons[0] as HTMLElement);

    await pickComboOption(user, 'ผู้รับมอบหมาย', 'งานของฉัน');
    expect(onAssignee).toHaveBeenLastCalledWith('me');

    // the nickname is the label; the full name is a search keyword
    await pickComboOption(user, 'ผู้รับมอบหมาย', 'ชาย', { search: 'สมชาย' });
    expect(onAssignee).toHaveBeenLastCalledWith('u1');
  });

  it('shows "งานของฉัน" for ?assigneeId=me and clears to "" from "ผู้รับมอบหมายทั้งหมด"', async () => {
    const user = userEvent.setup();
    const { onAssignee } = renderFilters('me');
    expect(screen.getByRole('combobox', { name: 'ผู้รับมอบหมาย' })).toHaveTextContent('งานของฉัน');
    await pickComboOption(user, 'ผู้รับมอบหมาย', 'ผู้รับมอบหมายทั้งหมด');
    expect(onAssignee).toHaveBeenCalledExactlyOnceWith('');
  });

  it('an ?assigneeId outside the list keeps the old text and can be cleared', async () => {
    const user = userEvent.setup();
    const { onAssignee } = renderFilters('someone-else');
    expect(screen.getByRole('combobox', { name: 'ผู้รับมอบหมาย' })).toHaveTextContent(
      'ผู้รับมอบหมายทั้งหมด',
    );
    await pickComboOption(user, 'ผู้รับมอบหมาย', 'ผู้รับมอบหมายทั้งหมด');
    expect(onAssignee).toHaveBeenCalledExactlyOnceWith('');
  });
});
