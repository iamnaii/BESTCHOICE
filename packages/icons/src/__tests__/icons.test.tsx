import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ShieldCheck } from '@installment/icons';

describe('@installment/icons', () => {
  it('renders a semantic icon with Phosphor duotone geometry and currentColor', () => {
    const svg = renderToStaticMarkup(<ShieldCheck aria-hidden="true" />);

    expect(svg).toContain('data-icon-style="duotone"');
    expect(svg).toContain('viewBox="0 0 256 256"');
    expect(svg).toContain('fill="currentColor"');
    expect(svg).toMatch(/<path\b[^>]*\bd="[^"]+"/);
    expect(svg).toContain('opacity="0.2"');
  });
});
