import { describe, it, expect, vi } from 'vitest';
import { ImportBatchError } from '@/utils/excel-cell.util';
import {
  PRICING_HEADER,
  PRICING_IMPORT_HEADERS,
  buildPricingImportReview,
  parsePricingRow,
  sendPricingImport,
  type ExistingPricingTemplate,
  type PricingImportItem,
} from './pricingTemplateImport';

const row = (over: Record<string, unknown> = {}) => ({
  'ยี่ห้อ': 'Apple',
  'รุ่น': 'iPhone 17 Pro',
  'ความจุ': '256GB',
  'เครื่องไทย/นอก': null,
  'ประเภท': 'มือ 1',
  'ประกัน': null,
  'ราคาเงินสด': 39000,
  'ราคาผ่อน BESTCHOICE (ราคาเต็ม)': 39000,
  'ราคาขาย GFIN (ราคาเต็ม)': 39000,
  'งวดเรท 1': 12,
  'ดาวน์เรท 1': 15000,
  'งวดเรท 2': null,
  ...over,
});

const existing = (over: Partial<ExistingPricingTemplate> = {}): ExistingPricingTemplate => ({
  id: 't1',
  brand: 'Apple',
  model: 'iPhone 17 Pro',
  storage: '256GB',
  category: 'PHONE_NEW',
  hasWarranty: false,
  deviceOrigin: 'UNSPECIFIED',
  cashPrice: '39000.00',
  installmentBestchoicePrice: '39000.00',
  installmentFinancePrice: '39000.00',
  rate1DownPayment: '15000.00',
  rate1TermMonths: 12,
  rate2TermMonths: null,
  ...over,
});

describe('หัวคอลัมน์', () => {
  it('ลำดับในแบบฟอร์มครบทุกช่อง', () => {
    expect([...PRICING_IMPORT_HEADERS]).toEqual(Object.values(PRICING_HEADER));
    expect(PRICING_IMPORT_HEADERS).toHaveLength(12);
  });
});

describe('parsePricingRow', () => {
  it('แถวครบ → รายการพร้อมงวด/ดาวน์ · ช่องว่าง = null · ที่มาเครื่องว่าง = ไม่ระบุ', () => {
    expect(parsePricingRow(row())).toEqual({
      label: 'Apple iPhone 17 Pro 256GB มือ 1',
      item: {
        brand: 'Apple',
        model: 'iPhone 17 Pro',
        storage: '256GB',
        deviceOrigin: 'UNSPECIFIED',
        category: 'PHONE_NEW',
        hasWarranty: false,
        cashPrice: 39000,
        installmentBestchoicePrice: 39000,
        installmentFinancePrice: 39000,
        rate1TermMonths: 12,
        rate1DownPayment: 15000,
        rate2TermMonths: null,
      },
    });
  });

  it('อ่านหัวคอลัมน์แบบฟอร์มเก่าได้', () => {
    const legacy: Record<string, unknown> = { ...row(), 'ราคาผ่อน BESTCHOICE': 31000, 'ราคาผ่อนไฟแนนซ์': 30000 };
    delete legacy['ราคาผ่อน BESTCHOICE (ราคาเต็ม)'];
    delete legacy['ราคาขาย GFIN (ราคาเต็ม)'];
    const parsed = parsePricingRow(legacy);
    expect(parsed && 'item' in parsed && parsed.item).toMatchObject({
      installmentBestchoicePrice: 31000,
      installmentFinancePrice: 30000,
    });
  });

  it('มือ 2 อ่านประกัน · เครื่องไทย/นอก', () => {
    const parsed = parsePricingRow(row({ 'ประเภท': 'มือ 2', 'ประกัน': 'มีประกัน', 'เครื่องไทย/นอก': 'เครื่องไทย' }));
    expect(parsed && 'item' in parsed && parsed.item).toMatchObject({
      category: 'PHONE_USED',
      hasWarranty: true,
      deviceOrigin: 'THAI',
    });
  });

  it.each([
    [{ 'ยี่ห้อ': '' }, 'ไม่มียี่ห้อหรือรุ่น'],
    [{ 'ประเภท': 'มือสาม' }, 'ประเภทต้องเป็น มือ 1 หรือ มือ 2'],
    [{ 'ประเภท': 'มือ 2' }, 'มือ 2 ต้องระบุ มีประกัน หรือ ไม่มีประกัน'],
    [{ 'เครื่องไทย/นอก': 'ญี่ปุ่น' }, 'เครื่องไทย/นอก ต้องเป็น เครื่องไทย · เครื่องนอก · หรือเว้นว่าง'],
    [{ 'ราคาเงินสด': 0 }, 'ราคาเงินสด ต้องเป็นตัวเลขมากกว่า 0'],
    [{ 'ราคาขาย GFIN (ราคาเต็ม)': 'abc' }, 'ราคาขาย GFIN ต้องเป็นตัวเลขมากกว่า 0'],
    [{ 'งวดเรท 1': 12.5 }, 'งวดเรท 1 ต้องเป็นจำนวนเต็ม 1–60 หรือเว้นว่าง'],
    [{ 'งวดเรท 2': 0 }, 'งวดเรท 2 ต้องเป็นจำนวนเต็ม 1–60 หรือเว้นว่าง'],
    [{ 'ดาวน์เรท 1': 39000 }, 'ดาวน์เรท 1 ต้องมากกว่า 0 และน้อยกว่าราคาผ่อน BESTCHOICE'],
  ])('ข้อมูลผิด %o → %s', (over, error) => {
    expect(parsePricingRow(row(over))).toMatchObject({ error });
  });

  it('แถวว่างทั้งแถว → null (ไม่นับ)', () => {
    expect(parsePricingRow({ 'ยี่ห้อ': null, 'รุ่น': '', 'ราคาเงินสด': null })).toBeNull();
  });
});

