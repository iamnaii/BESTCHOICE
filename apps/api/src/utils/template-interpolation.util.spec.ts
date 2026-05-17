import { interpolateTemplate } from './template-interpolation.util';

describe('interpolateTemplate (D1.2.4.4)', () => {
  it('replaces a single token with the matching value', () => {
    const out = interpolateTemplate('สวัสดีคุณ {{name}}', { name: 'สมชาย' });
    expect(out).toBe('สวัสดีคุณ สมชาย');
  });

  it('replaces multiple tokens (including the same key twice)', () => {
    const out = interpolateTemplate(
      'จาก {{from}} ถึง {{to}} โดย {{from}}',
      { from: 'A', to: 'B' },
    );
    expect(out).toBe('จาก A ถึง B โดย A');
  });

  it('keeps the raw token when a key is missing (no silent blank)', () => {
    const out = interpolateTemplate('Hello {{name}} from {{branch}}', {
      name: 'Alice',
    });
    expect(out).toBe('Hello Alice from {{branch}}');
  });

  it('keeps the raw token for null/undefined explicit values', () => {
    const out = interpolateTemplate('A={{a}} B={{b}}', {
      a: null as unknown as string,
      b: undefined as unknown as string,
    });
    expect(out).toBe('A={{a}} B={{b}}');
  });

  it('HTML-escapes replacement values to prevent XSS in voucher render', () => {
    const out = interpolateTemplate('Note: {{note}}', {
      note: '<script>alert("xss")</script>',
    });
    expect(out).toBe(
      'Note: &lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;',
    );
  });

  it('does NOT re-interpolate nested tokens (single-pass by design)', () => {
    const out = interpolateTemplate('Outer: {{a}}', {
      a: '{{b}}',
      b: 'inner',
    });
    // a's value contains {{b}} but it's NOT processed again. Also HTML-
    // escape applies — `{` and `}` are not in the escape set, so they
    // come through verbatim.
    expect(out).toBe('Outer: {{b}}');
  });

  it('tolerates whitespace inside braces', () => {
    const out = interpolateTemplate('{{ name }} / {{  name  }}', {
      name: 'X',
    });
    expect(out).toBe('X / X');
  });

  it('returns the input unchanged when vars is null/undefined/empty', () => {
    expect(interpolateTemplate('Hello {{name}}', null)).toBe('Hello {{name}}');
    expect(interpolateTemplate('Hello {{name}}', undefined)).toBe(
      'Hello {{name}}',
    );
    expect(interpolateTemplate('Hello {{name}}', {})).toBe('Hello {{name}}');
  });

  it('does not match dotted/special-char keys (kept as raw tokens)', () => {
    const out = interpolateTemplate('{{user.name}} / {{a-b}}', {
      'user.name': 'Alice',
      'a-b': 'AB',
    });
    // Regex restricts keys to [a-zA-Z0-9_]+, so these stay raw.
    expect(out).toBe('{{user.name}} / {{a-b}}');
  });

  it('handles empty template + falsy input gracefully', () => {
    expect(interpolateTemplate('', { x: 'y' })).toBe('');
    expect(interpolateTemplate(null as unknown as string, { x: 'y' })).toBe(
      null,
    );
  });
});
