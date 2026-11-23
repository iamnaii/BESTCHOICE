import { createElement, createRef } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import * as icons from '../index';

describe('shared Phosphor icon renderer', () => {
  it('renders every exported semantic icon as duotone SVG', () => {
    for (const [name, Icon] of Object.entries(icons)) {
      const svg = renderToStaticMarkup(createElement(Icon));
      expect(svg, name).toContain('data-icon-style="duotone"');
      expect(svg, name).toContain('viewBox="0 0 256 256"');
      expect(svg, name).toContain('<path');
    }
  });

  it('preserves refs, explicit dimensions, accessible labels, events and animation classes', () => {
    const ref = createRef<SVGSVGElement>();
    const click = vi.fn();
    render(
      <icons.Loader2
        ref={ref}
        size={18}
        color="currentColor"
        className="animate-spin text-primary"
        role="img"
        aria-label="กำลังโหลด"
        onClick={click}
      />,
    );
    const icon = screen.getByRole('img', { name: 'กำลังโหลด' });
    expect(ref.current).toBe(icon);
    expect(icon).toHaveAttribute('width', '18');
    expect(icon).toHaveAttribute('height', '18');
    expect(icon).toHaveClass('animate-spin', 'text-primary');
    fireEvent.click(icon);
    expect(click).toHaveBeenCalledOnce();
  });

  it('distinguishes paused AI and clear formatting from their active/action counterparts', () => {
    const shape = (Icon: icons.AppIcon) =>
      renderToStaticMarkup(createElement(Icon)).replace(/<svg[^>]*>|<\/svg>/g, '');
    expect(shape(icons.BotOff)).not.toBe(shape(icons.Bot));
    expect(shape(icons.MonitorOff)).not.toBe(shape(icons.Monitor));
    expect(shape(icons.PackageCheck)).not.toBe(shape(icons.Package));
    expect(shape(icons.RemoveFormatting)).not.toBe(shape(icons.Strikethrough));
  });

  it('prevents outline-only props from hiding or distorting filled paths', () => {
    const { container } = render(
      <icons.ShieldCheck
        fill="none"
        stroke="currentColor"
        strokeWidth={3}
        absoluteStrokeWidth
        aria-hidden="true"
      />,
    );
    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('fill', 'currentColor');
    expect(svg).not.toHaveAttribute('stroke');
    expect(svg).not.toHaveAttribute('stroke-width');
    expect(svg).not.toHaveAttribute('absoluteStrokeWidth');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg?.querySelector('[opacity="0.2"]')).not.toBeNull();
  });
});
