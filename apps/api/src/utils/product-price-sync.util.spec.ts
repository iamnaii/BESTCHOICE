import { Prisma } from '@prisma/client';
import { syncPriceRowsFromColumns, CASH_LABEL, INSTALLMENT_LABEL } from './product-price-sync.util';

type Row = { id: string; label: string; amount: Prisma.Decimal; isDefault: boolean };

function makeTx(rows: Row[]) {
  const state = [...rows];
  let seq = 0;
  // แตะ isDefault ทุกครั้ง (create/update/updateMany) → snapshot จำนวนแถว isDefault:true
  // ทันทีหลัง apply — จำลอง partial unique index `product_prices_one_default`
  // (UNIQUE (product_id) WHERE is_default AND deleted_at IS NULL, migration 20260982000000)
  // ที่ตรวจทันทีหลังแต่ละ statement ใน Postgres จริง ไม่ใช่ตอนจบ tx
  const defaultCountSnapshots: number[] = [];
  const snapshot = () => defaultCountSnapshots.push(state.filter((r) => r.isDefault).length);
  return {
    state,
    calls: { updateMany: [] as unknown[], defaultCountSnapshots },
    productPrice: {
      findMany: jest.fn(async () => state.map((r) => ({ ...r }))),
      update: jest.fn(async ({ where, data }: any) => {
        const row = state.find((r) => r.id === where.id)!;
        Object.assign(row, data);
        snapshot();
        return { ...row };
      }),
      create: jest.fn(async ({ data }: any) => {
        const row: Row = {
          id: `new-${++seq}`,
          label: data.label,
          amount: data.amount,
          isDefault: data.isDefault ?? false,
        };
        state.push(row);
        snapshot();
        return { ...row };
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        let count = 0;
        for (const r of state) {
          if (where.id?.not && r.id === where.id.not) continue;
          if (where.isDefault !== undefined && r.isDefault !== where.isDefault) continue;
          Object.assign(r, data);
          count++;
        }
        snapshot();
        return { count };
      }),
    },
  };
}

const D = (n: string) => new Prisma.Decimal(n);

