import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CARRIERS,
  PARCEL_LABEL_FORMAT_KEY,
  buildParcelLabelDraft,
  labelStyles,
  parseThaiAddress,
  readLabelFormat,
  writeLabelFormat,
  type ParcelLabelSources,
} from './parcelLabel';

const sources: ParcelLabelSources = {
  sale: {
    id: 's1',
    saleNumber: 'S-20261022-0001',
    customer: { id: 'c1', name: 'สมหญิง ใจดี', phone: '0811111111' },
    product: { name: 'Apple iPhone 15 Pro Max 256GB ดำ', imeiSerial: '357200606382344', serialNumber: null },
    bundleProducts: [
      { id: 'acc1', name: 'เคสใส' },
      { id: 'acc2', name: 'ฟิล์มกระจก' },
    ],
  },
  customer: {
    prefix: 'นางสาว',
    name: 'สมหญิง ใจดี',
    phone: '0899999999',
    addressCurrent: '99/1 ม.2 ต.ท่าหิน อ.เมืองลพบุรี จ.ลพบุรี 15000',
  },
  company: { nameTh: 'บริษัท เบสท์ช้อยส์โฟน จำกัด', address: '12 ถ.นารายณ์มหาราช ลพบุรี', phone: '036-000000' },
  origin: 'https://app.test',
};

describe('CARRIERS — ลำดับและป้ายตาม mockup', () => {
  it('Flash · Kerry · J&T · ไปรษณีย์', () => {
    expect(CARRIERS).toEqual([
      { code: 'FLASH', label: 'Flash' },
      { code: 'KERRY', label: 'Kerry' },
      { code: 'JT_EXPRESS', label: 'J&T' },
      { code: 'THAILAND_POST', label: 'ไปรษณีย์' },
    ]);
  });
});

describe('parseThaiAddress — ที่อยู่บรรทัดเดียวของลูกค้า', () => {
  it('จังหวัดซ้อนในชื่ออำเภอ (เมืองลพบุรี) → เลือกตัวท้าย ถอด "จ." และรหัสออกจากบรรทัด', () => {
    expect(parseThaiAddress('99/1 ม.2 ต.ท่าหิน อ.เมืองลพบุรี จ.ลพบุรี 15000')).toEqual({
      lines: '99/1 ม.2 ต.ท่าหิน อ.เมืองลพบุรี',
      province: 'ลพบุรี',
      postalCode: '15000',
    });
  });
  it('กทม. → กรุงเทพมหานคร', () => {
    expect(parseThaiAddress('123 ถ.สุขุมวิท แขวงคลองเตย เขตคลองเตย กทม. 10110')).toEqual({
      lines: '123 ถ.สุขุมวิท แขวงคลองเตย เขตคลองเตย',
      province: 'กรุงเทพมหานคร',
      postalCode: '10110',
    });
  });
  it('คำว่า "จังหวัด" นำหน้าก็ถอดได้', () => {
    expect(parseThaiAddress('5 หมู่ 1 จังหวัดเชียงใหม่ 50000').province).toBe('เชียงใหม่');
    expect(parseThaiAddress('5 หมู่ 1 จังหวัดเชียงใหม่ 50000').lines).toBe('5 หมู่ 1');
  });
  it('ไม่มีจังหวัด/รหัส → null และคงบรรทัดเดิม', () => {
    expect(parseThaiAddress('45 หมู่ 3 ต.บางพลี')).toEqual({ lines: '45 หมู่ 3 ต.บางพลี', province: null, postalCode: null });
  });
  it('มีแต่จังหวัดกับรหัส → บรรทัดว่าง', () => {
    expect(parseThaiAddress('ลพบุรี 15000')).toEqual({ lines: '', province: 'ลพบุรี', postalCode: '15000' });
  });
  it('ว่าง / null → ว่างทั้งหมด', () => {
    expect(parseThaiAddress('')).toEqual({ lines: '', province: null, postalCode: null });
    expect(parseThaiAddress(null)).toEqual({ lines: '', province: null, postalCode: null });
  });
});

