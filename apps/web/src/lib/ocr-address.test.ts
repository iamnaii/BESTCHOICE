import { describe, expect, it } from 'vitest';
import { parseOcrAddress, serializeOcrAddress } from './ocr-address';

const form = { keepAreaPrefixes: true, unparsed: 'raw' } as const;
const document = { keepAreaPrefixes: false, unparsed: 'json' } as const;
const empty = {
  houseNo: '',
  moo: '',
  village: '',
  soi: '',
  road: '',
  province: '',
  district: '',
  subdistrict: '',
  postalCode: '',
};

describe('OCR address compatibility', () => {
  it.each([
    [
      '12/3 หมู่ 4 หมู่บ้านสุข ซอยดี ถนนหลัก ตำบลบางรัก อำเภอเมือง จังหวัดนนทบุรี 11000',
      'ตำบลบางรัก',
      'อำเภอเมือง',
      'บางรัก',
      'เมือง',
    ],
    [
      '12/3 ม.4 ม.บ.สุข ซ.ดี ถ.หลัก ต.บางรัก อ.เมือง จ.นนทบุรี 11000',
      'ต.บางรัก',
      'อ.เมือง',
      'บางรัก',
      'เมือง',
    ],
    ['12/3 แขวงบางรัก เขตบางรัก 10500', 'แขวงบางรัก', 'เขตบางรัก', 'บางรัก', 'บางรัก'],
  ])(
    'retains caller-specific area prefixes for %s',
    (raw, formSub, formDistrict, docSub, docDistrict) => {
      expect(parseOcrAddress(raw, true)).toMatchObject({
        houseNo: '12/3',
        subdistrict: formSub,
        district: formDistrict,
      });
      expect(parseOcrAddress(raw, false)).toMatchObject({
        houseNo: '12/3',
        subdistrict: docSub,
        district: docDistrict,
      });
    },
  );

  it('keeps all extracted fields and serialized field order', () => {
    const address =
      '12/3 หมู่ 4 หมู่บ้านสุข ซอยดี ถนนหลัก ตำบลบางรัก อำเภอเมือง จังหวัดนนทบุรี 11000';
    expect(serializeOcrAddress({ address, addressStructured: null }, form)).toBe(
      JSON.stringify({
        houseNo: '12/3',
        moo: '4',
        village: 'สุข',
        soi: 'ดี',
        road: 'หลัก',
        province: 'นนทบุรี',
        district: 'อำเภอเมือง',
        subdistrict: 'ตำบลบางรัก',
        postalCode: '11000',
      }),
    );
  });

  it('prefers populated structured data without reparsing or stripping prefixes', () => {
    const structured = { ...empty, district: 'อ.เดิม' };
    for (const options of [form, document])
      expect(
        serializeOcrAddress({ addressStructured: structured, address: 'อ.ใหม่' }, options),
      ).toBe(JSON.stringify(structured));
  });

  it('falls back from empty structured data to raw-address parsing', () => {
    expect(serializeOcrAddress({ addressStructured: empty, address: '99 ถนนสุข' }, document)).toBe(
      JSON.stringify({ ...empty, houseNo: '99', road: 'สุข' }),
    );
  });

  it.each([null, ''])('omits missing address %s', (address) => {
    for (const options of [form, document])
      expect(serializeOcrAddress({ address, addressStructured: null }, options)).toBeUndefined();
  });

  it('retains different unparsed-address formats for forms and document updates', () => {
    const address = 'ข้อความที่แยกไม่ได้';
    expect(parseOcrAddress(address, true)).toEqual(empty);
    expect(serializeOcrAddress({ address, addressStructured: null }, form)).toBe(address);
    expect(serializeOcrAddress({ address, addressStructured: null }, document)).toBe(
      JSON.stringify({ ...empty, raw: address }),
    );
  });
});
