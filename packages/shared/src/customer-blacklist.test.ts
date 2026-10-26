import { describe, expect, it } from 'vitest';
import { canOverrideBlacklist, isValidBlacklistOverrideReason, resolveBlacklistLevel } from './customer-blacklist';

describe('customer-blacklist shared rules', () => {
  it('HARD wins over SOFT, SOFT over nothing', () => {
    expect(resolveBlacklistLevel([])).toBe('NONE');
    expect(resolveBlacklistLevel([{ level: 'SOFT' }])).toBe('SOFT');
    expect(resolveBlacklistLevel([{ level: 'SOFT' }, { level: 'HARD' }])).toBe('HARD');
  });
  it('only OWNER and BRANCH_MANAGER can override', () => {
    expect(canOverrideBlacklist('OWNER')).toBe(true);
    expect(canOverrideBlacklist('BRANCH_MANAGER')).toBe(true);
    expect(canOverrideBlacklist('FINANCE_MANAGER')).toBe(false);
    expect(canOverrideBlacklist(undefined)).toBe(false);
  });
  it('override reason is 10–500 chars after trim', () => {
    expect(isValidBlacklistOverrideReason('   สั้นไป   ')).toBe(false);
    expect(isValidBlacklistOverrideReason('เหตุผลยาวพอสิบตัว')).toBe(true);
    expect(isValidBlacklistOverrideReason('ก'.repeat(501))).toBe(false);
    expect(isValidBlacklistOverrideReason(null)).toBe(false);
  });
});
