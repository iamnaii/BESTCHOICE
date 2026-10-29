import { Prisma } from '@prisma/client';
import type { DumpRow } from '../dump-reader';
import {
  LEGACY_CUSTOMER_COLUMNS,
  parseCustomerOverridesCsv,
  toLegacyCustomerInput,
} from '../customer';
import { formatFullAddress, resolveTambon } from '../thai-address';

/**
 * แปลงแถวลูกค้าระบบเก่าเป็น input ของการผูก/สร้างลูกค้า (Task 8) — ข้อมูลสังเคราะห์ทั้งหมด
 * (ชื่อ "ทดสอบระบบ", เลขบัตรขึ้นต้น 09 ที่คำนวณหลักตรวจเอง, เบอร์ 0977…) · ชื่อตำบลเป็นข้อมูลสาธารณะ
 */

/** เลขบัตร 13 หลักที่ checksum ถูก จาก 12 หลักแรก */
function thaiId(first12: string): string {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (13 - i);
  return `${first12}${(11 - (sum % 11)) % 10}`;
}

const NID = thaiId('090000000001');

function blank(columns: readonly string[]): DumpRow {
  return Object.fromEntries(columns.map((c) => [c, null]));
}

function member(over: DumpRow = {}): DumpRow {
  return {
    ...blank(LEGACY_CUSTOMER_COLUMNS.member),
    member_id: '501',
    member_code: 'TEST-M-501',
    member_name: 'ทดสอบระบบ',
    member_surname: 'สมมุติ',
    member_identity_number: NID,
    member_tel: '097-700 0001',
    member_monthly_income: '0',
    ...over,
  };
}

function order(over: DumpRow = {}): DumpRow {
  return {
    ...blank(LEGACY_CUSTOMER_COLUMNS.order),
    order_id: '701',
    member_monthly_income: '0',
    ...over,
  };
}

function errorOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error('expected a throw');
}

describe('thai-address (moved from scripts/import-legacy)', () => {
  it('still loads the tambon data and resolves a known code', () => {
    expect(resolveTambon('100101')).toEqual({
      tambon: 'พระบรมมหาราชวัง',
      amphure: 'เขตพระนคร',
      province: 'กรุงเทพมหานคร',
      zipcode: '10200',
    });
  });

  it('returns empty names for a missing, non-numeric or unknown code', () => {
    const none = { tambon: null, amphure: null, province: null, zipcode: null };
    expect(resolveTambon(null)).toEqual(none);
    expect(resolveTambon('abc')).toEqual(none);
    expect(resolveTambon('999999')).toEqual(none);
  });

  it('formats line + tambon names + zip, falling back to the raw zip for an unknown code', () => {
    expect(formatFullAddress('99/9 หมู่ 1', '100101', '10000')).toBe(
      '99/9 หมู่ 1 ต.พระบรมมหาราชวัง อ.เขตพระนคร จ.กรุงเทพมหานคร 10200',
    );
    expect(formatFullAddress(' 99/9 ', '999999', '15000')).toBe('99/9 15000');
    expect(formatFullAddress(null, null, null)).toBeNull();
  });
});

