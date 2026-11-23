import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ShieldCheck } from '@installment/icons';

describe('@installment/icons', () => {
  it('hides a decorative glyph and respects caller-supplied semantics', () => {
    expect(renderToStaticMarkup(<ShieldCheck />)).toContain('aria-hidden="true"');
    for (const icon of [
      <ShieldCheck role="img" />,
      <ShieldCheck alt="สถานะ" />,
      <ShieldCheck title="สถานะ" />,
      <ShieldCheck aria-label="สถานะ" />,
      <ShieldCheck aria-labelledby="caption" />,
      <ShieldCheck aria-describedby="detail" />,
      <ShieldCheck><title>สถานะ</title></ShieldCheck>,
      <ShieldCheck><desc>รายละเอียด</desc></ShieldCheck>,
      <ShieldCheck aria-hidden={false} />,
      <ShieldCheck onClick={() => {}} />,
      <ShieldCheck onKeyDown={() => {}} />,
      <ShieldCheck tabIndex={0} />,
      <ShieldCheck focusable="true" />,
    ]) {
      expect(renderToStaticMarkup(icon)).not.toContain('aria-hidden="true"');
    }
    expect(renderToStaticMarkup(<ShieldCheck aria-hidden="true" aria-label="สถานะ" />))
      .toContain('aria-hidden="true"');
  });

  it('renders a semantic icon with Phosphor duotone geometry and currentColor', () => {
    const svg = renderToStaticMarkup(<ShieldCheck aria-hidden="true" />);

    expect(svg).toContain('data-icon-style="duotone"');
    expect(svg).toContain('viewBox="0 0 256 256"');
    expect(svg).toContain('fill="currentColor"');
    expect(svg).toMatch(/<path\b[^>]*\bd="[^"]+"/);
    expect(svg).toContain('opacity="0.2"');
  });
});