describe('buildParcelLabelDraft', () => {
  it('เติมผู้รับจากลูกค้า (คำนำหน้า + ชื่อ · เบอร์ของลูกค้าก่อน) · ของในกล่องจากใบขาย · ผู้ส่งจากบริษัท · QR เป็นลิงก์เปิดใบขาย', () => {
    expect(buildParcelLabelDraft(sources)).toEqual({
      saleId: 's1',
      saleNumber: 'S-20261022-0001',
      recipientName: 'นางสาว สมหญิง ใจดี',
      phone: '0899999999',
      addressLines: '99/1 ม.2 ต.ท่าหิน อ.เมืองลพบุรี',
      province: 'ลพบุรี',
      postalCode: '15000',
      carrier: null,
      note: '',
      cod: 'ไม่มี',
      item: { title: 'Apple iPhone 15 Pro Max 256GB ดำ', imei: '357200606382344', extras: ['เคสใส', 'ฟิล์มกระจก'] },
      sender: { name: 'บริษัท เบสท์ช้อยส์โฟน จำกัด', address: '12 ถ.นารายณ์มหาราช ลพบุรี', phone: '036-000000' },
      qrValue: 'https://app.test/sales?saleId=s1',
    });
  });

  it('เบอร์ลูกค้าว่าง → ใช้เบอร์บนใบขาย · ไม่มี IMEI → serial · ไม่มีคำนำหน้า → ชื่ออย่างเดียว', () => {
    const draft = buildParcelLabelDraft({
      ...sources,
      sale: { ...sources.sale, product: { name: 'หูฟัง', imeiSerial: null, serialNumber: 'SN-77' }, bundleProducts: [] },
      customer: { ...sources.customer, prefix: null, phone: null },
    });
    expect(draft.recipientName).toBe('สมหญิง ใจดี');
    expect(draft.phone).toBe('0811111111');
    expect(draft.item).toEqual({ title: 'หูฟัง', imei: 'SN-77', extras: [] });
  });

  it('ไม่มีข้อมูลลูกค้า/บริษัท → ยังได้ draft ที่พิมพ์ได้ (ช่องว่าง ไม่ล้ม)', () => {
    const draft = buildParcelLabelDraft({ ...sources, customer: null, company: null });
    expect(draft.recipientName).toBe('สมหญิง ใจดี');
    expect(draft.phone).toBe('0811111111');
    expect(draft.addressLines).toBe('');
    expect(draft.province).toBe('');
    expect(draft.postalCode).toBe('');
    expect(draft.sender).toEqual({ name: 'BESTCHOICE', address: '', phone: '' });
  });
});

describe('รูปแบบกระดาษ — จำต่อเครื่องใน localStorage (ทนทานเมื่อใช้ไม่ได้)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    try {
      window.localStorage.removeItem(PARCEL_LABEL_FORMAT_KEY);
    } catch {
      /* ignore */
    }
  });

  it('ค่าเริ่มต้น A4 · อ่านค่าที่เก็บได้ · ค่าขยะ → A4', () => {
    expect(readLabelFormat()).toBe('A4');
    writeLabelFormat('LABEL_100x150');
    expect(readLabelFormat()).toBe('LABEL_100x150');
    window.localStorage.setItem(PARCEL_LABEL_FORMAT_KEY, 'junk');
    expect(readLabelFormat()).toBe('A4');
  });

  it('localStorage โยน error → A4 และเขียนไม่ล้ม', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(readLabelFormat()).toBe('A4');
    expect(() => writeLabelFormat('LABEL_100x150')).not.toThrow();
  });
});

describe('labelStyles — @page ตามรูปแบบ', () => {
  it('ฉลาก 100×150 ไม่มีขอบ · A4 มีขอบและเส้นประให้ตัด', () => {
    expect(labelStyles('LABEL_100x150')).toContain('size: 100mm 150mm');
    expect(labelStyles('LABEL_100x150')).toContain('margin: 0');
    expect(labelStyles('A4')).toContain('size: A4');
    expect(labelStyles('A4')).toContain('dashed');
  });
});