describe('toLegacyCustomerInput', () => {
  it('maps the member row: full name, normalized id + phones, birth date, id-card address', () => {
    const input = toLegacyCustomerInput(
      member({
        member_nickname: ' ทด ',
        member_identity_number: `${NID.slice(0, 1)}-${NID.slice(1, 5)} ${NID.slice(5)}`,
        member_tel: '+66977000001',
        member_tel2: '(097) 700-0002',
        member_birth_date: '1990-05-17',
        member_address: '99/9 หมู่ 1',
        member_districts: '100101',
        member_zipcode: '10000',
      }),
      order(),
    );
    expect(input).toEqual({
      legacyMemberCode: 'TEST-M-501',
      peakContactCode: null,
      overrideCustomerId: null,
      name: 'ทดสอบระบบ สมมุติ',
      nickname: 'ทด',
      nationalId: NID,
      phone: '0977000001',
      phoneInvalid: false,
      phoneSecondary: '0977000002',
      birthDate: new Date(Date.UTC(1990, 4, 17)),
      addressIdCard: '99/9 หมู่ 1 ต.พระบรมมหาราชวัง อ.เขตพระนคร จ.กรุงเทพมหานคร 10200',
      addressCurrent: null,
      addressWork: null,
      lineId: null,
      facebookLink: null,
      occupation: null,
      occupationDetail: null,
      workplace: null,
      salary: null,
    });
  });

  it('takes contact/work address, LINE, Facebook, job and income from the order first', () => {
    const input = toLegacyCustomerInput(
      member({
        contact_address: 'ที่อยู่ติดต่อในทะเบียนสมาชิก',
        member_line: 'line-from-member',
        member_facebook: 'fb-from-member',
        work_place: 'ที่ทำงานในทะเบียนสมาชิก',
        member_monthly_income: '9000',
      }),
      order({
        contact_address: '1/1 ถนนทดสอบ',
        contact_districts: '100101',
        contact_zipcode: '0',
        work_address: '2/2 อาคารทดสอบ',
        work_districts: '0',
        work_zipcode: '15000',
        member_line: 'line-from-order',
        member_facebook: 'https://facebook.com/test.order',
        member_career: 'ค้าขาย',
        work_place: 'ร้านทดสอบ',
        work_position: 'เจ้าของ',
        member_monthly_income: '15000.50',
      }),
    );
    expect(input.addressCurrent).toBe(
      '1/1 ถนนทดสอบ ต.พระบรมมหาราชวัง อ.เขตพระนคร จ.กรุงเทพมหานคร 10200',
    );
    expect(input.addressWork).toBe('2/2 อาคารทดสอบ 15000');
    expect(input.lineId).toBe('line-from-order');
    expect(input.facebookLink).toBe('https://facebook.com/test.order');
    expect(input.occupation).toBe('เจ้าของ');
    expect(input.occupationDetail).toBe('ค้าขาย');
    expect(input.workplace).toBe('ร้านทดสอบ');
    expect(input.salary).toEqual(new Prisma.Decimal('15000.5'));
  });

  it('falls back to the member row when the order has no value (zip/tambon 0 = none)', () => {
    const input = toLegacyCustomerInput(
      member({
        contact_address: '3/3 ซอยทดสอบ',
        contact_districts: '0',
        contact_zipcode: '0',
        member_line: null,
        member_line_id: 'line-id-from-member',
        member_facebook: 'fb-from-member',
        work_place: 'ที่ทำงานสมาชิก',
        member_monthly_income: '9000',
      }),
      order(),
    );
    expect(input.addressCurrent).toBe('3/3 ซอยทดสอบ');
    expect(input.lineId).toBe('line-id-from-member');
    expect(input.facebookLink).toBe('fb-from-member');
    expect(input.workplace).toBe('ที่ทำงานสมาชิก');
    expect(input.salary).toEqual(new Prisma.Decimal('9000'));
  });

  it('falls back to the order snapshot for name, id, phone and birth date', () => {
    const input = toLegacyCustomerInput(
      member({
        member_name: null,
        member_surname: ' ',
        member_identity_number: null,
        member_tel: null,
        member_birth_date: '0000-00-00',
      }),
      order({
        member_name: ' ทดสอบระบบ   จากคำสั่งซื้อ ',
        member_identity_number: NID,
        member_tel: null,
        member_mobile: '0977000003',
        member_birthday: '2533-01-31',
      }),
    );
    expect(input.name).toBe('ทดสอบระบบ จากคำสั่งซื้อ');
    expect(input.nationalId).toBe(NID);
    expect(input.phone).toBe('0977000003');
    // ปี > 2400 = พ.ศ. → ค.ศ.
    expect(input.birthDate).toEqual(new Date(Date.UTC(1990, 0, 31)));
  });

  it('marks a nameless member with the legacy code; bad birth dates and blank phones become null', () => {
    const input = toLegacyCustomerInput(
      member({
        member_name: null,
        member_surname: null,
        member_tel: ' - ',
        member_birth_date: '1990-02-30',
      }),
      order(),
    );
    expect(input.name).toBe('ไม่ระบุชื่อ (ระบบเก่า TEST-M-501)');
    expect(input.phone).toBeNull();
    expect(input.phoneInvalid).toBe(false);
    expect(input.birthDate).toBeNull();
  });

  it('accepts only 0 + 9 digits after normalizing: a 9-digit phone becomes no phone + phoneInvalid', () => {
    const nineDigits = toLegacyCustomerInput(
      member({ member_tel: '036-41 2345', member_tel2: '097-700 0002' }),
      order(),
    );
    expect(nineDigits.phone).toBeNull();
    expect(nineDigits.phoneInvalid).toBe(true);
    expect(nineDigits.phoneSecondary).toBe('0977000002');

    // ช่องแรกผิดรูปแบบแต่สำเนาในคำสั่งซื้อถูก = ใช้ตัวที่ถูก ไม่ติดธง · หลายเบอร์ในช่องเดียว = ผิดรูปแบบ
    const fallback = toLegacyCustomerInput(
      member({ member_tel: '097-700 0001 / 097-700 0009' }),
      order({ member_tel: '0977000003' }),
    );
    expect(fallback).toMatchObject({ phone: '0977000003', phoneInvalid: false });
  });

  it('drops a secondary phone that is invalid or equal to the primary', () => {
    expect(
      toLegacyCustomerInput(member({ member_tel2: '+66977000001' }), order()).phoneSecondary,
    ).toBeNull();
    expect(
      toLegacyCustomerInput(member({ member_tel2: '12345' }), order()).phoneSecondary,
    ).toBeNull();
  });

  it('carries the PEAK contact code (trimmed, blank = null) and the owner override by member code', () => {
    const overrides = new Map([['TEST-M-501', 'customer-id-from-csv']]);
    expect(
      toLegacyCustomerInput(member(), order(), { peakContactCode: ' C00001 ', overrides }),
    ).toMatchObject({ peakContactCode: 'C00001', overrideCustomerId: 'customer-id-from-csv' });
    expect(
      toLegacyCustomerInput(member({ member_code: 'TEST-M-999' }), order(), {
        peakContactCode: '  ',
        overrides,
      }),
    ).toMatchObject({ peakContactCode: null, overrideCustomerId: null });
  });

  it('requires member_code and names only the row id, never a value of the row', () => {
    const message = errorOf(() => toLegacyCustomerInput(member({ member_code: ' ' }), order()));
    expect(message).toContain('bestchoice_member_master');
    expect(message).toContain('member_id=501');
    expect(message).toContain('member_code');
    expect(message).not.toContain('ทดสอบระบบ');
    expect(message).not.toContain(NID);
  });

  it('throws on a column missing from the row (schema drift), naming the column only', () => {
    const row = member();
    delete row.member_tel;
    const message = errorOf(() => toLegacyCustomerInput(row, order()));
    expect(message).toContain('ไม่มีคอลัมน์ member_tel');
    expect(message).not.toContain(NID);
  });
});

