import { describe, it, expect } from 'vitest';
import { HASH_TO_CATEGORY } from '../SettingsIndexRedirect';

describe('HASH_TO_CATEGORY', () => {
  it('map hash tab เก่าครบทุกตัว → หมวดใหม่', () => {
    expect(HASH_TO_CATEGORY).toMatchObject({
      company: 'company',
      vat: 'accounting',
      periods: 'accounting',
      'peak-mapping': 'accounting',
      attachment: 'access',
      'internal-control': 'access',
      users: 'access',
      'offsite-backup': 'system',
      pdpa: 'system',
    });
  });

  it('#contacts is NOT in HASH_TO_CATEGORY (handled by dedicated redirect)', () => {
    expect(HASH_TO_CATEGORY).not.toHaveProperty('contacts');
  });
});
