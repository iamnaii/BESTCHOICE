import { describe, expect, it } from 'vitest';
import { formatDateTime } from '@/utils/formatters';
import type { Product } from './types';
import { describeScanBlock, honorific, isScanCandidate, scanIdLabel, type ScanOutcome } from './scanOutcome';

const CODE = '351000000007919';

const product: Product = {
  id: 'p1',
  name: 'Apple iPhone 15 128GB',
  brand: 'Apple',
  model: 'iPhone 15',
  imeiSerial: CODE,
  legacyProductCode: null,
  category: 'PHONE_NEW',
  costPrice: '0',
  branchId: 'b1',
  branch: { id: 'b1', name: 'ลาดพร้าว' },
  prices: [],
};

function outcome(overrides: Partial<ScanOutcome>): ScanOutcome {
  return {
    code: CODE,
    reason: 'SELLABLE',
    sellable: true,
    product,
    branch: { id: 'b1', name: 'ลาดพร้าว' },
    booking: null,
    contract: null,
    sale: null,
    reservation: null,
    ...overrides,
  };
}

const BLOCK = 'เครื่องนี้ขายไม่ได้ตอนนี้ · ';

describe('isScanCandidate — Enter ไหนคือการยิง', () => {
  it('IMEI / รหัสสินค้า / uuid (ไม่มีช่องว่าง ยาว ≥ 3) = ยิง', () => {
    expect(isScanCandidate(CODE)).toBe(true);
    expect(isScanCandidate('  P-0001 ')).toBe(true);
    expect(isScanCandidate('3f2a9c1e-5b7d-4e8a-9c1b-2d3e4f5a6b7c')).toBe(true);
  });
  it('ชื่อรุ่นที่มีช่องว่าง หรือสั้นเกิน = ไม่ใช่การยิง (รายการค้นหาเดิมทำงานต่อ)', () => {
    expect(isScanCandidate('iPhone 15')).toBe(false);
    expect(isScanCandidate('ab')).toBe(false);
    expect(isScanCandidate('   ')).toBe(false);
  });
});

describe('scanIdLabel — ป้ายรหัสบนแถบเขียว (กติกาเดียวกับสติกเกอร์)', () => {
  it('IMEI ก่อน → รหัสเดิม → ID 8 ตัวแรก', () => {
    expect(scanIdLabel(product)).toEqual({ label: 'IMEI', text: CODE });
    expect(scanIdLabel({ ...product, imeiSerial: null, legacyProductCode: 'P-0001' })).toEqual({ label: 'รหัส', text: 'P-0001' });
    expect(scanIdLabel({ id: '3f2a9c1e-5b7d-4e8a', imeiSerial: null, legacyProductCode: null })).toEqual({
      label: 'ID',
      text: '3f2a9c1e',
    });
  });
});

describe('honorific', () => {
  it('เติม "คุณ" เฉพาะชื่อที่ยังไม่มีคำนำหน้า', () => {
    expect(honorific('สมหญิง')).toBe('คุณสมหญิง');
    expect(honorific('นายสมชาย')).toBe('นายสมชาย');
    expect(honorific('นางสาวแดง')).toBe('นางสาวแดง');
    expect(honorific('คุณแดง')).toBe('คุณแดง');
    expect(honorific('  นาง ดำ ')).toBe('นาง ดำ');
  });
});

