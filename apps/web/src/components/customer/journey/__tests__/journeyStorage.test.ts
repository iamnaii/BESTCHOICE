import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JourneyRecordableTouchChannel } from '@installment/shared';
import { isHeardFromSkipped, markHeardFromSkipped, readLastChannel, writeLastChannel } from '../journeyStorage';

/** 🔴 hook ของ vitest ห้าม return ค่า — คร่อมปีกกาเสมอ */
const LAST_CHANNEL_KEY = 'customerJourney.lastChannel.v1';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('readLastChannel / writeLastChannel', () => {
  it('ยังไม่เคยจำ → null (ตัวเลือกไม่เลือกช่องทางใดไว้ก่อน)', () => {
    expect(readLastChannel()).toBeNull();
  });

  it('จำช่องทางใต้คีย์ v1 เป็นข้อความดิบ แล้วอ่านกลับได้', () => {
    writeLastChannel('LINE_APP');
    expect(localStorage.getItem(LAST_CHANNEL_KEY)).toBe('LINE_APP');
    expect(readLastChannel()).toBe('LINE_APP');
  });

  it.each(['OTHER', 'SMS', '', '"PHONE"', 'phone'])('ค่าในที่เก็บที่ไม่ใช่ 4 ช่องทาง (%s) → null', (raw) => {
    localStorage.setItem(LAST_CHANNEL_KEY, raw);
    expect(readLastChannel()).toBeNull();
  });

  it('ไม่เขียนค่าที่ไม่ใช่ 4 ช่องทาง (OTHER ไม่มีชิปให้เลือก)', () => {
    writeLastChannel('OTHER' as JourneyRecordableTouchChannel);
    expect(localStorage.getItem(LAST_CHANNEL_KEY)).toBeNull();
  });

  it('ที่เก็บโยน error ตอนอ่าน/เขียน (โหมดส่วนตัว · เต็ม) → อ่านได้ null และไม่โยนต่อ', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    expect(readLastChannel()).toBeNull();
    expect(() => writeLastChannel('PHONE')).not.toThrow();
  });
});

describe('isHeardFromSkipped / markHeardFromSkipped', () => {
  it('ข้ามแยกต่อลูกค้า เก็บใน sessionStorage (มาหน้าใหม่รอบหน้าขึ้นอีก)', () => {
    expect(isHeardFromSkipped('c1')).toBe(false);
    markHeardFromSkipped('c1');
    expect(isHeardFromSkipped('c1')).toBe(true);
    expect(isHeardFromSkipped('c2')).toBe(false);
    expect(sessionStorage.getItem('customerJourney.heardFromSkipped.v1:c1')).toBe('1');
    expect(localStorage.length).toBe(0);
  });

  it('sessionStorage โยน error → ถือว่ายังไม่ข้าม และไม่โยนต่อ', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => markHeardFromSkipped('c1')).not.toThrow();
    expect(isHeardFromSkipped('c1')).toBe(false);
  });
});
