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
