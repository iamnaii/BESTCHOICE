import { describe, expect, it } from 'vitest';
import {
  computeBookingTotal,
  describeExpiry,
  isDepositInRange,
  STATUS_LABEL,
  bangkokDayDiff,
  fmtMoneyShort,
  awaitingExpiry,
  bookingActions,
  fmtBangkokTime,
} from '../utils';

// 5 ต.ค. 2569 10:00 เวลาไทย
const NOW = new Date('2026-10-05T03:00:00.000Z').getTime();
/** ใบจองเก็บ expireDate เป็นเที่ยงคืนไทยของวันถัดจากวันสุดท้ายที่ใช้ได้ (`toBangkokExpiryInstant`) */
const validThrough = (date: string) => `${date}T17:00:00.000Z`;
const open = (expireDate: string) => ({
  status: 'PAID' as const,
  expireDate,
  convertedAt: null,
  canceledAt: null,
  depositPaidAt: '2026-10-01T03:00:00Z',
  depositAmount: '5000',
});

describe('computeBookingTotal / isDepositInRange', () => {
  it('รวมยอดปัดทศนิยม 2 ตำแหน่ง', () => {
    expect(
      computeBookingTotal([
        { quantity: 1, unitPrice: 35000 },
        { quantity: 2, unitPrice: 5990 },
      ]),
    ).toBe(46980);
    expect(computeBookingTotal([])).toBe(0);
  });
  it('มัดจำต้องมากกว่า 0 และไม่เกินยอดรวม (คำตัดสิน 2026-10-05)', () => {
    expect(isDepositInRange(0, 1000)).toBe(false);
    expect(isDepositInRange(500, 1000)).toBe(true);
    expect(isDepositInRange(1000, 1000)).toBe(true);
    expect(isDepositInRange(-1, 1000)).toBe(false);
    expect(isDepositInRange(1001, 1000)).toBe(false);
  });
});

describe('STATUS_LABEL', () => {
  it('ครบ 5 สถานะเป็นภาษาไทย', () => {
    expect(STATUS_LABEL).toEqual({
      PENDING_DEPOSIT: 'รอชำระมัดจำ',
      PAID: 'มัดจำแล้ว',
      CANCELED: 'ยกเลิก',
      EXPIRED: 'หมดอายุ',
      CONVERTED: 'ขายแล้ว',
    });
  });
});

describe('describeExpiry — วันคงเหลือตามปฏิทินไทย', () => {
  it('หมดอายุสิ้นวันนี้ → "วันนี้" สีเตือน', () => {
    expect(describeExpiry(open(validThrough('2026-10-05')), NOW)).toMatchObject({
      label: 'วันนี้',
      tone: 'today',
      sub: '5 ต.ค. 69',
    });
  });
  it('พรุ่งนี้ และ อีก 2–3 วัน → tone soon · อีก 6 วัน → normal', () => {
    expect(describeExpiry(open(validThrough('2026-10-06')), NOW)).toMatchObject({
      label: 'พรุ่งนี้',
      tone: 'soon',
    });
    expect(describeExpiry(open(validThrough('2026-10-08')), NOW)).toMatchObject({
      label: 'อีก 3 วัน',
      tone: 'soon',
    });
    expect(describeExpiry(open(validThrough('2026-10-11')), NOW)).toMatchObject({
      label: 'อีก 6 วัน',
      tone: 'normal',
    });
  });
  it('เลยกำหนดแต่ cron ยังไม่ปิด → "หมดอายุแล้ว · รอระบบปิด"', () => {
    expect(describeExpiry(open(validThrough('2026-10-04')), NOW)).toEqual({
      label: 'หมดอายุแล้ว',
      sub: 'รอระบบปิด',
      tone: 'overdue',
    });
    expect(awaitingExpiry(open(validThrough('2026-10-04')), NOW)).toBe(true);
    expect(awaitingExpiry(open(validThrough('2026-10-05')), NOW)).toBe(false);
  });
  it('สถานะปิดแล้วบอกเหตุการณ์แทนวันคงเหลือ', () => {
    expect(
      describeExpiry(
        {
          ...open(validThrough('2026-10-11')),
          status: 'CONVERTED',
          convertedAt: '2026-10-01T07:20:00Z',
        },
        NOW,
      ),
    ).toEqual({ label: 'ขายแล้ว', sub: '1 ต.ค. 69', tone: 'closed' });
    expect(
      describeExpiry(
        {
          ...open(validThrough('2026-10-11')),
          status: 'CANCELED',
          canceledAt: '2026-09-27T05:00:00Z',
        },
        NOW,
      ),
    ).toEqual({ label: 'ยกเลิก', sub: 'คืนมัดจำ 27 ก.ย. 69', tone: 'closed' });
    expect(
      describeExpiry(
        {
          ...open(validThrough('2026-09-27')),
          status: 'CANCELED',
          canceledAt: '2026-09-27T05:00:00Z',
          depositPaidAt: null,
        },
        NOW,
      ),
    ).toEqual({ label: 'ยกเลิก', sub: '27 ก.ย. 69', tone: 'closed' });
    expect(describeExpiry({ ...open(validThrough('2026-09-27')), status: 'EXPIRED' }, NOW)).toEqual(
      { label: 'หมดอายุ', sub: 'ริบมัดจำ 27 ก.ย. 69', tone: 'closed' },
    );
  });
  it('bangkokDayDiff นับวันปฏิทินไทย ไม่ใช่ 24 ชม.', () => {
    // 23:30 ไทย วันนี้ (16:30Z) vs 00:30 ไทย พรุ่งนี้ (17:30Z) = ต่างกัน 1 วัน (นับวันปฏิทินไทย)
    expect(
      bangkokDayDiff('2026-10-05T17:30:00.000Z', new Date('2026-10-05T16:30:00.000Z').getTime()),
    ).toBe(1);
  });
  it('fmtMoneyShort ตัดทศนิยมเมื่อเป็นจำนวนเต็ม', () => {
    expect(fmtMoneyShort('42900.00')).toBe('42,900');
    expect(fmtMoneyShort(1500.5)).toBe('1,500.50');
  });
});

