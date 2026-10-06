import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateBookingDto } from '../dto/create-booking.dto';
import { UpdateBookingDto } from '../dto/update-booking.dto';
import { CancelBookingDto } from '../dto/cancel-booking.dto';

const item = { productId: '0f5c6a1e-2b3d-4e5f-8a9b-0c1d2e3f4a5b', description: 'iPhone 16 Pro', quantity: 1, unitPrice: 42900 };
const base = { customerId: '1f5c6a1e-2b3d-4e5f-8a9b-0c1d2e3f4a5b', branchId: '2f5c6a1e-2b3d-4e5f-8a9b-0c1d2e3f4a5b', depositAmount: 5000 };
const messages = (errors: ReturnType<typeof validateSync>) =>
  JSON.stringify(errors.map((e) => [e.constraints, e.children?.map((c) => c.children?.map((cc) => cc.constraints))]));

describe('กติกาใบจอง (คำตัดสินเจ้าของ 2026-10-05 ข้อ 2)', () => {
  it('รับใบที่ผูกเครื่อง 1 เครื่อง จำนวน 1', () => {
    expect(validateSync(plainToInstance(CreateBookingDto, { ...base, items: [item] }))).toHaveLength(0);
  });
  it('ปฏิเสธรายการที่ไม่มี productId (พิมพ์รุ่นเอง)', () => {
    const errors = validateSync(plainToInstance(CreateBookingDto, { ...base, items: [{ ...item, productId: undefined }] }));
    expect(messages(errors)).toContain('กรุณาเลือกเครื่องในสต็อก');
  });
  it('ปฏิเสธมากกว่า 1 รายการ และจำนวนมากกว่า 1', () => {
    expect(messages(validateSync(plainToInstance(CreateBookingDto, { ...base, items: [item, item] })))).toContain('1 เครื่อง');
    expect(messages(validateSync(plainToInstance(CreateBookingDto, { ...base, items: [{ ...item, quantity: 2 }] })))).toContain('1 ชิ้น');
  });
  it('ปฏิเสธมัดจำ 0 (ไม่มีอะไรให้ล็อก)', () => {
    expect(messages(validateSync(plainToInstance(CreateBookingDto, { ...base, items: [item], depositAmount: 0 })))).toContain('มากกว่า 0');
    expect(messages(validateSync(plainToInstance(UpdateBookingDto, { depositAmount: 0 })))).toContain('มากกว่า 0');
  });
  it('ยกเลิกต้องมีเหตุผลอย่างน้อย 3 ตัวอักษร', () => {
    expect(validateSync(plainToInstance(CancelBookingDto, {})).length).toBeGreaterThan(0);
    expect(messages(validateSync(plainToInstance(CancelBookingDto, { cancelReason: 'ok' })))).toContain('อย่างน้อย 3');
    expect(validateSync(plainToInstance(CancelBookingDto, { cancelReason: 'ลูกค้าเปลี่ยนใจ' }))).toHaveLength(0);
  });
});