describe('parseCustomerOverridesCsv', () => {
  it('reads legacy_member_code → customer_id (any column order, extra columns ignored)', () => {
    const map = parseCustomerOverridesCsv(
      'customer_id,note,legacy_member_code\ncust-a,x,TEST-M-1\n\n cust-b ,y, TEST-M-2 \n',
    );
    expect([...map]).toEqual([
      ['TEST-M-1', 'cust-a'],
      ['TEST-M-2', 'cust-b'],
    ]);
  });

  it('rejects a duplicate member code with both line numbers', () => {
    const message = errorOf(() =>
      parseCustomerOverridesCsv('legacy_member_code,customer_id\nTEST-M-1,a\nTEST-M-1,b\n'),
    );
    expect(message).toContain('บรรทัด 3');
    expect(message).toContain('บรรทัด 2');
  });

  it('rejects an empty customer_id and a missing header', () => {
    expect(
      errorOf(() => parseCustomerOverridesCsv('legacy_member_code,customer_id\nTEST-M-1,\n')),
    ).toContain('บรรทัด 2 ช่อง customer_id — ไม่มีค่า');
    expect(errorOf(() => parseCustomerOverridesCsv('TEST-M-1,cust-a\n'))).toContain(
      'ไม่มีคอลัมน์ legacy_member_code, customer_id',
    );
  });
});