describe('buildPricingImportReview', () => {
  it('เพิ่ม / แก้ (บอกค่าเดิม → ใหม่) / ข้ามราคาเท่าเดิม / ข้ามแถวซ้ำ / แถวผิด + แถวที่ไม่อยู่ในไฟล์', () => {
    const review = buildPricingImportReview(
      [
        row(),
        row({ 'รุ่น': 'iPhone 17 Pro Max', 'ราคาเงินสด': 45900 }),
        row({ 'รุ่น': 'iPhone 18 Pro', 'ราคาเงินสด': 48900, 'งวดเรท 2': 15, 'ดาวน์เรท 1': 18000 }),
        row({ 'รุ่น': 'iPhone 18 Pro', 'ราคาเงินสด': 48900 }),
        row({ 'ประเภท': 'มือสาม' }),
        { 'ยี่ห้อ': null, 'รุ่น': null },
      ],
      [
        existing(),
        existing({ id: 't2', model: 'iPhone 17 Pro Max', cashPrice: '44900.00' }),
        existing({ id: 't3', model: 'iPhone 14', storage: '128GB' }),
      ],
    );
    expect(review.rows).toEqual([
      { rowNumber: 2, label: 'Apple iPhone 17 Pro 256GB มือ 1', action: 'SKIP', detail: 'ราคาเท่าเดิม' },
      { rowNumber: 3, label: 'Apple iPhone 17 Pro Max 256GB มือ 1', action: 'UPDATE', detail: 'เงินสด 44,900 → 45,900' },
      { rowNumber: 4, label: 'Apple iPhone 18 Pro 256GB มือ 1', action: 'ADD' },
      { rowNumber: 5, label: 'Apple iPhone 18 Pro 256GB มือ 1', action: 'SKIP', detail: 'ซ้ำกับแถว 4' },
      { rowNumber: 6, label: 'Apple iPhone 17 Pro 256GB มือสาม', action: 'SKIP', detail: 'ประเภทต้องเป็น มือ 1 หรือ มือ 2' },
    ]);
    expect(review.toSend.map((i) => i.model)).toEqual(['iPhone 17 Pro Max', 'iPhone 18 Pro']);
    expect(review.missingActive.map((t) => t.id)).toEqual(['t3']);
  });

  it('งวด/ดาวน์ที่เปลี่ยนถูกนับเป็นการแก้ (ว่าง ↔ มีค่า)', () => {
    const review = buildPricingImportReview([row({ 'ดาวน์เรท 1': null })], [existing()]);
    expect(review.rows[0]).toMatchObject({ action: 'UPDATE', detail: 'ดาวน์เรท 1 15,000 → ว่าง' });
  });

  it('แถวในไฟล์ที่ถูกข้าม (ราคาผิด) ยังนับว่าอยู่ในไฟล์ → ไม่อยู่ใน missingActive', () => {
    const review = buildPricingImportReview([row({ 'ราคาเงินสด': 'abc' })], [existing()]);
    expect(review.rows[0]).toMatchObject({ action: 'SKIP' });
    expect(review.toSend).toEqual([]);
    expect(review.missingActive).toEqual([]);
  });

  it('แถวผิดตามด้วยแถวถูกคีย์เดียวกัน → แถวถูกไม่ถูกตีเป็นซ้ำ และแถวเดิมไม่อยู่ใน missingActive', () => {
    const review = buildPricingImportReview(
      [row({ 'ราคาเงินสด': 'abc' }), row({ 'ราคาเงินสด': 41000 })],
      [existing()],
    );
    expect(review.rows.map((r) => r.action)).toEqual(['SKIP', 'UPDATE']);
    expect(review.toSend).toHaveLength(1);
    expect(review.missingActive).toEqual([]);
  });

  it('ที่มาเครื่องเป็นชื่อสืบทอด (constructor) → ข้ามด้วยข้อความผิดปกติ', () => {
    const review = buildPricingImportReview([row({ 'เครื่องไทย/นอก': 'constructor' })], []);
    expect(review.rows[0]).toMatchObject({
      action: 'SKIP',
      detail: 'เครื่องไทย/นอก ต้องเป็น เครื่องไทย · เครื่องนอก · หรือเว้นว่าง',
    });
  });

  it('มือ 2 มีประกัน กับ ไม่มีประกัน เป็นคนละแถว', () => {
    const used = (warranty: string) => row({ 'ประเภท': 'มือ 2', 'ประกัน': warranty });
    const review = buildPricingImportReview([used('มีประกัน'), used('ไม่มีประกัน')], []);
    expect(review.rows.map((r) => r.action)).toEqual(['ADD', 'ADD']);
  });
});

