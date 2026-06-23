import { describe, it, expect } from 'vitest';
import { HASH_TO_CATEGORY } from '../SettingsIndexRedirect';

describe('HASH_TO_CATEGORY', () => {
  it('map hash tab เก่าครบทุกตัว → หมวดใหม่', () => {
    expect(HASH_TO_CATEGORY).toMatchObject({
      contacts: 'company',
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
});
