import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatMediaPicker } from './ChatMediaPicker';
import { useChatMediaPicker } from '../hooks/useChatMediaPicker';

const emoji = vi.fn();
const sticker = vi.fn();
const gif = vi.fn();
const fetchGif = vi.fn();
function Harness({ line = false }: { line?: boolean }) {
  const model = useChatMediaPicker();
  const [open, setOpen] = useState(true);
  const [shown, setShown] = useState(true);
  return <>
    <button onClick={() => setShown(value => !value)}>toggle composer</button>
    {shown && <ChatMediaPicker model={model} open={open} onOpenChange={setOpen} isLineChannel={line} onEmoji={emoji} onSticker={sticker} onGif={gif} />}
  </>;
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchGif.mockResolvedValue({ json: async () => ({ data: [{ id: '1', title: 'test GIF', images: { fixed_width: { url: 'https://example.test/test.gif' } } }] }) });
  vi.stubGlobal('fetch', fetchGif);
});
afterEach(() => vi.unstubAllGlobals());

describe('chat media picker extracted from composer', () => {
  it('inserts emoji and offers LINE stickers without fetching GIFs', () => {
    render(<Harness line />);
    fireEvent.click(screen.getByRole('button', { name: '🙏' }));
    expect(emoji).toHaveBeenCalledWith('🙏');
    expect(screen.queryByRole('button', { name: 'GIF' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /📦 สติกเกอร์/ }));
    fireEvent.click(screen.getByTitle('Sticker 52002734'));
    expect(sticker).toHaveBeenCalledWith(11537, 52002734);
    expect(fetchGif).not.toHaveBeenCalled();
  });

  it('sends the full GIF URL and preserves search when the composer is hidden', async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'GIF' }));
    fireEvent.click(await screen.findByRole('button', { name: 'test GIF' }));
    expect(gif).toHaveBeenCalledWith('https://example.test/test.gif');
    fireEvent.change(screen.getByPlaceholderText('ค้นหา GIF...'), { target: { value: 'cats' } });
    fireEvent.click(screen.getByRole('button', { name: 'toggle composer' }));
    fireEvent.click(screen.getByRole('button', { name: 'toggle composer' }));
    expect(screen.getByPlaceholderText('ค้นหา GIF...')).toHaveValue('cats');
  });
});
