import { describe, expect, it } from 'vitest';
import { overdueContracts, paymentSearchFor } from '../utils/paymentTarget';
import { progress } from './fixtures';

// API ส่ง openContracts เรียงใบใหม่สุดก่อน (createdAt desc) — ใบค้างนานสุดจึงมักอยู่ท้าย
const newerLate = progress({ id: 'k1', contractNumber: 'CT-NEW', firstOverdueInstallmentNo: 2, firstOverdueDueDate: '2026-09-05T00:00:00.000Z' });
const olderLate = progress({ id: 'k2', contractNumber: 'CT-OLD', firstOverdueInstallmentNo: 5, firstOverdueDueDate: '2026-06-05T00:00:00.000Z' });
const onTime = progress({ id: 'k3', contractNumber: 'CT-OK', overdueInstallments: 0, overdueAmount: 0, firstOverdueInstallmentNo: null, firstOverdueDueDate: null });

describe('overdueContracts', () => {
  it('เอาเฉพาะใบที่มีงวดค้าง เรียงจากงวดค้างงวดแรกเก่าสุดก่อน', () => {
    expect(overdueContracts([onTime, newerLate, olderLate]).map((k) => k.contractNumber)).toEqual(['CT-OLD', 'CT-NEW']);
  });
  it('ไม่มีใบค้าง → ว่าง', () => {
    expect(overdueContracts([onTime])).toEqual([]);
  });
});

describe('paymentSearchFor', () => {
  it('ค้าง 1 สัญญา → เลขสัญญานั้น (แม้มีเบอร์และมีใบอื่นที่ไม่ค้าง)', () => {
    expect(paymentSearchFor({ phone: '0812345678', openContracts: [onTime, newerLate] })).toBe('CT-NEW');
  });
  it('ค้างหลายสัญญา + มีเบอร์ → เบอร์ลูกค้า (หน้ารับชำระค้นเบอร์ได้ เห็นทุกใบ)', () => {
    expect(paymentSearchFor({ phone: '0812345678', openContracts: [newerLate, olderLate] })).toBe('0812345678');
  });
  it('ค้างหลายสัญญา + ไม่มีเบอร์ → เลขสัญญาที่ค้างนานสุด', () => {
    expect(paymentSearchFor({ phone: null, openContracts: [newerLate, olderLate] })).toBe('CT-OLD');
  });
  it('ไม่มีงวดค้าง → เลขสัญญาที่กำลังผ่อนใบแรก', () => {
    expect(paymentSearchFor({ phone: '0812345678', openContracts: [onTime, progress({ id: 'k4', contractNumber: 'CT-OK2', overdueInstallments: 0 })] })).toBe('CT-OK');
  });
  it('ไม่มีสัญญาเปิด → null', () => {
    expect(paymentSearchFor({ phone: '0812345678', openContracts: [] })).toBeNull();
  });
});
