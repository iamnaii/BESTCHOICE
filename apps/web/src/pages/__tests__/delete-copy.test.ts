import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

/**
 * ก้อน 8 A10 — ข้อความกล่องยืนยันลบต้องตรงความจริงหลังมีถังขยะ (สเปก §8):
 * ของที่กู้ได้ห้ามบอกว่า "กู้คืนไม่ได้/ยกเลิกไม่ได้" · ร่างสัญญาที่กู้ไม่ได้ห้ามบอกว่า "กู้คืนได้"
 * (สแกนซอร์สแบบเดียวกับ inventory test ของ NativeSelect — ไม่ต้อง render ทั้งหน้า)
 */
const src = (rel: string) => readFileSync(resolve(__dirname, '..', rel), 'utf8');

describe('delete dialog copy vs trash bin', () => {
  it('D1 ลูกค้า: ชี้ไปถังขยะ ไม่บอกว่ากู้ไม่ได้', () => {
    const s = src('CustomersPage/index.tsx');
    expect(s).toContain('เจ้าของกู้คืนได้จาก ตั้งค่า › ถังขยะ');
    expect(s).not.toContain('ไม่สามารถกู้คืนได้');
  });

  it('D2 สินทรัพย์ (2 จุด): กู้ได้เฉพาะฉบับร่างจากถังขยะ', () => {
    for (const f of ['assets/AssetsListPage.tsx', 'assets/AssetDetailPage.tsx']) {
      const s = src(f);
      expect(s).toContain('เจ้าของกู้คืนได้จากถังขยะ');
      expect(s).not.toContain('ไม่สามารถกู้คืนได้');
    }
  });

  it('D3 รายได้อื่น (ร่าง) / Webhook: ไม่บอกว่ายกเลิกไม่ได้', () => {
    for (const f of ['other-income/OtherIncomeListPage.tsx', 'WebhooksPage.tsx']) {
      const s = src(f);
      expect(s).toContain('เจ้าของกู้คืนได้จากถังขยะ');
      expect(s).not.toContain('การดำเนินการนี้ไม่สามารถยกเลิกได้');
    }
  });

  it('D4 ร่างสัญญา: ลบแล้วกู้คืนไม่ได้ (เงินดาวน์/เครดิตถูกคืนทันที)', () => {
    const s = src('ContractDetailPage.tsx');
    expect(s).toContain('ลบแล้วกู้คืนไม่ได้');
    expect(s).not.toContain('(soft delete, กู้คืนได้)');
  });
});
