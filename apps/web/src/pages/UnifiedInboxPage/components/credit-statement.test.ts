import { describe, it, expect } from 'vitest';
import { creditHeadline, validateCreditFile, CREDIT_MESSAGE_MIME } from './credit-statement';

describe('credit statement numbers', () => {
  it('uses affordablePayment, including zero, never monthlyPayment', () => {
    expect(creditHeadline({ affordablePayment: 0, monthlyPayment: 8000 })).toEqual({
      label: 'ผ่อนไหวเดือนละ',
      amount: 0,
    });
    expect(creditHeadline({ monthlyPayment: 8000 })).toBeNull();
  });
  it('labels monthly surplus separately and preserves a deficit', () => {
    expect(creditHeadline({ monthlyIncome: 10000, monthlyExpense: 12000 })).toEqual({
      label: 'เงินเหลือต่อเดือน',
      amount: -2000,
    });
  });
  it('labels period totals honestly and hides unknown values', () => {
    expect(
      creditHeadline({ totalIncome: 30000, totalExpense: 10000, dateRange: 'ม.ค.–มี.ค.' }),
    ).toEqual({ label: 'เงินเหลือช่วง ม.ค.–มี.ค.', amount: 20000 });
    expect(creditHeadline({ monthlyIncome: null, monthlyExpense: 0 })).toBeNull();
    expect(creditHeadline({})).toBeNull();
    expect(creditHeadline({ affordablePayment: Infinity })).toBeNull();
  });
  it('has a custom drag payload distinct from Files or text/uri-list', () => {
    expect(CREDIT_MESSAGE_MIME).toBe('application/x-bestchoice-credit-message');
  });
  it('rejects HEIC and large files with an actionable message', async () => {
    await expect(
      validateCreditFile(new File(['heic'], 'statement.heic', { type: 'image/heic' })),
    ).rejects.toThrow('JPEG');
    await expect(
      validateCreditFile(
        new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'big.jpg', { type: 'image/jpeg' }),
      ),
    ).rejects.toThrow('10MB');
  });
  it('detects a locked PDF before uploading it', async () => {
    const { PDFDocument, PDFName } = await import('pdf-lib');
    const doc = await PDFDocument.create();
    doc.addPage();
    const encrypt = doc.context.obj({ Filter: PDFName.of('Standard'), V: 1, R: 2 });
    doc.context.trailerInfo.Encrypt = doc.context.register(encrypt);
    const bytes = await doc.save();
    const file = new File([bytes as BlobPart], 'locked.pdf', { type: 'application/pdf' });
    await expect(validateCreditFile(file)).rejects.toThrow('ไฟล์นี้ล็อกรหัส');
  });
});
