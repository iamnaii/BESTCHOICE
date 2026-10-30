import { hashToken, newRawToken, newRegistrationCode, PIN_LOCK_MS, PIN_LOCK_THRESHOLD, REGISTRATION_TTL_MS, REQUEST_CACHE_TTL_MS } from '../attendance-token.util';

/** ก้อน 10 D3 Task 3 — token/รหัสลงทะเบียนของเครื่องตอกบัตร */
describe('attendance token util', () => {
  it('TU1 newRawToken is 43-char base64url and unique per call', () => {
    const a = newRawToken();
    const b = newRawToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
  });

  it('TU2 hashToken is a deterministic sha256 hex (64 chars) and differs per input', () => {
    expect(hashToken('abc')).toBe(hashToken('abc'));
    expect(hashToken('abc')).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken('abc')).not.toBe(hashToken('abd'));
  });

  it('TU3 newRegistrationCode is 8 chars from the unambiguous alphabet (no 0 O 1 I L)', () => {
    for (let i = 0; i < 50; i++) expect(newRegistrationCode()).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/);
  });

  it('TU4 constants match the spec (10 min code · 5 min request cache · 5 tries · 15 min lock)', () => {
    expect(REGISTRATION_TTL_MS).toBe(10 * 60_000);
    expect(REQUEST_CACHE_TTL_MS).toBe(5 * 60_000);
    expect(PIN_LOCK_THRESHOLD).toBe(5);
    expect(PIN_LOCK_MS).toBe(15 * 60_000);
  });
});