describe('syncPriceRowsFromColumns', () => {
  it('update แถว isDefault เดิม + relabel เป็น "ราคาเงินสด" (ไม่ create ซ้อน)', async () => {
    const tx = makeTx([{ id: 'r1', label: 'ราคาขาย', amount: D('17000'), isDefault: true }]);
    await syncPriceRowsFromColumns(tx as any, 'p1', { cashPrice: D('18000') });
    expect(tx.productPrice.create).not.toHaveBeenCalled();
    expect(tx.state).toHaveLength(1);
    expect(tx.state[0]).toMatchObject({ id: 'r1', label: CASH_LABEL, isDefault: true });
    expect(tx.state[0].amount.toString()).toBe('18000');
  });

  it('ไม่ relabel แถว isDefault ที่เป็นราคาผ่อน — สร้างแถวเงินสดแยก', async () => {
    const tx = makeTx([{ id: 'r1', label: INSTALLMENT_LABEL, amount: D('20000'), isDefault: true }]);
    await syncPriceRowsFromColumns(tx as any, 'p1', { cashPrice: D('18000') });
    expect(tx.state).toHaveLength(2);
    const cash = tx.state.find((r) => r.label === CASH_LABEL)!;
    const inst = tx.state.find((r) => r.label === INSTALLMENT_LABEL)!;
    expect(cash.isDefault).toBe(true);
    expect(inst.isDefault).toBe(false);
    expect(inst.amount.toString()).toBe('20000'); // ของเดิมไม่ถูกทับ
  });

  it('upsert แถว "ราคาผ่อน BESTCHOICE" จาก installmentPrice', async () => {
    const tx = makeTx([{ id: 'r1', label: CASH_LABEL, amount: D('18000'), isDefault: true }]);
    await syncPriceRowsFromColumns(tx as any, 'p1', { installmentPrice: D('20000') });
    const inst = tx.state.find((r) => r.label === INSTALLMENT_LABEL)!;
    expect(inst.amount.toString()).toBe('20000');
    expect(inst.isDefault).toBe(false);
  });

  it('เขียนทั้งสองราคาพร้อมกัน → เหลือ isDefault แถวเดียว (แถวเงินสด)', async () => {
    const tx = makeTx([]);
    await syncPriceRowsFromColumns(tx as any, 'p1', {
      cashPrice: D('18000'),
      installmentPrice: D('20000'),
    });
    expect(tx.state.filter((r) => r.isDefault)).toHaveLength(1);
    expect(tx.state.find((r) => r.isDefault)!.label).toBe(CASH_LABEL);
  });

  it('มีแต่ราคาผ่อนและยังไม่มี default เลย → แถวผ่อนกลายเป็น default', async () => {
    const tx = makeTx([]);
    await syncPriceRowsFromColumns(tx as any, 'p1', { installmentPrice: D('20000') });
    expect(tx.state.filter((r) => r.isDefault)).toHaveLength(1);
    expect(tx.state.find((r) => r.isDefault)!.label).toBe(INSTALLMENT_LABEL);
  });

  it('ไม่ส่งราคามาเลย → ไม่แตะอะไร', async () => {
    const tx = makeTx([{ id: 'r1', label: 'ราคาขาย', amount: D('17000'), isDefault: true }]);
    await syncPriceRowsFromColumns(tx as any, 'p1', {});
    expect(tx.productPrice.update).not.toHaveBeenCalled();
    expect(tx.productPrice.create).not.toHaveBeenCalled();
    expect(tx.state[0].label).toBe('ราคาขาย');
  });

  it('null = ไม่ sync ฟิลด์นั้น และไม่ลบแถวเดิม', async () => {
    const tx = makeTx([{ id: 'r1', label: CASH_LABEL, amount: D('18000'), isDefault: true }]);
    await syncPriceRowsFromColumns(tx as any, 'p1', { cashPrice: null, installmentPrice: null });
    expect(tx.state).toHaveLength(1);
    expect(tx.state[0].amount.toString()).toBe('18000');
  });

  // เพิ่มจากที่ brief ให้มา (ไม่ได้อยู่ใน 7 เคสต้นฉบับ) — ปักหมุด invariant ที่ Task 2 review
  // ทิ้งไว้ว่ายังไม่มี spec คุ้ม (M4): "unset default เดิมก่อนตั้ง default ใหม่เสมอ" ต้องไม่มี
  // ช่วงเวลาไหนระหว่างทางที่มี isDefault:true พร้อมกัน >1 แถว บน product เดียวกัน — ไม่งั้น
  // การ create/update แถวใหม่เป็น default ขณะแถวเก่ายังเป็น default อยู่จะชน
  // partial unique index `product_prices_one_default` จริงบน Postgres (P2002) ไม่ใช่แค่ mock
  // เคสนี้ตั้งใจใช้ setup เดียวกับเคสที่ 2 (แถวเดิม isDefault เป็นราคาผ่อน → ต้อง create แถว
  // เงินสดใหม่) เพราะเป็นเคสเดียวที่ "ตั้ง default ใหม่" ต้องเกิดผ่าน create ไม่ใช่ update-in-place
  // (update-in-place แถวเดิมไม่มีช่วงเวลาที่ 2 แถวเป็น default พร้อมกัน เพราะเป็นแถวเดียวกัน)
  it('unset default เดิมก่อนตั้ง default ใหม่เสมอ — ไม่มี isDefault ซ้อน 2 แถวระหว่างทาง (กัน P2002 จาก partial unique index)', async () => {
    const tx = makeTx([{ id: 'r1', label: INSTALLMENT_LABEL, amount: D('20000'), isDefault: true }]);
    await syncPriceRowsFromColumns(tx as any, 'p1', { cashPrice: D('18000') });
    expect(Math.max(...tx.calls.defaultCountSnapshots)).toBeLessThanOrEqual(1);
    // ผลลัพธ์ปลายทางยังต้องถูกต้องเหมือนเคสที่ 2 เดิม (ไม่ใช่แค่ไม่ throw)
    expect(tx.state.filter((r) => r.isDefault)).toHaveLength(1);
    expect(tx.state.find((r) => r.isDefault)!.label).toBe(CASH_LABEL);
  });
});
