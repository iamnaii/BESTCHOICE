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
