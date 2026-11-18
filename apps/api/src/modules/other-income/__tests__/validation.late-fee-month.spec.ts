import { Test } from '@nestjs/testing';
import { PrismaService } from '../../../prisma/prisma.service';
import { ValidationService } from '../services/validation.service';

/**
 * C14 — checkLateFeeCollision: ขอบเดือนของ Payment.dueDate ต้องเป็นเดือนปฏิทินไทย (2026-11-18)
 * Payment.dueDate เก็บที่ 00:00 น. ไทยของวันครบกำหนด (= 17:00Z ของวันก่อนหน้า) ไม่ใช่ 00:00 UTC
 * เดิมใช้ Date.UTC เป็นขอบเดือน ⇒ งวดที่ครบกำหนดวันที่ 1 ของเดือนนี้หลุดจากเดือนนี้ (ไปนับเดือนก่อน)
 * และงวดที่ครบกำหนดวันที่ 1 ของเดือนหน้าถูกนับเข้าเดือนนี้
 * ตามแบบ validation.spec.ts (describe C14) — hand-built prisma mock ที่ payment.findFirst
 */
describe('C14 — checkLateFeeCollision: ขอบเดือนตามปฏิทินไทย', () => {
  const customerId = '11111111-1111-1111-1111-111111111111';
  const items = [{ lineNo: 1, accountCode: '42-1103' }];

  async function build() {
    const findFirst = jest.fn().mockResolvedValue(null);
    const prismaMock = { payment: { findFirst } } as unknown as PrismaService;
    const module = await Test.createTestingModule({
      providers: [ValidationService, { provide: PrismaService, useValue: prismaMock }],
    }).compile();
    return { service: module.get(ValidationService), findFirst };
  }

  const dueDateOf = (findFirst: jest.Mock) => findFirst.mock.calls[0][0].where.dueDate;

  it('issueDate พ.ค. 2026 → dueDate ตั้งแต่ 00:00 น. ไทย 1 พ.ค. จนถึงก่อน 00:00 น. ไทย 1 มิ.ย.', async () => {
    const { service, findFirst } = await build();
    await service.checkLateFeeCollision(customerId, new Date('2026-05-14T03:00:00.000Z'), items);
    expect(dueDateOf(findFirst)).toEqual({
      gte: new Date('2026-04-30T17:00:00.000Z'),
      lt: new Date('2026-05-31T17:00:00.000Z'),
    });
  });

  it('งวดที่ครบกำหนด 1 พ.ค. (00:00 น. ไทย) อยู่ในเดือน · งวดที่ครบกำหนด 1 มิ.ย. (00:00 น. ไทย) อยู่นอกเดือน', async () => {
    const { service, findFirst } = await build();
    await service.checkLateFeeCollision(customerId, new Date('2026-05-14T03:00:00.000Z'), items);
    const { gte, lt } = dueDateOf(findFirst) as { gte: Date; lt: Date };
    const dueOnFirstOfMay = new Date('2026-05-01T00:00:00+07:00');
    const dueOnLastOfMay = new Date('2026-05-31T00:00:00+07:00');
    const dueOnFirstOfJune = new Date('2026-06-01T00:00:00+07:00');
    expect(dueOnFirstOfMay >= gte && dueOnFirstOfMay < lt).toBe(true);
    expect(dueOnLastOfMay >= gte && dueOnLastOfMay < lt).toBe(true);
    expect(dueOnFirstOfJune < lt).toBe(false);
  });

  it('issueDate 01:00 น. ไทยของ 1 มิ.ย. (= 31 พ.ค. 18:00Z) นับเป็นเดือนมิถุนายน ไม่ขึ้นกับ TZ ของโปรเซส', async () => {
    const { service, findFirst } = await build();
    await service.checkLateFeeCollision(customerId, new Date('2026-05-31T18:00:00.000Z'), items);
    expect(dueDateOf(findFirst)).toEqual({
      gte: new Date('2026-05-31T17:00:00.000Z'),
      lt: new Date('2026-06-30T17:00:00.000Z'),
    });
  });

  it('ข้อความเตือนยังระบุเดือนตามปฏิทินไทย', async () => {
    const { service, findFirst } = await build();
    findFirst.mockResolvedValue({
      id: 'p1',
      installmentNo: 4,
      lateFee: { toString: () => '50' },
      dueDate: new Date('2026-05-04T17:00:00.000Z'),
    });
    const warnings = await service.checkLateFeeCollision(customerId, new Date('2026-05-31T18:00:00.000Z'), items);
    expect(warnings[0].msg).toMatch(/งวด 2026-06/);
  });
});
