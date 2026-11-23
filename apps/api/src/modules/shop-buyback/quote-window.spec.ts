import { issueQuoteWindow, QUOTE_WINDOW_MS, verifyQuoteWindow } from './quote-window';

const input = { model: 'iPhone 13 Pro Max', storage: '128GB', answers: [{ questionKey: 'origin', choiceIds: ['thai'] }], deviceEligibilityConfirmed: true };
const now = Date.parse('2026-11-21T06:41:00Z');
const key = 'isolated-sell-test-signing-key';
describe('signed sell quote window', () => {
  it('issues exactly 24 hours and accepts just before the deadline', () => {
    const quote = issueQuoteWindow(input, now, key);
    expect(quote.assessedAt).toBe('2026-11-21T06:41:00.000Z');
    expect(quote.expiresAt).toBe('2026-11-22T06:41:00.000Z');
    expect(verifyQuoteWindow(quote.quoteToken, input, now + QUOTE_WINDOW_MS - 1, key)).toEqual({ assessedAt: quote.assessedAt, expiresAt: quote.expiresAt });
  });
  it('rejects at the deadline and afterward', () => {
    const quote = issueQuoteWindow(input, now, key);
    for (const time of [now + QUOTE_WINDOW_MS, now + QUOTE_WINDOW_MS + 1]) {
      expect(() => verifyQuoteWindow(quote.quoteToken, input, time, key)).toThrow('พ้นช่วงอ้างอิง');
    }
  });
  it('rejects edited answers/model/storage/eligibility and a wrong signing key', () => {
    const quote = issueQuoteWindow(input, now, key);
    for (const changed of [{ ...input, model: 'iPhone 14' }, { ...input, storage: '256GB' }, { ...input, answers: [] }, { ...input, deviceEligibilityConfirmed: false }]) {
      expect(() => verifyQuoteWindow(quote.quoteToken, changed, now, key)).toThrow('ไม่ตรง');
    }
    expect(() => verifyQuoteWindow(quote.quoteToken, input, now, 'other-key')).toThrow('ไม่ตรง');
  });
  it('rejects missing/malformed/unicode signatures and payload tampering without a server error', () => {
    const quote = issueQuoteWindow(input, now, key);
    const [body, sig] = quote.quoteToken.split('.');
    for (const token of [undefined, '', 'x.y.z', `${body}.${'ก'.repeat(43)}`, `x${body}.${sig}`, `${body}.x${sig}`, 'a'.repeat(2049)]) {
      expect(() => verifyQuoteWindow(token, input, now, key)).toThrow('ไม่ตรง');
    }
  });
  it('allows answer ordering changes but not a future issue time', () => {
    const value = { ...input, answers: [{ questionKey: 'b', choiceIds: ['2', '1'] }, { questionKey: 'a', choiceIds: [] }] };
    const quote = issueQuoteWindow(value, now, key);
    expect(() => verifyQuoteWindow(quote.quoteToken, { ...value, answers: [{ questionKey: 'a', choiceIds: [] }, { questionKey: 'b', choiceIds: ['1', '2'] }] }, now, key)).not.toThrow();
    expect(() => verifyQuoteWindow(quote.quoteToken, value, now - 1, key)).toThrow('ไม่ตรง');
  });
});
