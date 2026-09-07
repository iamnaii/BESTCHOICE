import { describe, it, expect } from 'vitest';
import type { ReceivingUnitForm } from './types';
import {
  buildScreens,
  receivingBlockers,
  screenState,
  setGroupReceived,
  tally,
  unitHint,
  unitState,
  unitTitle,
  withPriceDefaults,
} from './receiving-flow.util';

const unit = (over: Partial<ReceivingUnitForm> = {}): ReceivingUnitForm => ({
  poItemId: 'line-1',
  label: 'Apple iPhone 17 Pro Deep Blue 256GB #1',
  category: 'PHONE_NEW',
  brand: 'Apple',
  model: 'iPhone 17 Pro',
  color: 'Deep Blue',
  storage: '256GB',
  imeiSerial: '',
  serialNumber: '',
  status: '',
  rejectReason: '',
  defectReason: '',
  batteryHealth: '',
  warrantyExpired: false,
  warrantyExpireDate: '',
  hasBox: true,
  checklist: [],
  sellingPrice: '',
  installmentPrice: '',
  photos: [],
  costPrice: '42900',
  ...over,
});
const done = (over: Partial<ReceivingUnitForm> = {}) =>
  unit({ imeiSerial: '356000000090601', serialNumber: 'QASN0906A', status: 'PASS', sellingPrice: '45900', installmentPrice: '49900', ...over });
const accessory = (over: Partial<ReceivingUnitForm> = {}) =>
  unit({ poItemId: 'line-3', label: 'เคส Spigen สำหรับ iPhone 17 Pro #1', category: 'ACCESSORY', accessoryType: 'เคส', accessoryBrand: 'Spigen', model: 'iPhone 17 Pro', status: 'PASS', sellingPrice: '590', ...over });

describe('buildScreens', () => {
  it('gives every phone its own screen and folds an accessory line into one counted screen', () => {
    const screens = buildScreens([unit(), unit(), accessory(), accessory(), accessory({ poItemId: 'line-4' })]);
    expect(screens).toEqual([
      { kind: 'unit', idx: 0 },
      { kind: 'unit', idx: 1 },
      { kind: 'group', key: 'line-3', indices: [2, 3] },
      { kind: 'group', key: 'line-4', indices: [4] },
    ]);
  });
});

describe('unitHint — what the next button still waits for, in screen order', () => {
  it('walks IMEI → serial → result → prices on a new phone', () => {
    expect(unitHint(unit())).toBe('กรอก IMEI และซีเรียลให้ครบก่อน');
    expect(unitHint(unit({ imeiSerial: '1' }))).toBe('กรอกหมายเลขซีเรียลก่อน');
    expect(unitHint(unit({ serialNumber: 'S' }))).toBe('กรอก IMEI ก่อน');
    expect(unitHint(unit({ imeiSerial: '1', serialNumber: 'S' }))).toBe('เลือกผลตรวจ ผ่าน หรือ ไม่ผ่าน');
    expect(unitHint(unit({ imeiSerial: '1', serialNumber: 'S', status: 'PASS' }))).toBe('กรอกราคาเงินสดก่อน');
    expect(unitHint(unit({ imeiSerial: '1', serialNumber: 'S', status: 'PASS', sellingPrice: '45900' }))).toBe('กรอกราคาผ่อนก่อน');
    expect(unitHint(done())).toBeNull();
  });

  it('a rejected phone only needs its reason', () => {
    expect(unitHint(unit({ imeiSerial: '1', serialNumber: 'S', status: 'REJECT' }))).toBe('เลือกสาเหตุที่ไม่ผ่านก่อน');
    expect(unitHint(unit({ imeiSerial: '1', serialNumber: 'S', status: 'REJECT', defectReason: 'SCREEN' }))).toBeNull();
  });

  it('a used phone must carry battery % (0–100) and a warranty answer before its prices', () => {
    const used = (over: Partial<ReceivingUnitForm>) => done({ category: 'PHONE_USED', ...over });
    expect(unitHint(used({}))).toBe('กรอก % แบตเตอรี่ก่อน');
    expect(unitHint(used({ batteryHealth: '120' }))).toBe('% แบตเตอรี่ต้องอยู่ระหว่าง 0–100');
    expect(unitHint(used({ batteryHealth: '89' }))).toBe('กรอกวันหมดประกันหรือติ๊กหมดประกันแล้ว');
    expect(unitHint(used({ batteryHealth: '89', warrantyExpired: true }))).toBeNull();
    expect(unitHint(used({ batteryHealth: '89', warrantyExpireDate: '2027-03-12', sellingPrice: '' }))).toBe('กรอกราคาเงินสดก่อน');
  });

  it('an accessory sells at one price and never needs IMEI or serial', () => {
    expect(unitHint(accessory({ sellingPrice: '' }))).toBe('กรอกราคาเงินสดก่อน');
    expect(unitHint(accessory())).toBeNull();
    expect(unitHint(accessory({ status: 'REJECT' }))).toBe('เลือกสาเหตุที่ไม่ผ่านก่อน');
  });
});

