import { receiptDecimal } from './receipt-metadata';

describe('receipt metadata decimal', () => {
  it.each([null, undefined, {}, [], true, '', 'invalid', 'NaN', 'Infinity', Infinity])(
    'keeps malformed/nonfinite metadata unknown: %p',
    (value) => {
      expect(receiptDecimal(value)).toBeNull();
    },
  );
  it.each(['0', '0.01', '-1234.56', '9007199254740993.01'])(
    'retains exact decimal string %s',
    (value) => {
      expect(receiptDecimal(value)?.toFixed(2)).toBe(value === '0' ? '0.00' : value);
    },
  );
});
