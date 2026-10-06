import { describe, expect, it } from 'vitest';
import { JOURNEY_RECORD_ROLES, canRecordJourney } from '@/lib/constants';

describe('canRecordJourney — ซ่อนปุ่มบันทึกการเดินทางตาม @Roles ของ POST/DELETE /customers/:id/journey/entries', () => {
  it('ชุดบทบาทตรงกับ API (มี FINANCE_MANAGER ต่างจาก CUSTOMER_CREATE_ROLES)', () => {
    expect(JOURNEY_RECORD_ROLES).toEqual(['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES']);
  });

  it.each(['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES'])('%s บันทึกได้', (role) => {
    expect(canRecordJourney(role)).toBe(true);
  });

  it.each([{ role: 'ACCOUNTANT' }, { role: '' }, { role: null }, { role: undefined }])(
    'บทบาท $role บันทึกไม่ได้ (ACCOUNTANT ไม่เห็นกลุ่มแชทที่แถวบันทึกมืออยู่ · ไม่มีบทบาท = ปิด)',
    ({ role }) => {
      expect(canRecordJourney(role)).toBe(false);
    },
  );
});
