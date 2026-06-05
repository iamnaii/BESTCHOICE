import { thaiBahtText } from './thai-baht-text.util';

/**
 * Golden tests for the canonical Thai-baht-in-words helper (Wave 4 dedup of the
 * voucher / letter-pdf / receipt-pdf copies). Locks the exact wording used on
 * trade-in vouchers, dunning letters and other-income receipts.
 */
describe('thaiBahtText', () => {
  it('reads zero and whole baht with ถ้วน', () => {
    expect(thaiBahtText(0)).toBe('ศูนย์บาทถ้วน');
    expect(thaiBahtText(1)).toBe('หนึ่งบาทถ้วน');
    expect(thaiBahtText(100)).toBe('หนึ่งร้อยบาทถ้วน');
  });

  it('handles the เอ็ด / สิบ / ยี่สิบ special cases', () => {
    expect(thaiBahtText(11)).toBe('สิบเอ็ดบาทถ้วน');
    expect(thaiBahtText(21)).toBe('ยี่สิบเอ็ดบาทถ้วน');
    expect(thaiBahtText(25)).toBe('ยี่สิบห้าบาทถ้วน');
  });

  it('reads satang and the full mixed amount', () => {
    expect(thaiBahtText(1234.5)).toBe('หนึ่งพันสองร้อยสามสิบสี่บาทห้าสิบสตางค์');
    expect(thaiBahtText(1000.25)).toBe('หนึ่งพันบาทยี่สิบห้าสตางค์');
  });

  it('reads millions (incl. the 10,000,000 case the voucher copy broke on)', () => {
    expect(thaiBahtText(1_000_000)).toBe('หนึ่งล้านบาทถ้วน');
    expect(thaiBahtText(10_000_000)).toBe('สิบล้านบาทถ้วน');
    expect(thaiBahtText(1_234_567.89)).toBe(
      'หนึ่งล้านสองแสนสามหมื่นสี่พันห้าร้อยหกสิบเจ็ดบาทแปดสิบเก้าสตางค์',
    );
  });

  it('prefixes ลบ for negative amounts', () => {
    expect(thaiBahtText(-50.25)).toBe('ลบห้าสิบบาทยี่สิบห้าสตางค์');
  });

  it('guards non-finite input and the 1e12 ceiling', () => {
    expect(thaiBahtText(Infinity)).toBe('(จำนวนเงินไม่ถูกต้อง)');
    expect(thaiBahtText(NaN)).toBe('(จำนวนเงินไม่ถูกต้อง)');
    expect(thaiBahtText(1e12)).toBe('(จำนวนเงินเกินขีดจำกัด)');
  });
});
