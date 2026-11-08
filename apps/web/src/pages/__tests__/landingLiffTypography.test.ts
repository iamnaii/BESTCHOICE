import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Source-reading test (same style as headerNowrap.test.ts): render of LandingPage/LiffHistory needs heavy mocks.
const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

describe('LandingPage.tsx', () => {
  it('landing section headings use leading-[1.3]', () => {
    const h2s = [...read('LandingPage.tsx').matchAll(/<h2\b[^>]*className="([^"]*)"/g)].map((m) => m[1]);
    expect(h2s.length).toBe(4);
    for (const c of h2s) expect(c).toContain('leading-[1.3]');
  });
});

describe('liff/LiffHistory.tsx', () => {
  it('LIFF receipt pill uses text-xs and no leading-none', () => {
    const m = read('liff/LiffHistory.tsx').match(/<a\b[^>]*?className="([^"]*)"[^>]*>\s*<Download\b/);
    expect(m).not.toBeNull();
    const c = m![1];
    expect(c).toContain('text-xs');
    expect(c).not.toContain('text-[10px]');
    expect(c).not.toContain('leading-none');
    expect(c).toContain('leading-normal');
  });
});
