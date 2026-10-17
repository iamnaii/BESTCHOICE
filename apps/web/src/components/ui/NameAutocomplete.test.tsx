import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NameAutocomplete } from './NameAutocomplete';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './dialog';

function Example({ onSubmit = () => {} }: { onSubmit?: () => void }) {
  const [value, setValue] = useState('');
  return <form onSubmit={event => { event.preventDefault(); onSubmit(); }}>
    <label htmlFor="custodian">ผู้รับผิดชอบ</label>
    <NameAutocomplete id="custodian" value={value} onChange={setValue} options={['สมชาย', 'สมศรี']} />
    <button type="submit">บันทึก</button>
  </form>;
}

describe('NameAutocomplete interactions', () => {
  it('selects a suggestion with arrows and Enter while retaining free text entry', () => {
    render(<Example />);
    const input = screen.getByLabelText('ผู้รับผิดชอบ');
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(input).toHaveValue('สมศรี');
    fireEvent.change(input, { target: { value: 'บุคคลใหม่' } });
    expect(input).toHaveValue('บุคคลใหม่');
  });

  it('lets click/assistive activation select without submitting the surrounding form', () => {
    const submit = vi.fn();
    render(<Example onSubmit={submit} />);
    const input = screen.getByLabelText('ผู้รับผิดชอบ');
    fireEvent.focus(input);
    fireEvent.click(screen.getByText('สมชาย'));
    expect(input).toHaveValue('สมชาย');
    expect(submit).not.toHaveBeenCalled();
  });

  it('closes suggestions on Escape without losing typed text or closing a parent overlay', () => {
    const parentKey = vi.fn();
    render(<div onKeyDown={parentKey}><Example /></div>);
    const input = screen.getByLabelText('ผู้รับผิดชอบ');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'สม' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByText('สมชาย')).not.toBeInTheDocument();
    expect(input).toHaveValue('สม');
    expect(parentKey).not.toHaveBeenCalled();
  });

  it('keeps a real Radix dialog open until the suggestion list has been dismissed', () => {
    const close = vi.fn();
    render(<Dialog open onOpenChange={close}><DialogContent>
      <DialogTitle>เพิ่มผู้รับผิดชอบ</DialogTitle>
      <DialogDescription>ทดสอบฟอร์มชื่อ</DialogDescription>
      <Example />
    </DialogContent></Dialog>);
    const input = screen.getByLabelText('ผู้รับผิดชอบ');
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(close).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(close).toHaveBeenCalledWith(false);
  });
});
