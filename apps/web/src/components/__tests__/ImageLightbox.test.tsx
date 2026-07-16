import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ImageLightbox } from '../ImageLightbox';

const getImage = () => screen.getByAltText('รูปภาพ') as HTMLImageElement;

describe('ImageLightbox', () => {
  it('renders nothing when src is null', () => {
    render(<ImageLightbox src={null} onClose={vi.fn()} />);
    expect(screen.queryByAltText('รูปภาพ')).not.toBeInTheDocument();
  });

  it('opens with the image at 100% when src is set', () => {
    render(<ImageLightbox src="https://example.com/a.jpg" onClose={vi.fn()} />);
    expect(getImage().src).toBe('https://example.com/a.jpg');
    expect(getImage().style.height).toBe('80vh');
    expect(screen.getByText('100%')).toBeInTheDocument();
  });

  it('zoom + / − step the layout height by 25% and update the readout', () => {
    render(<ImageLightbox src="https://example.com/a.jpg" onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'ซูมเข้า' }));
    expect(getImage().style.height).toBe('100vh');
    expect(screen.getByText('125%')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'ซูมออก' }));
    fireEvent.click(screen.getByRole('button', { name: 'ซูมออก' }));
    expect(getImage().style.height).toBe('60vh');
    expect(screen.getByText('75%')).toBeInTheDocument();
  });

  it('clamps zoom to 50%–400% and disables the button at each edge', () => {
    render(<ImageLightbox src="https://example.com/a.jpg" onClose={vi.fn()} />);
    const zoomOut = screen.getByRole('button', { name: 'ซูมออก' });
    const zoomIn = screen.getByRole('button', { name: 'ซูมเข้า' });

    fireEvent.click(zoomOut);
    fireEvent.click(zoomOut);
    fireEvent.click(zoomOut); // extra click beyond the clamp
    expect(screen.getByText('50%')).toBeInTheDocument();
    expect(zoomOut).toBeDisabled();

    for (let i = 0; i < 20; i++) fireEvent.click(zoomIn);
    expect(screen.getByText('400%')).toBeInTheDocument();
    expect(zoomIn).toBeDisabled();
  });

  it('double-click toggles between 100% and 200%', () => {
    render(<ImageLightbox src="https://example.com/a.jpg" onClose={vi.fn()} />);
    fireEvent.doubleClick(getImage());
    expect(screen.getByText('200%')).toBeInTheDocument();
    fireEvent.doubleClick(getImage());
    expect(screen.getByText('100%')).toBeInTheDocument();
  });

  it('resets zoom to 100% when src changes', () => {
    const { rerender } = render(<ImageLightbox src="https://example.com/a.jpg" onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'ซูมเข้า' }));
    expect(screen.getByText('125%')).toBeInTheDocument();

    rerender(<ImageLightbox src="https://example.com/b.jpg" onClose={vi.fn()} />);
    expect(screen.getByText('100%')).toBeInTheDocument();
    expect(getImage().src).toBe('https://example.com/b.jpg');
  });

  it('close button calls onClose', () => {
    const onClose = vi.fn();
    render(<ImageLightbox src="https://example.com/a.jpg" onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'ปิด' }));
    expect(onClose).toHaveBeenCalled();
  });
});
