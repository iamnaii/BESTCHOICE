import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import ChannelFilter, { ActiveInboxFilters, InboxTabs } from './ChannelFilter';
import { pickComboOption } from '@/test/combobox';

const base = {
  activeTab: 'waiting' as const,
  channel: null,
  who: 'all',
  staff: [
    { id: 'me', name: 'พนักงานทดสอบ' },
    { id: 'other', name: 'ผู้ดูแลคนอื่น' },
  ],
  currentUserId: 'me',
  channelCounts: { FACEBOOK: 12, LINE_SHOP: 29 },
};

describe('Inbox filter drafts', () => {
  it('applies channel and owner together, only after Apply', async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    render(<ChannelFilter {...base} who="other" onApply={onApply} />);
    await user.click(screen.getByRole('button', { name: 'ตัวกรองแชท' }));
    await user.click(screen.getByRole('radio', { name: /LINE ร้าน/ }));
    expect(onApply).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'แสดงแชท' }));
    expect(onApply).toHaveBeenCalledExactlyOnceWith({ channel: 'LINE_SHOP', who: 'other' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ตัวกรองแชท' })).toHaveFocus();
  });

  it('discards unsaved selection and reset when dismissed with Escape', async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    render(<ChannelFilter {...base} channel="FACEBOOK" who="other" onApply={onApply} />);
    expect(screen.getByRole('button', { name: 'ตัวกรองแชท' })).toHaveAccessibleDescription(
      'ใช้ 2 ตัวกรอง',
    );
    await user.click(screen.getByRole('button', { name: 'ตัวกรองแชท' }));
    await user.click(screen.getByRole('button', { name: 'ล้างตัวกรอง' }));
    await user.keyboard('{Escape}');
    expect(onApply).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'ตัวกรองแชท' }));
    expect(screen.getByRole('radio', { name: /Facebook/ })).toBeChecked();
    expect(screen.getByRole('combobox', { name: 'ผู้ดูแล' })).toHaveTextContent('ผู้ดูแลคนอื่น');
  });

  it('locks the owner to mine and prevents a stale owner filter on Apply', async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    render(<ChannelFilter {...base} activeTab="mine" who="other" onApply={onApply} />);
    await user.click(screen.getByRole('button', { name: 'ตัวกรองแชท' }));
    expect(screen.getByRole('combobox', { name: 'ผู้ดูแล' })).toBeDisabled();
    await user.click(screen.getByRole('radio', { name: /Facebook/ }));
    await user.click(screen.getByRole('button', { name: 'แสดงแชท' }));
    expect(onApply).toHaveBeenCalledExactlyOnceWith({ channel: 'FACEBOOK', who: 'all' });
  });

  it('keeps a selected channel with zero rooms available so it can be cleared', async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    render(<ChannelFilter {...base} channel="WEB" onApply={onApply} />);
    await user.click(screen.getByRole('button', { name: 'ตัวกรองแชท' }));
    expect(screen.getByRole('radio', { name: /เว็บ/ })).toBeChecked();
    await user.click(screen.getByRole('button', { name: 'ล้างตัวกรอง' }));
    await user.click(screen.getByRole('button', { name: 'แสดงแชท' }));
    expect(onApply).toHaveBeenCalledExactlyOnceWith({ channel: null, who: 'all' });
  });

  it('removes one applied filter while preserving the other', () => {
    const onApply = vi.fn();
    render(<ActiveInboxFilters {...base} channel="FACEBOOK" who="other" onApply={onApply} />);
    fireEvent.click(screen.getByRole('button', { name: 'ล้างตัวกรอง Facebook' }));
    expect(onApply).toHaveBeenLastCalledWith({ channel: null, who: 'other' });
    fireEvent.click(screen.getByRole('button', { name: 'ล้างตัวกรอง ผู้ดูแลคนอื่น' }));
    expect(onApply).toHaveBeenLastCalledWith({ channel: 'FACEBOOK', who: 'all' });
  });

  it('keeps queue counts distinct from filter results and exposes a full count', () => {
    const onTabChange = vi.fn();
    render(
      <InboxTabs
        activeTab="waiting"
        counts={{ waiting: 582, mine: 1 }}
        onTabChange={onTabChange}
      />,
    );
    expect(screen.getByRole('button', { name: 'รอตอบ 582 ห้อง' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'ทั้งหมด' })).not.toHaveTextContent('582');
    fireEvent.click(screen.getByRole('button', { name: 'ของฉัน 1 ห้อง' }));
    expect(onTabChange).toHaveBeenCalledWith('mine');
  });
});

describe('Inbox filter — owner combobox (R2-4a)', () => {
  it('searches and picks an owner; Apply sends the staff id, never a sentinel', async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    render(<ChannelFilter {...base} onApply={onApply} />);
    await user.click(screen.getByRole('button', { name: 'ตัวกรองแชท' }));
    const owner = screen.getByRole('combobox', { name: 'ผู้ดูแล' });
    expect(owner).toHaveAttribute('data-slot', 'combobox-trigger');
    expect(owner).toHaveTextContent('ทุกคน');

    await pickComboOption(user, 'ผู้ดูแล', 'ผู้ดูแลคนอื่น', { search: 'คนอื่น' });

    expect(owner).toHaveTextContent('ผู้ดูแลคนอื่น');
    expect(screen.getByRole('dialog', { name: 'ตัวกรองแชท' })).toBeInTheDocument();
    expect(onApply).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'แสดงแชท' }));
    expect(onApply).toHaveBeenCalledExactlyOnceWith({ channel: null, who: 'other' });
  });

  it('shows the signed-in owner as "คุณ" and applies "ยังไม่มีผู้ดูแล" as who=free', async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    render(<ChannelFilter {...base} onApply={onApply} />);
    await user.click(screen.getByRole('button', { name: 'ตัวกรองแชท' }));
    const owner = screen.getByRole('combobox', { name: 'ผู้ดูแล' });

    await pickComboOption(user, 'ผู้ดูแล', 'พนักงานทดสอบ (คุณ)');
    expect(owner).toHaveTextContent(/^คุณ$/);

    await pickComboOption(user, 'ผู้ดูแล', 'ยังไม่มีผู้ดูแล');
    expect(owner).toHaveTextContent('ยังไม่มีผู้ดูแล');
    await user.click(screen.getByRole('button', { name: 'แสดงแชท' }));
    expect(onApply).toHaveBeenCalledExactlyOnceWith({ channel: null, who: 'free' });
  });

  it('keeps an applied owner who is not in the staff list', async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    render(<ChannelFilter {...base} who="left-company" onApply={onApply} />);
    await user.click(screen.getByRole('button', { name: 'ตัวกรองแชท' }));
    expect(screen.getByRole('combobox', { name: 'ผู้ดูแล' })).toHaveTextContent('ผู้ดูแลที่เลือก');
    await user.click(screen.getByRole('button', { name: 'แสดงแชท' }));
    expect(onApply).toHaveBeenCalledExactlyOnceWith({ channel: null, who: 'left-company' });
  });
});
