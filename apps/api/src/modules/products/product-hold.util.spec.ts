import { ProductStatus } from '@prisma/client';
import { assertProductNotHeld, type ProductHoldClient } from './product-hold.util';

/** ไม่มีสัญญา/จอง/ออเดอร์ค้างเลย — ให้ชั้น 2-4 ผ่านหมด เหลือแค่ชั้นสถานะที่กำลังทดสอบ */
const makeNoHolds = () =>
  ({
    contract: { findFirst: jest.fn().mockResolvedValue(null) },
    productReservation: { findFirst: jest.fn().mockResolvedValue(null) },
    onlineOrder: { findFirst: jest.fn().mockResolvedValue(null) },
  }) as unknown as ProductHoldClient;

describe('assertProductNotHeld — action RESTORE_TO_STOCK (ยกเลิกใบขาย)', () => {
  it('ผ่านเมื่อสถานะตรงกับที่ใบขายตั้งไว้ (SOLD_CASH)', async () => {
    await expect(
      assertProductNotHeld(
        makeNoHolds(),
        { id: 'p1', status: ProductStatus.SOLD_CASH, expectedStatus: ProductStatus.SOLD_CASH },
        'RESTORE_TO_STOCK',
      ),
    ).resolves.toBeUndefined();
  });

  it('ผ่านเมื่อสถานะตรงกับที่ใบขายตั้งไว้ (SOLD_INSTALLMENT ของขายผ่านไฟแนนซ์ภายนอก) — ทั้งที่สถานะนี้อยู่ในตารางกลาง', async () => {
    await expect(
      assertProductNotHeld(
        makeNoHolds(),
        {
          id: 'p1',
          status: ProductStatus.SOLD_INSTALLMENT,
          expectedStatus: ProductStatus.SOLD_INSTALLMENT,
        },
        'RESTORE_TO_STOCK',
      ),
    ).resolves.toBeUndefined();
  });

  it('บล็อกเมื่อสถานะไม่ตรง — ใบขายสดแต่เครื่องถูกเปิดสัญญาผ่อนต่อไปแล้ว', async () => {
    await expect(
      assertProductNotHeld(
        makeNoHolds(),
        {
          id: 'p1',
          status: ProductStatus.SOLD_INSTALLMENT,
          expectedStatus: ProductStatus.SOLD_CASH,
        },
        'RESTORE_TO_STOCK',
      ),
    ).rejects.toThrow(/ยกเลิกใบขายไม่ได้/);
  });

  it('บล็อกเมื่อสถานะไม่ตรงแม้เป็นสถานะที่ไม่ได้อยู่ในตารางกลาง — เครื่องถูกนำกลับเข้าสต็อกไปแล้ว', async () => {
    await expect(
      assertProductNotHeld(
        makeNoHolds(),
        {
          id: 'p1',
          status: ProductStatus.IN_STOCK,
          expectedStatus: ProductStatus.SOLD_CASH,
        },
        'RESTORE_TO_STOCK',
      ),
    ).rejects.toThrow(/ยกเลิกใบขายไม่ได้/);
  });

  it('บล็อกเมื่อเครื่องถูกลบไปแล้ว', async () => {
    await expect(
      assertProductNotHeld(
        makeNoHolds(),
        {
          id: 'p1',
          status: ProductStatus.SOLD_CASH,
          expectedStatus: ProductStatus.SOLD_CASH,
          deletedAt: new Date(),
        },
        'RESTORE_TO_STOCK',
      ),
    ).rejects.toThrow(/ถูกลบออกจากระบบไปแล้ว/);
  });

  it('ยังตรวจชั้นที่เหลือ — มีสัญญาที่ยังเดินอยู่บนเครื่องเดียวกัน', async () => {
    const withContract = {
      ...makeNoHolds(),
      contract: {
        findFirst: jest.fn().mockResolvedValue({ contractNumber: 'CT-1', status: 'ACTIVE' }),
      },
    } as unknown as ProductHoldClient;
    await expect(
      assertProductNotHeld(
        withContract,
        { id: 'p1', status: ProductStatus.SOLD_CASH, expectedStatus: ProductStatus.SOLD_CASH },
        'RESTORE_TO_STOCK',
      ),
    ).rejects.toThrow(/CT-1/);
  });

  it('ยังตรวจชั้นที่เหลือ — มีออเดอร์ออนไลน์เปิดค้างบนเครื่องเดียวกัน', async () => {
    const withOrder = {
      ...makeNoHolds(),
      onlineOrder: {
        findFirst: jest.fn().mockResolvedValue({ orderNumber: 'OO-1', status: 'PAID' }),
      },
    } as unknown as ProductHoldClient;
    await expect(
      assertProductNotHeld(
        withOrder,
        { id: 'p1', status: ProductStatus.SOLD_CASH, expectedStatus: ProductStatus.SOLD_CASH },
        'RESTORE_TO_STOCK',
      ),
    ).rejects.toThrow(/OO-1/);
  });

  it('ผู้เรียกลืมส่ง expectedStatus = บั๊กของโค้ด ไม่ใช่ข้อผิดพลาดของผู้ใช้', async () => {
    await expect(
      assertProductNotHeld(
        makeNoHolds(),
        { id: 'p1', status: ProductStatus.SOLD_CASH },
        'RESTORE_TO_STOCK',
      ),
    ).rejects.toThrow(/RESTORE_TO_STOCK requires expectedStatus/);
  });
});

describe('assertProductNotHeld — 3 action เดิมต้องไม่เปลี่ยนพฤติกรรม', () => {
  it('DELETE บน SOLD_INSTALLMENT ยังบล็อก (ตารางกลาง)', async () => {
    await expect(
      assertProductNotHeld(
        makeNoHolds(),
        { id: 'p1', status: ProductStatus.SOLD_INSTALLMENT },
        'DELETE',
      ),
    ).rejects.toThrow(/ลบไม่ได้/);
  });

  it('DELETE บน SOLD_CASH ยังผ่าน (SOLD_CASH จงใจไม่อยู่ในตารางกลาง)', async () => {
    await expect(
      assertProductNotHeld(makeNoHolds(), { id: 'p1', status: ProductStatus.SOLD_CASH }, 'DELETE'),
    ).resolves.toBeUndefined();
  });

  it('CHANGE_IDENTITY บน RESERVED ยังบล็อก + ระบุฟิลด์ที่กำลังแก้', async () => {
    await expect(
      assertProductNotHeld(
        makeNoHolds(),
        { id: 'p1', status: ProductStatus.RESERVED },
        'CHANGE_IDENTITY',
        ['IMEI'],
      ),
    ).rejects.toThrow(/แก้ IMEI ไม่ได้/);
  });

  it('RESTORE_TO_CONTRACT บน SOLD_CASH ยังบล็อกด้วยตารางเฉพาะ action', async () => {
    await expect(
      assertProductNotHeld(
        makeNoHolds(),
        { id: 'p1', status: ProductStatus.SOLD_CASH },
        'RESTORE_TO_CONTRACT',
      ),
    ).rejects.toThrow(/ยกเลิกเปลี่ยนเครื่องไม่ได้/);
  });

  it('RESTORE_TO_CONTRACT บนเครื่องที่ถูกลบ ยังได้ข้อความพร้อมทางออก', async () => {
    await expect(
      assertProductNotHeld(
        makeNoHolds(),
        { id: 'p1', status: ProductStatus.IN_STOCK, deletedAt: new Date() },
        'RESTORE_TO_CONTRACT',
      ),
    ).rejects.toThrow(/ถูกลบออกจากระบบไปแล้ว/);
  });
});
