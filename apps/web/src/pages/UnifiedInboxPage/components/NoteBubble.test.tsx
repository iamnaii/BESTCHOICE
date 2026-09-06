import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import NoteBubble from './NoteBubble';
import PinnedNoteBar from './PinnedNoteBar';

const NOTE = { id: 'n1', content: 'ลูกค้าจะมารับพรุ่งนี้ 4 โมง', createdAt: '2026-09-05T07:12:00Z', staff: { id: 'u1', name: 'แนน' } };

describe('NoteBubble / PinnedNoteBar', () => {
  it('ฟองโน้ต: บอกว่าเห็นเฉพาะทีม · ปักหมุดได้ · ลบเฉพาะเมื่อ canDelete', () => {
    const onPin = vi.fn();
    const { rerender } = render(<NoteBubble note={NOTE} isPinned={false} canDelete={false} onPin={onPin} />);
    expect(screen.getByText('ลูกค้าจะมารับพรุ่งนี้ 4 โมง')).toBeInTheDocument();
    expect(screen.getByText('เห็นเฉพาะทีมงาน ไม่ส่งถึงลูกค้า')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'ลบโน้ต' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'ปักหมุดโน้ต' }));
    expect(onPin).toHaveBeenCalledWith('n1');
    rerender(<NoteBubble note={NOTE} isPinned canDelete onPin={onPin} />);
    expect(screen.getByText('เป็นโน้ตของห้อง')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ปลดหมุดโน้ต' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ลบโน้ต' })).toBeInTheDocument();
  });

  it('แถบโน้ตของห้อง: ✕ ต้องยืนยันก่อนปลดหมุด', () => {
    const onUnpin = vi.fn();
    render(<PinnedNoteBar note={NOTE} onUnpin={onUnpin} />);
    const bar = screen.getByRole('note', { name: 'โน้ตของห้อง' });
    expect(bar).toHaveTextContent('โน้ตของห้อง');
    expect(bar).toHaveTextContent('ลูกค้าจะมารับพรุ่งนี้ 4 โมง');
    fireEvent.click(screen.getByRole('button', { name: 'ปลดโน้ตของห้อง' }));
    expect(onUnpin).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'ปลดหมุด' }));
    expect(onUnpin).toHaveBeenCalledWith('n1');
  });
});