describe('sendPricingImport', () => {
  const item = { model: 'x' } as PricingImportItem;

  it('ส่งชุดละ 100 ตามลำดับ · deactivateIds ไปกับชุดสุดท้าย · รายงานความคืบหน้า', async () => {
    const post = vi.fn(async (body: { items: PricingImportItem[]; deactivateIds?: string[] }) => ({
      success: body.items.length,
      skipped: 0,
      errors: [],
      ...(body.deactivateIds ? { deactivated: body.deactivateIds.length } : {}),
    }));
    const progress = vi.fn();
    const result = await sendPricingImport(post, Array(205).fill(item), ['a', 'b'], progress);
    expect(post.mock.calls.map(([b]) => [b.items.length, b.deactivateIds])).toEqual([
      [100, undefined],
      [100, undefined],
      [5, ['a', 'b']],
    ]);
    expect(progress.mock.calls).toEqual([[1, 3], [2, 3], [3, 3]]);
    expect(result).toEqual({ saved: 205, deactivated: 2 });
  });

  it('ไม่มีแถวที่จะส่งแต่ต้องปิดแถว → ส่งชุดว่างพร้อม deactivateIds', async () => {
    const post = vi.fn(async () => ({ success: 0, skipped: 0, errors: [], deactivated: 1 }));
    expect(await sendPricingImport(post, [], ['a'])).toEqual({ saved: 0, deactivated: 1 });
    expect(post).toHaveBeenCalledWith({ items: [], deactivateIds: ['a'] });
  });

  it('ชุดถูกปฏิเสธ → หยุด และบอกว่าชุดก่อนหน้าบันทึกแล้ว', async () => {
    const post = vi
      .fn()
      .mockResolvedValueOnce({ success: 100, skipped: 0, errors: [] })
      .mockResolvedValueOnce({ success: 0, skipped: 3, errors: ['ROW_2:INVALID_ROW'] });
    const error = await sendPricingImport(post, Array(150).fill(item), []).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ImportBatchError);
    expect((error as Error).message).toBe('ชุดที่ 2 ถูกปฏิเสธ (ROW_2:INVALID_ROW) — บันทึกแล้ว 100 แถวจากชุดก่อนหน้า');
  });

  it('post ล้มเหลว (เครือข่าย/HTTP) ในชุดที่ 2 → ImportBatchError บอกจำนวนที่บันทึกแล้ว', async () => {
    const post = vi
      .fn()
      .mockResolvedValueOnce({ success: 100, skipped: 0, errors: [] })
      .mockRejectedValueOnce(new Error('Network Error'));
    const error = await sendPricingImport(post, Array(150).fill(item), []).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ImportBatchError);
    expect((error as Error).message).toBe('ชุดที่ 2 ส่งไม่สำเร็จ (Network Error) — บันทึกแล้ว 100 แถวจากชุดก่อนหน้า');
  });
});
