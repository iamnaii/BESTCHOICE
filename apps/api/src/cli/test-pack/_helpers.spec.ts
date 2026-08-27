import { Prisma } from '@prisma/client';

import { nextNumberFrom, sumLine, sweepBadDebtProvisions } from './_helpers';

describe('nextNumberFrom', () => {
  it('เริ่มที่ 0001 เมื่อยังไม่มีเลขในวันนั้น', () => {
    expect(nextNumberFrom('EX-20260826-', null)).toBe('EX-20260826-0001');
  });

  it('เดินต่อจากเลขล่าสุด (max+1 ไม่ใช่ count+1)', () => {
    expect(nextNumberFrom('EX-20260826-', 'EX-20260826-0042')).toBe('EX-20260826-0043');
  });

  it('เลขเสียกลับไปเริ่มที่ 0001 แทนที่จะได้ NaN', () => {
    expect(nextNumberFrom('EX-20260826-', 'EX-20260826-abcd')).toBe('EX-20260826-0001');
  });

  it('รองรับความกว้างอื่น เช่น RT- ที่ใช้ 5 หลัก', () => {
    expect(nextNumberFrom('RT-202608-', 'RT-202608-00007', 5)).toBe('RT-202608-00008');
  });
});

describe('sumLine', () => {
  // ยืนยันด้วย .toString() (ค่าที่เก็บจริง) — ห้ามใช้ .toFixed(2) เพราะมันปัดเศษใน assertion เอง:
  // ถ้า round2 หายไปจนได้ 23.3331 มา .toFixed(2) ยังพิมพ์ '23.33' แล้วเทสผ่านทั้งที่ค่าผิด
  it('คิดยอดก่อน VAT และ VAT แยกกัน ปัด 2 ตำแหน่ง — คืนค่าเป็น Prisma.Decimal', () => {
    const s = sumLine(1000, 3, 7);
    expect(s.amountBeforeVat).toBeInstanceOf(Prisma.Decimal);
    expect(s.vatAmount).toBeInstanceOf(Prisma.Decimal);
    expect(s.total).toBeInstanceOf(Prisma.Decimal);
    expect(s.amountBeforeVat.toString()).toBe('3000');
    expect(s.vatAmount.toString()).toBe('210');
    expect(s.total.toString()).toBe('3210');
  });

  it('VAT 0 = ไม่มีภาษี (ฝั่ง SHOP ไม่จด VAT)', () => {
    const s = sumLine(1500, 2, 0);
    expect(s.amountBeforeVat.toString()).toBe('3000');
    expect(s.vatAmount.toString()).toBe('0');
    expect(s.total.toString()).toBe('3000');
  });

  it('ปัดเศษ VAT แบบ 2 ตำแหน่ง ไม่ปล่อยทศนิยมลอย (333.33 × 7% → 23.33)', () => {
    const s = sumLine(333.33, 1, 7);
    expect(s.amountBeforeVat.toString()).toBe('333.33');
    expect(s.vatAmount.toString()).toBe('23.33');
    expect(s.total.toString()).toBe('356.66');
  });
});

describe('sweepBadDebtProvisions', () => {
  const makePrisma = () => ({
    badDebtProvision: {
      count: jest.fn().mockResolvedValue(3),
      updateMany: jest.fn().mockResolvedValue({ count: 3 }),
    },
  });

  it('ไม่มีสัญญาทดสอบ → คืน 0 โดยไม่แตะ DB เลย', async () => {
    const prisma = makePrisma();
    await expect(sweepBadDebtProvisions(prisma as never, [], false)).resolves.toBe(0);
    expect(prisma.badDebtProvision.count).not.toHaveBeenCalled();
    expect(prisma.badDebtProvision.updateMany).not.toHaveBeenCalled();
  });

  it('dry-run นับอย่างเดียว ห้ามเขียน', async () => {
    const prisma = makePrisma();
    await expect(sweepBadDebtProvisions(prisma as never, ['c1', 'c2'], true)).resolves.toBe(3);
    expect(prisma.badDebtProvision.updateMany).not.toHaveBeenCalled();
    expect(prisma.badDebtProvision.count).toHaveBeenCalledWith({
      where: { contractId: { in: ['c1', 'c2'] }, status: 'ACTIVE', deletedAt: null },
    });
  });

  // เทสหลักของบล็อกนี้: งบดุลบรรทัด "1229 ค่าเผื่อหนี้สงสัยจะสูญ"
  // (transactional-report.service.ts) aggregate ด้วย { status: 'ACTIVE' } โดย
  // **ไม่กรอง deletedAt** ⇒ ถ้าใครแก้ให้ตั้งแค่ deletedAt ค่าเผื่อผีจะกลับมาโชว์บนงบ
  it('โหมดจริงต้องตั้ง status = REVERSED (ไม่ใช่แค่ deletedAt) ไม่งั้นงบดุลยังนับ', async () => {
    const prisma = makePrisma();
    await expect(sweepBadDebtProvisions(prisma as never, ['c1'], false)).resolves.toBe(3);
    expect(prisma.badDebtProvision.count).not.toHaveBeenCalled();
    const arg = prisma.badDebtProvision.updateMany.mock.calls[0][0];
    expect(arg.data.status).toBe('REVERSED');
    expect(arg.data.deletedAt).toBeInstanceOf(Date);
  });

  it('แตะเฉพาะแถว ACTIVE ที่ยังไม่ถูกลบ ของสัญญาที่ระบุเท่านั้น', async () => {
    const prisma = makePrisma();
    await sweepBadDebtProvisions(prisma as never, ['c1', 'c2'], false);
    const arg = prisma.badDebtProvision.updateMany.mock.calls[0][0];
    expect(arg.where).toEqual({
      contractId: { in: ['c1', 'c2'] },
      status: 'ACTIVE',
      deletedAt: null,
    });
  });
});
