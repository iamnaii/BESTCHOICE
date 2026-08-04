import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useState } from 'react';
import { useContractCalculation } from './useContractCalculation';
import type { Product, InterestConfig } from '../types';

/**
 * GOLDEN — B0 §2.1 red line.
 *
 * getSellingPrice กำลังถูกเปลี่ยนจาก "prices[] label ก่อน" เป็น "คอลัมน์ก่อน".
 * เทสต์ชุด A-E ปักหมุดว่า **ข้อมูลจริงที่มีอยู่ทุกแบบต้องได้เลขเท่าเดิมทุกบาท**
 * (prod วันนี้คอลัมน์เป็น null ทั้งกระดาน → เดินสาย fallback เดิมเป๊ะ)
 * ชุด F-G คือพฤติกรรมใหม่ที่ตั้งใจ (คอลัมน์ชนะเมื่อมีค่า)
 */

const CONFIG = {
  interestRate: '0.015',      // 1.5%/เดือน flat → ratePct(12) = 0.18
  minDownPaymentPct: '0.20',
  storeCommissionPct: '0.10',
  vatPct: '0.07',
  minInstallmentMonths: 6,
  maxInstallmentMonths: 24,
} as unknown as InterestConfig;

const makeProduct = (over: Partial<Product>): Product =>
  ({
    id: 'p1',
    name: 'iPhone 15',
    brand: 'Apple',
    model: '15',
    category: 'PHONE_NEW',
    status: 'IN_STOCK',
    branchId: 'b1',
    branch: { id: 'b1', name: 'สาขาลาดพร้าว' },
    prices: [],
    ...over,
  }) as Product;

function setup(product: Product | null, initialDown = 4000) {
  return renderHook(() => {
    const [downPayment, setDownPayment] = useState(initialDown);
    const [totalMonths, setTotalMonths] = useState(12);
    return useContractCalculation({
      selectedProduct: product,
      interestConfig: CONFIG,
      posConfig: undefined,
      downPayment,
      setDownPayment,
      totalMonths,
      setTotalMonths,
    });
  });
}

