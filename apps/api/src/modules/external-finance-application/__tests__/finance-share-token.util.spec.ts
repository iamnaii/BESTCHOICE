import { newShareToken, hashShareToken } from '../finance-share-token.util';

describe('finance-share-token.util', () => {
  it('makes 43-char base64url tokens and a 64-hex sha256 hash', () => {
    const { raw, hash } = newShareToken();
    expect(raw).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashShareToken(raw)).toBe(hash);
    expect(newShareToken().raw).not.toBe(raw);
  });
});
