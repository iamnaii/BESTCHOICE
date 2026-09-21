import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ConfirmCashCloseDto, CountCashCloseDto, SendBackCashCloseDto } from './cash-close.dto';

const messages = async (cls: new () => object, plain: object) =>
  (await validate(plainToInstance(cls, plain))).flatMap((error) => Object.values(error.constraints ?? {}));

describe('DTO นับเงินปิดยอด', () => {
  it('รับรหัสสาขาที่ไม่ใช่ UUID — สาขาจาก seed/ข้อมูลเก่าใช้ id แบบ `branch-002` (บั๊กที่เจอจากการคลิกทดสอบจริง 2026-09-20)', async () => {
    expect(await messages(CountCashCloseDto, { branchId: 'branch-002', countedAmount: 12510, varianceReason: 'ทอนเงินผิด' })).toEqual([]);
    expect(await messages(CountCashCloseDto, { branchId: '8c0f6f0e-3f0b-4f56-9d0a-0f4f4a7f1a11', countedAmount: 0 })).toEqual([]);
  });

  it('ปฏิเสธ: ไม่เลือกสาขา · ยอดติดลบ · ทศนิยมเกิน 2 ตำแหน่ง', async () => {
    expect(await messages(CountCashCloseDto, { branchId: '', countedAmount: 100 })).toContain('กรุณาเลือกสาขา');
    expect(await messages(CountCashCloseDto, { branchId: 'b1', countedAmount: -1 })).toContain('ยอดที่นับได้ต้องไม่ติดลบ');
    expect(await messages(CountCashCloseDto, { branchId: 'b1', countedAmount: 1.234 })).toContain('ยอดที่นับได้ต้องเป็นตัวเลข ทศนิยมไม่เกิน 2 ตำแหน่ง');
  });

  it('ยืนยันรับเงิน: ต้องเลือกปลายทางเงินจากรายการ · ตีกลับ: ต้องมีเหตุผล', async () => {
    expect(await messages(ConfirmCashCloseDto, { receivedAmount: 10510, destination: 'BANK_DEPOSIT' })).toEqual([]);
    expect(await messages(ConfirmCashCloseDto, { receivedAmount: 10510, destination: 'UNDER_THE_MATTRESS' })).toContain('กรุณาเลือกว่านำเงินไปไว้ที่ไหน');
    expect(await messages(SendBackCashCloseDto, { reason: '' })).toContain('กรอกเหตุผลที่ตีกลับให้นับใหม่');
  });
});