describe('describeExpiry — ตรึงปฏิทินไทยไม่ขึ้นกับ TZ เครื่อง', () => {
  it('เหตุการณ์ปิดที่คาบเส้น 17:00Z แสดงเป็นวันถัดไปตามเวลาไทย', () => {
    expect(
      describeExpiry(
        {
          ...open(validThrough('2026-10-11')),
          status: 'CANCELED',
          canceledAt: '2026-09-27T20:00:00.000Z',
        },
        NOW,
      ),
    ).toEqual({ label: 'ยกเลิก', sub: 'คืนมัดจำ 28 ก.ย. 69', tone: 'closed' });
  });
  it('ขอบวันหมดอายุ: expireDate − 1 ms = วันนี้ · expireDate = รอระบบปิด', () => {
    const expireDate = validThrough('2026-10-05');
    const end = new Date(expireDate).getTime();
    expect(describeExpiry(open(expireDate), end - 1)).toMatchObject({
      label: 'วันนี้',
      tone: 'today',
    });
    expect(describeExpiry(open(expireDate), end)).toMatchObject({ tone: 'overdue' });
    expect(awaitingExpiry(open(expireDate), end - 1)).toBe(false);
    expect(awaitingExpiry(open(expireDate), end)).toBe(true);
  });
  it('รอชำระมัดจำนับเป็นใบเปิด: มีวันคงเหลือและรอระบบปิดเมื่อเลยกำหนด', () => {
    const pending = (expireDate: string) => ({
      ...open(expireDate),
      status: 'PENDING_DEPOSIT' as const,
      depositPaidAt: null,
    });
    expect(describeExpiry(pending(validThrough('2026-10-07')), NOW)).toMatchObject({
      label: 'อีก 2 วัน',
      tone: 'soon',
    });
    expect(awaitingExpiry(pending(validThrough('2026-10-04')), NOW)).toBe(true);
  });
});

describe('fmtBangkokTime', () => {
  it('HH:mm เวลาไทย 24 ชม. ไม่ขึ้นกับ TZ เครื่อง (00:30 ไทย = 17:30Z วันก่อน)', () => {
    expect(fmtBangkokTime('2026-10-05T17:30:00.000Z')).toBe('00:30');
    expect(fmtBangkokTime(new Date('2026-10-05T03:42:00Z').getTime())).toBe('10:42');
    expect(fmtBangkokTime('not-a-date')).toBe('-');
  });
});

describe('bookingActions — เมทริกซ์ปุ่มตามสถานะ (ที่เดียว ใช้ทั้งเมนูแถวและแผง)', () => {
  const mutate = { canMutate: true, canDelete: true };
  const base = (
    status: 'PENDING_DEPOSIT' | 'PAID' | 'CANCELED' | 'EXPIRED' | 'CONVERTED',
    expireDate = '2099-01-01T17:00:00.000Z',
  ) => ({
    status,
    expireDate,
  });
  const NONE = {
    open: true,
    collectDeposit: false,
    convert: false,
    edit: false,
    cancel: false,
    delete: false,
  };

  it('PENDING_DEPOSIT: รับมัดจำ/แก้/ยกเลิก + ลบเมื่อมีสิทธิ์ลบ · ไม่มีแปลงขาย', () => {
    expect(bookingActions(base('PENDING_DEPOSIT') as never, NOW, mutate)).toEqual({
      ...NONE,
      collectDeposit: true,
      edit: true,
      cancel: true,
      delete: true,
    });
    expect(
      bookingActions(base('PENDING_DEPOSIT') as never, NOW, { canMutate: true, canDelete: false }),
    ).toMatchObject({ collectDeposit: true, delete: false });
  });
  it('PAID: แปลงขาย/แก้/ยกเลิก · ไม่มีรับมัดจำ ไม่มีลบ', () => {
    expect(bookingActions(base('PAID') as never, NOW, mutate)).toEqual({
      ...NONE,
      convert: true,
      edit: true,
      cancel: true,
    });
  });
  it.each(['CONVERTED', 'CANCELED', 'EXPIRED'] as const)('%s: เปิดอย่างเดียว', (status) => {
    expect(bookingActions(base(status) as never, NOW, mutate)).toEqual(NONE);
  });
  it.each(['PENDING_DEPOSIT', 'PAID'] as const)(
    '%s เลยกำหนดแต่ cron ยังไม่ปิด: เปิดอย่างเดียว + เหตุผล "รอระบบปิดใบจอง"',
    (status) => {
      expect(
        bookingActions(base(status, '2000-01-01T17:00:00.000Z') as never, NOW, mutate),
      ).toEqual({ ...NONE, reason: 'รอระบบปิดใบจอง' });
    },
  );
  it.each(['PENDING_DEPOSIT', 'PAID', 'CONVERTED', 'CANCELED', 'EXPIRED'] as const)(
    '%s ไม่มีสิทธิ์แก้ไข (canMutate=false): ทุกปุ่มที่เปลี่ยนข้อมูลปิด',
    (status) => {
      expect(
        bookingActions(base(status) as never, NOW, { canMutate: false, canDelete: true }),
      ).toEqual(NONE);
    },
  );
});
