import { expect, it } from 'vitest';
import { formatTaxAmount, formatIncomeAmount } from './financial-display';
import { formatDuration } from '@/lib/format-duration';
import { buildExpenseLinePayload } from '@/components/expense-form-v4/expense-line-payload';

it.each([
  [null, '0.00', '—'],
  [undefined, '0.00', '—'],
  ['invalid', '0.00', '—'],
  ['', '0.00', '—'],
  ['123.45suffix', '0.00', '123.45'],
  ['1234.56', '1,234.56', '1,234.56'],
  [-0.01, '-0.01', '-0.01'],
] as const)(
  'preserves the two existing display policies for %s',
  (value, tax, income) => {
    expect(formatTaxAmount(value)).toBe(tax);
    expect(formatIncomeAmount(value)).toBe(income);
  },
);

it.each([
  [999, '999 ms'],
  [1000, '1.0 วิ'],
  [59999, '60.0 วิ'],
  [60000, '1.0 นาที'],
] as const)('formats job duration %s ms', (ms, expected) => {
  expect(
    formatDuration(
      '2026-10-01T00:00:00Z',
      new Date(Date.parse('2026-10-01T00:00:00Z') + ms).toISOString(),
    ),
  ).toBe(expected);
});
it('keeps unfinished jobs as a dash', () => expect(formatDuration('2026-10-01', null)).toBe('-'));

it.each(['', '0', 'invalid'])('preserves expense line defaults for %s', (value) => {
  expect(
    buildExpenseLinePayload({
      uid: 'local-only',
      category: 'TEST',
      description: '',
      quantity: value,
      unitPrice: '123.45',
      discount: '0.01',
      vatPercent: '7',
      whtPercent: '3',
      taxDisallowed: true,
    }),
  ).toEqual({
    category: 'TEST',
    description: undefined,
    quantity: 1,
    unitPrice: 123.45,
    discount: 0.01,
    vatPercent: 7,
    whtPercent: 3,
  });
});