describe('describeScanBlock — ข้อความแถบแดงต่อเหตุผล', () => {
  it('NOT_FOUND / DELETED ไม่มีคำนำ "ขายไม่ได้" และไม่มีลิงก์', () => {
    expect(describeScanBlock(outcome({ reason: 'NOT_FOUND', sellable: false, product: null, branch: null }))).toEqual({
      title: `ไม่พบรหัส “${CODE}” ในระบบ`,
      detail: 'ถ้าพิมพ์ชื่อรุ่น ให้เลือกจากรายการด้านล่าง · ถ้ายิงจากสติกเกอร์ ลองยิงใหม่อีกครั้ง',
      link: null,
    });
    expect(describeScanBlock(outcome({ reason: 'DELETED', sellable: false, product: null, branch: null }))).toEqual({
      title: `เครื่องรหัส ${CODE} ถูกลบออกจากระบบแล้ว`,
      detail: 'ถ้าเครื่องยังอยู่จริง ให้ผู้จัดการตรวจสอบก่อนขาย',
      link: null,
    });
  });

  it('OTHER_BRANCH บอกชื่อสาขา — ไม่มีลิงก์ (SALES/BM เปิดคลังของสาขาอื่นไม่ได้ · โอนเครื่องเป็นงานผู้จัดการ)', () => {
    expect(
      describeScanBlock(outcome({ reason: 'OTHER_BRANCH', sellable: false, branch: { id: 'b2', name: 'สำนักงานใหญ่' } })),
    ).toEqual({
      title: `${BLOCK}อยู่สาขาอื่น`,
      detail: 'เครื่องอยู่ที่ สำนักงานใหญ่ — ให้ผู้จัดการโอนมาสาขานี้ก่อน',
      link: null,
    });
  });

  it('BOOKED บอกใบจอง ชื่อลูกค้า วันหมดอายุ + ลิงก์เปิดใบจอง', () => {
    expect(
      describeScanBlock(
        outcome({
          reason: 'BOOKED',
          sellable: false,
          booking: { id: 'bk1', bookingNumber: 'BK-20261020-0003', customerName: 'สมหญิง', expireDate: '2026-10-25T12:00:00.000Z' },
        }),
      ),
    ).toEqual({
      title: `${BLOCK}จองไว้แล้ว`,
      detail: 'ใบจอง BK-20261020-0003 ของคุณสมหญิง หมดอายุ 25 ต.ค.',
      link: { label: 'เปิดใบจอง BK-20261020-0003', to: '/bookings?bookingId=bk1' },
    });
  });

  it('DRAFT_CONTRACT / ON_CONTRACT ชี้ไปหน้าสัญญา', () => {
    const contract = { id: 'ct1', contractNumber: 'CT-20261022-0001', customerName: 'นายสมชาย', status: 'DRAFT' };
    expect(describeScanBlock(outcome({ reason: 'DRAFT_CONTRACT', sellable: false, contract }))).toEqual({
      title: `${BLOCK}ติดร่างสัญญา`,
      detail: 'ร่างสัญญา CT-20261022-0001 ของนายสมชาย',
      link: { label: 'เปิดร่างสัญญา CT-20261022-0001', to: '/contracts/ct1' },
    });
    expect(
      describeScanBlock(outcome({ reason: 'ON_CONTRACT', sellable: false, contract: { ...contract, status: 'ACTIVE' } })),
    ).toEqual({
      title: `${BLOCK}ติดสัญญาผ่อน`,
      detail: 'สัญญา CT-20261022-0001 ของนายสมชาย',
      link: { label: 'เปิดสัญญา CT-20261022-0001', to: '/contracts/ct1' },
    });
  });

  it('WEB_RESERVED บอกเวลาหมดจอง · RESERVED ไม่ทราบเจ้าของ', () => {
    const expiresAt = '2026-10-22T10:30:00.000Z';
    expect(describeScanBlock(outcome({ reason: 'WEB_RESERVED', sellable: false, reservation: { expiresAt } }))).toEqual({
      title: `${BLOCK}ลูกค้าจองผ่านเว็บ`,
      detail: `หมดเวลาจอง ${formatDateTime(expiresAt)}`,
      link: { label: 'ดูในคลังสินค้า', to: `/stock/products?view=all&q=${CODE}` },
    });
    expect(describeScanBlock(outcome({ reason: 'RESERVED', sellable: false }))).toEqual({
      title: `${BLOCK}ติดจอง`,
      detail: 'ระบบไม่พบว่าใครถือเครื่องนี้ — ให้ผู้จัดการตรวจสถานะในคลังสินค้า',
      link: { label: 'ดูในคลังสินค้า', to: `/stock/products?view=all&q=${CODE}` },
    });
  });

  it('SOLD มีใบขาย → เลขใบ ชื่อลูกค้า วันที่ + ลิงก์ · ไม่มีใบขาย → บอกตรง ๆ ไม่มีลิงก์', () => {
    expect(
      describeScanBlock(
        outcome({
          reason: 'SOLD',
          sellable: false,
          sale: { id: 's1', saleNumber: 'S-20261020-0001', customerName: 'สมปอง', soldAt: '2026-10-20T12:00:00.000Z' },
        }),
      ),
    ).toEqual({
      title: `${BLOCK}ขายไปแล้ว`,
      detail: 'ใบขาย S-20261020-0001 ของคุณสมปอง เมื่อ 20 ต.ค.',
      link: { label: 'เปิดใบขาย S-20261020-0001', to: '/sales?saleId=s1' },
    });
    expect(describeScanBlock(outcome({ reason: 'SOLD', sellable: false }))).toEqual({
      title: `${BLOCK}ขายไปแล้ว`,
      detail: 'ไม่พบใบขายของเครื่องนี้ — ให้ผู้จัดการตรวจประวัติการขาย',
      link: null,
    });
  });

  it('NOT_READY ใช้ป้ายสถานะของเว็บ · สถานะที่ยังไม่มีป้ายแสดงรหัสดิบ ไม่ล้ม', () => {
    expect(
      describeScanBlock(outcome({ reason: 'NOT_READY', sellable: false, product: { ...product, status: 'PHOTO_PENDING' } as Product })),
    ).toEqual({
      title: `${BLOCK}รอถ่ายรูป`,
      detail: 'เครื่องยังไม่ผ่านขั้นตอนเข้าคลัง — ต้องเป็น “พร้อมขาย” ก่อนจึงขายได้',
      link: { label: 'ดูในคลังสินค้า', to: `/stock/products?view=all&q=${CODE}` },
    });
    expect(
      describeScanBlock(outcome({ reason: 'NOT_READY', sellable: false, product: { ...product, status: 'FUTURE_STATUS' } as Product }))
        .title,
    ).toBe(`${BLOCK}FUTURE_STATUS`);
  });

  it('รหัสที่มีอักขระพิเศษถูก encode ในลิงก์คลังสินค้า (หน้ารายการสินค้า มุมมอง "ทั้งหมด" ถึงจะเห็นเครื่องที่ไม่พร้อมขาย)', () => {
    expect(describeScanBlock(outcome({ code: 'P 1/2', reason: 'RESERVED', sellable: false })).link?.to).toBe(
      '/stock/products?view=all&q=P%201%2F2',
    );
  });

  it('reason ที่เว็บยังไม่รู้จัก (แท็บเก่าข้าม deploy) → แสดงรหัสเหตุผลดิบ ไม่ล้มทั้งหน้าขาย', () => {
    expect(describeScanBlock(outcome({ reason: 'SOMETHING_NEW' as ScanOutcome['reason'], sellable: false }))).toEqual({
      title: `${BLOCK}SOMETHING_NEW`,
      detail: null,
      link: null,
    });
  });
});
