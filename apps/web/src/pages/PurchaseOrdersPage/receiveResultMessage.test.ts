import { describe, it, expect } from 'vitest';
import { buildReceiveResultMessage } from './receiveResultMessage';

const p = (status: string) => ({ status });

describe('buildReceiveResultMessage', () => {
  it('ของใหม่ล้วน — บอกว่าเข้าคลังพร้อมขาย ไม่ใช่ "รอ QC"', () => {
    const msg = buildReceiveResultMessage({
      passed: 3,
      rejected: 0,
      mainWarehouse: 'คลังกลาง',
      products: [p('IN_STOCK'), p('IN_STOCK'), p('IN_STOCK')],
    });
    expect(msg).toBe('รับ+ตรวจสำเร็จ: ผ่าน 3 ชิ้น → เข้าคลัง คลังกลาง พร้อมขาย');
    expect(msg).not.toContain('QC');
  });

  it('มือสองล้วน — บอกว่าต้องถ่ายรูปก่อนขึ้นขาย', () => {
    const msg = buildReceiveResultMessage({
      passed: 2,
      rejected: 0,
      mainWarehouse: 'คลังกลาง',
      products: [p('PHOTO_PENDING'), p('PHOTO_PENDING')],
    });
    expect(msg).toBe(
      'รับ+ตรวจสำเร็จ: ผ่าน 2 ชิ้น → เข้าคลัง คลังกลาง แล้ว รอถ่ายรูป 6 มุมก่อนขึ้นขาย',
    );
  });

  it('คละกัน — แยกจำนวนสองฝั่งให้เห็น', () => {
    expect(
      buildReceiveResultMessage({
        passed: 3,
        rejected: 1,
        mainWarehouse: 'คลังกลาง',
        products: [p('IN_STOCK'), p('IN_STOCK'), p('PHOTO_PENDING')],
      }),
    ).toBe(
      'รับ+ตรวจสำเร็จ: ผ่าน 3 ชิ้น, ไม่ผ่าน 1 ชิ้น → เข้าคลัง คลังกลาง: พร้อมขาย 2 ชิ้น, รอถ่ายรูป 1 ชิ้น',
    );
  });

  it('ตกทุกชิ้น — ห้ามอ้างว่ามีของเข้าคลัง', () => {
    const msg = buildReceiveResultMessage({
      passed: 0,
      rejected: 2,
      mainWarehouse: 'คลังกลาง',
      products: [],
    });
    expect(msg).toBe('รับ+ตรวจสำเร็จ: ผ่าน 0 ชิ้น, ไม่ผ่าน 2 ชิ้น');
    expect(msg).not.toContain('เข้าคลัง');
  });

  it('API ไม่ส่ง products มา — ไม่เดาปลายทาง', () => {
    expect(buildReceiveResultMessage({ passed: 1, rejected: 0, mainWarehouse: 'คลังกลาง' })).toBe(
      'รับ+ตรวจสำเร็จ: ผ่าน 1 ชิ้น',
    );
  });

  it('รับเข้าตรง — ขึ้นต้นด้วยเลข PO ที่ระบบออกให้', () => {
    expect(
      buildReceiveResultMessage({
        passed: 1,
        rejected: 0,
        mainWarehouse: 'คลังกลาง',
        products: [p('IN_STOCK')],
        poNumber: 'PO-20260827-0005',
      }),
    ).toBe('รับเข้าตรงสำเร็จ (PO-20260827-0005): ผ่าน 1 ชิ้น → เข้าคลัง คลังกลาง พร้อมขาย');
  });
});