describe('useContractCalculation — แหล่งราคา (B0 golden)', () => {
  it('A: คอลัมน์ + label ตรงกัน → 20,000 และเลขปลายทางตรงทุกบาท', () => {
    const { result } = setup(
      makeProduct({
        installmentPrice: '20000',
        prices: [{ id: 'r1', label: 'ราคาผ่อน BESTCHOICE', amount: '20000', isDefault: true }],
      }),
    );
    expect(result.current.sellingPrice).toBe(20000);
    // ดาวน์ 4,000 → ต้น 16,000 / คอม 1,600 / ดอก 2,880 / VAT 1,433.60 / รวม 21,913.60 / งวด 1,826.13
    expect(result.current.principal).toBe(16000);
    expect(result.current.storeCommission).toBe(1600);
    expect(result.current.interestTotal).toBe(2880);
    expect(result.current.vatAmount).toBe(1433.6);
    expect(result.current.financedAmount).toBe(21913.6);
    expect(result.current.monthlyPayment).toBe(1826.13);
  });

  it('B: มีแต่ prices[] label "ราคาผ่อน BESTCHOICE" (คอลัมน์ null) → 20,000 เท่าเดิม', () => {
    const { result } = setup(
      makeProduct({
        cashPrice: null,
        installmentPrice: null,
        prices: [{ id: 'r1', label: 'ราคาผ่อน BESTCHOICE', amount: '20000', isDefault: true }],
      }),
    );
    expect(result.current.sellingPrice).toBe(20000);
    expect(result.current.monthlyPayment).toBe(1826.13);
  });

  it('C: มีแต่ row label "ราคาขาย" ที่ isDefault (PO receive) → ใช้ค่านั้นเหมือนเดิม', () => {
    const { result } = setup(
      makeProduct({
        prices: [{ id: 'r1', label: 'ราคาขาย', amount: '20000', isDefault: true }],
      }),
    );
    expect(result.current.sellingPrice).toBe(20000);
  });

  it('D: ไม่มี label ที่รู้จักและไม่มี isDefault → ใช้ prices[0] เหมือนเดิม', () => {
    const { result } = setup(
      makeProduct({
        prices: [
          { id: 'r1', label: 'ราคาขายต่อ (Refurbished)', amount: '20000', isDefault: false },
          { id: 'r2', label: 'อื่นๆ', amount: '99', isDefault: false },
        ],
      }),
    );
    expect(result.current.sellingPrice).toBe(20000);
  });

  it('E: ไม่มีราคาเลย → 0 และตัวเลขทุกช่องเป็น 0', () => {
    const { result } = setup(makeProduct({ prices: [] }), 0);
    expect(result.current.sellingPrice).toBe(0);
    expect(result.current.monthlyPayment).toBe(0);
  });

  it('F: คอลัมน์ต่างจาก row เดิม → คอลัมน์ชนะ (พฤติกรรมใหม่)', () => {
    const { result } = setup(
      makeProduct({
        installmentPrice: '20000',
        prices: [{ id: 'r1', label: 'ราคาผ่อน BESTCHOICE', amount: '19000', isDefault: true }],
      }),
    );
    expect(result.current.sellingPrice).toBe(20000);
  });

  it('G: มีแต่ cashPrice คอลัมน์ (ไม่มี label ผ่อน) → ใช้ cashPrice (พฤติกรรมใหม่)', () => {
    const { result } = setup(
      makeProduct({
        cashPrice: '20000',
        prices: [{ id: 'r1', label: 'ราคาขาย', amount: '17000', isDefault: true }],
      }),
    );
    expect(result.current.sellingPrice).toBe(20000);
  });

  // H ปักหมุดพฤติกรรมที่ "เปลี่ยนโดยไม่ตั้งใจได้ง่ายที่สุด": ไม่มีคอลัมน์เลย
  // แต่มีแถว label 'ราคาเงินสด' ที่ **ไม่ใช่ isDefault** ควบกับแถว isDefault คนละ label
  //   เดิม: getSellingPrice → ไม่เจอ 'ราคาผ่อน*' → เอาแถว isDefault ('ราคาขาย' 17000)
  //   ใหม่: getDisplayPrices อ่าน label 'ราคาเงินสด' ได้ (20000) → cash ชนะ
  // นี่คือ diff เดียวที่ไม่ได้มาจากคอลัมน์ — ตั้งใจให้เกิด (label ราคาเงินสดตรงกว่า
  // 'ราคาขาย' ซึ่งเป็น label ที่ PO receive สร้างทิ้งไว้) จึงต้องมีเทสต์คุมไว้
  it('H: ไม่มีคอลัมน์ แต่มีแถว label "ราคาเงินสด" (ไม่ default) + แถว isDefault คนละ label → ใช้ราคาเงินสด (พฤติกรรมใหม่)', () => {
    const { result } = setup(
      makeProduct({
        prices: [
          { id: 'r1', label: 'ราคาขาย', amount: '17000', isDefault: true },
          { id: 'r2', label: 'ราคาเงินสด', amount: '20000', isDefault: false },
        ],
      }),
    );
    expect(result.current.sellingPrice).toBe(20000);
  });

  // I ปักหมุด red line ของ batch: คอลัมน์เป็น **0** (ไม่ใช่ null) ต้องไม่ชนะแถวที่มีราคาจริง
  // getDisplayPrices ใช้ Number() + guard `!= null` → 0 เป็นค่า "ไม่ null" จึงหลุด guard แบบ null-check
  // ถ้าเทสต์นี้แดง = เครื่อง 20,000฿ จะทำสัญญาที่ 0฿ (เงินสัญญาเปลี่ยนเงียบ)
  it('I: ราคา 0 ในคอลัมน์ + แถว isDefault ที่มีราคาจริง → ต้องได้ราคาจริง (ไม่ใช่ 0)', () => {
    const { result } = setup(
      makeProduct({
        cashPrice: '0',
        installmentPrice: '0',
        prices: [{ id: 'r1', label: 'ราคาขาย', amount: '17000', isDefault: true }],
      }),
      3400,
    );
    expect(result.current.sellingPrice).toBe(17000);
  });
});