describe('unitState / screenState / tally', () => {
  it('maps undecided or incomplete → todo, complete PASS → done, complete REJECT → reject', () => {
    expect(unitState(unit())).toBe('todo');
    expect(unitState(done())).toBe('done');
    expect(unitState(done({ status: 'REJECT', defectReason: 'DOA' }))).toBe('reject');
    expect(unitState(done({ status: 'REJECT' }))).toBe('todo');
  });

  it('an accessory group counts as rejected only when every piece failed', () => {
    const units = [accessory(), accessory({ status: 'REJECT', defectReason: 'COSMETIC' })];
    const [group] = buildScreens(units);
    expect(screenState(units, group)).toBe('done');
    expect(screenState([units[1], units[1]], group)).toBe('reject');
  });

  it('tallies passed / rejected / pending', () => {
    expect(tally([done(), done({ status: 'REJECT', defectReason: 'DOA' }), unit()])).toEqual({ passed: 1, rejected: 1, pending: 1 });
  });
});

describe('setGroupReceived', () => {
  it('passes the first n pieces of the group and rejects the rest', () => {
    const units = [unit(), accessory(), accessory(), accessory()];
    const next = setGroupReceived(units, [1, 2, 3], 2);
    expect(next.map((u) => u.status)).toEqual(['', 'PASS', 'PASS', 'REJECT']);
    expect(next[0]).toBe(units[0]);
  });
});

describe('withPriceDefaults', () => {
  it('copies the prices keyed in on an earlier device of the same line onto a blank one', () => {
    const units = [done(), unit({ label: '#2' }), unit({ poItemId: 'line-2', label: 'other' })];
    const next = withPriceDefaults(units, 1);
    expect(next[1]).toMatchObject({ sellingPrice: '45900', installmentPrice: '49900' });
    expect(withPriceDefaults(units, 2)).toBe(units);
  });

  it('keeps a price the user already typed', () => {
    const units = [done(), unit({ sellingPrice: '44000' })];
    expect(withPriceDefaults(units, 1)[1]).toMatchObject({ sellingPrice: '44000', installmentPrice: '49900' });
  });
});

describe('receivingBlockers', () => {
  it('lists every incomplete unit and duplicate IMEIs, in unit order', () => {
    const units = [done(), done({ label: '#2' }), unit({ poItemId: 'line-2' })];
    expect(receivingBlockers(units)).toEqual([
      { idx: 0, message: 'IMEI ซ้ำกับเครื่องอื่นในรายการนี้' },
      { idx: 1, message: 'IMEI ซ้ำกับเครื่องอื่นในรายการนี้' },
      { idx: 2, message: 'กรอก IMEI และซีเรียลให้ครบก่อน' },
    ]);
    expect(receivingBlockers([done(), done({ imeiSerial: '356000000090602' })])).toEqual([]);
  });
});

describe('unitTitle', () => {
  it('names a phone by model + brand and an accessory by type + brand with its model', () => {
    expect(unitTitle(unit())).toEqual({ title: 'iPhone 17 Pro', subtitle: 'Apple' });
    expect(unitTitle(accessory())).toEqual({ title: 'เคส Spigen', subtitle: 'อุปกรณ์เสริม · สำหรับรุ่น iPhone 17 Pro' });
    expect(unitTitle(accessory({ accessoryType: 'ชุดชาร์จ', accessoryBrand: 'Apple', model: '20W USB-C' }))).toEqual({ title: 'ชุดชาร์จ Apple', subtitle: 'อุปกรณ์เสริม · 20W USB-C' });
  });

  it('falls back to the wizard row name for an accessory re-ordered from an existing SKU', () => {
    expect(unitTitle(accessory({ poItemId: '', label: 'ฟิล์มกระจก iPhone 16 - iStar #1', accessoryType: 'F1601', accessoryBrand: 'iStar', model: 'ฟิล์มกระจก iPhone 16 - iStar' })))
      .toEqual({ title: 'ฟิล์มกระจก iPhone 16 - iStar', subtitle: 'อุปกรณ์เสริม' });
  });
});
