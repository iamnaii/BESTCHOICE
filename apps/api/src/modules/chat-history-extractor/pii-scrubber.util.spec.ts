import { scrubPii } from './pii-scrubber.util';

describe('scrubPii', () => {
  it('redacts Thai 13-digit national ID', () => {
    expect(scrubPii('เลขบัตร 1234567890123 ครับ')).toBe('เลขบัตร [REDACTED_ID] ครับ');
  });
  it('redacts full DOB dd/mm/yyyy', () => {
    expect(scrubPii('เกิด 15/07/1990')).toBe('เกิด [REDACTED_DOB]');
  });
  it('preserves phone numbers', () => {
    expect(scrubPii('โทร 0812345678')).toBe('โทร 0812345678');
  });
  it('preserves normal money numbers', () => {
    expect(scrubPii('ราคา 15,900 บาท')).toBe('ราคา 15,900 บาท');
  });
});
