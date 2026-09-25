import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import MessageBubble from './MessageBubble';

const imageMessage = {
  id: 'm1',
  role: 'CUSTOMER',
  type: 'IMAGE',
  text: null,
  mediaUrl: 'https://example.com/slip.jpg',
  mediaType: 'image/jpeg',
  createdAt: '2026-07-16T04:00:00.000Z',
};

describe('MessageBubble — image click opens lightbox', () => {
  it('attaches with a visible touch button and drags only the message id', () => {
    const onCreditMessage = vi.fn();
    render(<MessageBubble message={imageMessage} onCreditMessage={onCreditMessage} />);
    const button = screen.getByRole('button', { name: 'แนบเพื่อตรวจเครดิต' });
    expect(button.className).toContain('[@media(hover:none)]:opacity-100');
    fireEvent.click(button);
    expect(onCreditMessage).toHaveBeenCalledWith('m1');
    const dataTransfer = { setData: vi.fn(), clearData: vi.fn(), effectAllowed: '' };
    fireEvent.dragStart(screen.getByAltText('media'), { dataTransfer });
    expect(dataTransfer.clearData).toHaveBeenCalled();
    expect(dataTransfer.setData).toHaveBeenCalledExactlyOnceWith('application/x-bestchoice-credit-message', 'm1');
  });
  it('shows attached state and prevents using an image that failed to load', () => {
    render(<MessageBubble message={imageMessage} onCreditMessage={vi.fn()} creditAttached />);
    expect(screen.getByRole('button', { name: 'เอาออกจากการตรวจเครดิต' })).toBeInTheDocument();
    fireEvent.error(screen.getByAltText('media'));
    expect(screen.getByRole('button', { name: /โหลดไฟล์ไม่ได้/ })).toBeDisabled();
  });
  it('enables a refreshed media URL after the old image expired', () => {
    const props = { message: imageMessage, onCreditMessage: vi.fn() };
    const view = render(<MessageBubble {...props} />);
    fireEvent.error(screen.getByAltText('media'));
    view.rerender(<MessageBubble {...props} message={{ ...imageMessage, mediaUrl: 'https://example.com/new.jpg' }} />);
    expect(screen.getByRole('button', { name: 'แนบเพื่อตรวจเครดิต' })).toBeEnabled();
  });
  afterEach(() => vi.restoreAllMocks());

  it('opens the in-app lightbox instead of a new tab', () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    render(<MessageBubble message={imageMessage} />);

    fireEvent.click(screen.getByAltText('media'));

    // Lightbox dialog appears with its zoom controls…
    expect(screen.getByRole('button', { name: 'ซูมเข้า' })).toBeInTheDocument();
    expect(screen.getByText('100%')).toBeInTheDocument();
    // …and we no longer punt to a browser tab.
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('close button dismisses the lightbox', () => {
    render(<MessageBubble message={imageMessage} />);
    fireEvent.click(screen.getByAltText('media'));

    fireEvent.click(screen.getByRole('button', { name: 'ปิด' }));
    expect(screen.queryByRole('button', { name: 'ซูมเข้า' })).not.toBeInTheDocument();
  });
});

describe('GFIN pick button', () => {
  const base = { id: 'm1', role: 'CUSTOMER', type: 'IMAGE', mediaUrl: 'https://scontent.xx.fbcdn.net/a.jpg', createdAt: '2026-09-24T12:00:00Z' };
  it('shows the GFIN button for a pickable image and calls onGfinMessage with the id', () => {
    const onGfin = vi.fn();
    render(<MessageBubble message={base} onGfinMessage={onGfin} />);
    fireEvent.click(screen.getByRole('button', { name: 'ใส่ในใบยื่น GFIN' }));
    expect(onGfin).toHaveBeenCalledWith('m1');
  });
  it('hides the button for a legacy LINE image without media url or message id, shows it when only externalMessageId exists', () => {
    const { rerender } = render(<MessageBubble message={{ ...base, mediaUrl: null, externalMessageId: null }} onGfinMessage={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'ใส่ในใบยื่น GFIN' })).toBeNull();
    rerender(<MessageBubble message={{ ...base, mediaUrl: null, externalMessageId: '9' }} onGfinMessage={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'ใส่ในใบยื่น GFIN' })).toBeInTheDocument();
  });
  it('drag start writes both the credit and GFIN MIME payloads', () => {
    render(<MessageBubble message={base} onGfinMessage={vi.fn()} onCreditMessage={vi.fn()} />);
    const setData = vi.fn();
    const bubble = screen.getByRole('button', { name: 'ใส่ในใบยื่น GFIN' }).parentElement!;
    fireEvent.dragStart(bubble, { dataTransfer: { setData, clearData: vi.fn(), types: [] } });
    expect(setData).toHaveBeenCalledWith('application/x-bestchoice-gfin-message', 'm1');
    expect(setData).toHaveBeenCalledWith('application/x-bestchoice-credit-message', 'm1');
  });
  // minor 11 — ไฟล์จาก LINE ไฟแนนซ์ที่ webhook เก็บแค่ message id เคยเป็นฟองว่าง
  it('a FILE without mediaUrl shows a "[ไฟล์]" label (not an empty bubble) and keeps the GFIN pick button', () => {
    const onGfin = vi.fn();
    const { rerender } = render(<MessageBubble message={{ ...base, type: 'FILE', mediaUrl: null, text: null, externalMessageId: 'LF-9' }} onGfinMessage={onGfin} />);
    expect(screen.getByText('[ไฟล์]')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'ใส่ในใบยื่น GFIN' }));
    expect(onGfin).toHaveBeenCalledWith('m1');
    rerender(<MessageBubble message={{ ...base, type: 'FILE', mediaUrl: null, text: 'statement.pdf', externalMessageId: 'LF-9' }} onGfinMessage={onGfin} />);
    expect(screen.getByText('[ไฟล์] statement.pdf')).toBeInTheDocument();
  });
  it('a FILE with a mediaUrl still renders the download tile, not the "[ไฟล์]" label', () => {
    render(<MessageBubble message={{ ...base, type: 'FILE', mediaUrl: 'https://scontent.xx.fbcdn.net/a.pdf', text: 'a.pdf' }} />);
    expect(screen.queryByText(/\[ไฟล์\]/)).toBeNull();
    expect(screen.getByText('a.pdf').closest('a')).toHaveAttribute('href', 'https://scontent.xx.fbcdn.net/a.pdf');
  });
  it('marks an attached message and offers removal on the second click', () => {
    const onGfin = vi.fn();
    render(<MessageBubble message={base} onGfinMessage={onGfin} gfinAttached />);
    fireEvent.click(screen.getByRole('button', { name: 'เอาออกจากใบยื่น GFIN' }));
    expect(onGfin).toHaveBeenCalledWith('m1');
  });
});
