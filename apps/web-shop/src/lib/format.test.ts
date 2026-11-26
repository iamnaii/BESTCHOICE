import { describe, expect, test } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { formatNumber } from './format';

describe('formatNumber', () => {
  test('Thai grouping with a comma', () => {
    expect(formatNumber(42900)).toBe('42,900');
    expect(formatNumber(1515.83)).toBe('1,515.83');
    expect(formatNumber(0)).toBe('0');
  });

  test('passes options through, still Thai', () => {
    expect(formatNumber(1234.5, { minimumFractionDigits: 2 })).toBe('1,234.50');
    expect(formatNumber(1234.567, { maximumFractionDigits: 2 })).toBe('1,234.57');
  });

  test('matches a bare toLocaleString() on a Thai phone', () => {
    for (const n of [7, 1400, 42900, 1515.83, 999999.125]) {
      expect(formatNumber(n)).toBe(n.toLocaleString('th-TH'));
    }
  });

  test('does not follow the phone language', () => {
    // vi-VN groups with a dot; the storefront must not.
    expect((42900).toLocaleString('vi-VN')).not.toBe('42,900');
    expect(formatNumber(42900)).toBe('42,900');
  });
});

/** Files under src, skipping the throwaway preview folder and tests. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === '__preview__' ? [] : sourceFiles(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

test('no bare toLocaleString() left in the storefront (use formatNumber)', () => {
  const src = resolve(__dirname, '..');
  const offenders = sourceFiles(src).flatMap((file) =>
    readFileSync(file, 'utf8')
      .split('\n')
      .map((line, i) => ({ line, i }))
      .filter(({ line }) => /\.toLocaleString\(\s*(\)|undefined)/.test(line))
      .map(({ i }) => `${relative(src, file)}:${i + 1}`),
  );
  expect(offenders).toEqual([]);
});
