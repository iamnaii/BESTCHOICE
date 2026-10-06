import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { NoteMentionComposer } from './NoteMentionInput';
const people = [
  { id: 'a', name: 'เมย์', role: 'SALES', detail: 'รังสิต' },
  { id: 'b', name: 'เมย์', role: 'FINANCE_MANAGER', detail: 'สำนักงานใหญ่' },
];
describe('Internal note composer', () => {
  it('selects explicit identities by keyboard and removes hidden recipients', async () => {
    const save = vi.fn().mockResolvedValue(true);
    render(<NoteMentionComposer people={people} onSave={save} onRetry={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('พิมพ์โน้ตภายใน'), {
      target: { value: '@เมย์ ตรวจเอกสารให้หน่อย' },
    });
    const search = screen.getByRole('combobox');
    fireEvent.change(search, { target: { value: 'เมย์' } });
    fireEvent.keyDown(search, { key: 'ArrowDown' });
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /ลบผู้รับ.*สำนักงานใหญ่/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /ลบผู้รับ/ }));
    fireEvent.click(screen.getByRole('button', { name: 'บันทึกโน้ต' }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({ mentionedUserIds: [], content: '@เมย์ ตรวจเอกสารให้หน่อย' }),
      ),
    );
  });
  it('retains text, visible recipients and the request token after failure', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(true);
    render(<NoteMentionComposer people={people} onSave={save} onRetry={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('พิมพ์โน้ตภายใน'), {
      target: { value: 'ตรวจให้หน่อย' },
    });
    fireEvent.focus(screen.getByRole('combobox'));
    fireEvent.click(screen.getByRole('option', { name: /สำนักงานใหญ่/ }));
    fireEvent.click(screen.getByRole('button', { name: 'บันทึกโน้ต' }));
    await screen.findByRole('alert');
    expect(screen.getByLabelText('พิมพ์โน้ตภายใน')).toHaveValue('ตรวจให้หน่อย');
    fireEvent.click(screen.getByRole('button', { name: 'บันทึกโน้ต' }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save.mock.calls[0][0]).toEqual(save.mock.calls[1][0]);
    expect(save.mock.calls[0][0].mentionedUserIds).toEqual(['b']);
    await waitFor(() => expect(screen.getByLabelText('พิมพ์โน้ตภายใน')).toHaveValue(''));
  });
  it('does not clear a newer draft while a note is saving', async () => {
    let resolve!: (value: boolean) => void;
    const save = vi.fn(
      () =>
        new Promise<boolean>((r) => {
          resolve = r;
        }),
    );
    render(<NoteMentionComposer people={people} onSave={save} onRetry={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('พิมพ์โน้ตภายใน'), { target: { value: 'เดิม' } });
    fireEvent.click(screen.getByRole('button', { name: 'บันทึกโน้ต' }));
    fireEvent.change(screen.getByLabelText('พิมพ์โน้ตภายใน'), { target: { value: 'ฉบับใหม่' } });
    resolve(true);
    await waitFor(() => expect(screen.getByRole('button', { name: 'บันทึกโน้ต' })).toBeEnabled());
    expect(screen.getByLabelText('พิมพ์โน้ตภายใน')).toHaveValue('ฉบับใหม่');
  });
  it('supports Escape, empty search and a retryable directory error', () => {
    const retry = vi.fn();
    const { rerender } = render(
      <NoteMentionComposer people={people} onSave={vi.fn()} onRetry={retry} />,
    );
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'ไม่มีชื่อนี้' } });
    expect(screen.getByText('ไม่พบผู้รับที่มีสิทธิ์ในห้องนี้')).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape' });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    rerender(<NoteMentionComposer people={[]} error onSave={vi.fn()} onRetry={retry} />);
    fireEvent.click(screen.getByRole('button', { name: 'ลองใหม่' }));
    expect(retry).toHaveBeenCalledOnce();
  });
});
