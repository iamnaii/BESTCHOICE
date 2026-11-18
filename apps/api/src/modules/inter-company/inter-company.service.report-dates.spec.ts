import { Test, TestingModule } from '@nestjs/testing';
import { InterCompanyService } from './inter-company.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * GET /inter-company และ /inter-company/profit-summary — startDate/endDate 'YYYY-MM-DD' = วันตามปฏิทินไทย (2026-11-18)
 * InterCompanyTransaction.createdAt เป็นเวลาจริง (@default(now())) ·
 * เดิม gte = 07:00 น. ไทยของวันเริ่ม และ lte = 07:00 น. ไทยของวันสิ้นสุด (ไม่ขยายเป็นสิ้นวัน)
 */
describe('InterCompanyService — ช่วงวันที่ createdAt', () => {
  let service: InterCompanyService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      interCompanyTransaction: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [InterCompanyService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(InterCompanyService);
  });

  const createdAtOf = () => prisma.interCompanyTransaction.findMany.mock.calls[0][0].where.createdAt;
  const RANGE = {
    gte: new Date('2026-10-31T17:00:00.000Z'),
    lte: new Date('2026-11-17T16:59:59.999Z'),
  };

  it('findAll: 00:00 น. วันเริ่ม ถึง 23:59:59.999 น. วันสิ้นสุด (เวลาไทย)', async () => {
    await service.findAll({ startDate: '2026-11-01', endDate: '2026-11-17' });
    expect(createdAtOf()).toEqual(RANGE);
  });

  it('getProfitSummary: 00:00 น. วันเริ่ม ถึง 23:59:59.999 น. วันสิ้นสุด (เวลาไทย)', async () => {
    await service.getProfitSummary({ startDate: '2026-11-01', endDate: '2026-11-17' });
    expect(createdAtOf()).toEqual(RANGE);
  });

  it('รายการเที่ยงคืนไทยของวันเริ่มอยู่ในช่วง · เที่ยงคืนไทยของวันถัดจากวันสิ้นสุดอยู่นอกช่วง', async () => {
    await service.findAll({ startDate: '2026-11-01', endDate: '2026-11-17' });
    const { gte, lte } = createdAtOf() as { gte: Date; lte: Date };
    const firstMinute = new Date('2026-11-01T00:00:00+07:00');
    const afternoonOnEndDay = new Date('2026-11-17T15:00:00+07:00');
    const nextMidnight = new Date('2026-11-18T00:00:00+07:00');
    expect(firstMinute >= gte && firstMinute <= lte).toBe(true);
    expect(afternoonOnEndDay <= lte).toBe(true);
    expect(nextMidnight <= lte).toBe(false);
  });

  it('ส่งแค่ startDate / แค่ endDate = ใส่เฉพาะขอบที่ส่ง', async () => {
    await service.findAll({ startDate: '2026-11-01' });
    expect(createdAtOf()).toEqual({ gte: RANGE.gte });
    prisma.interCompanyTransaction.findMany.mockClear();
    await service.getProfitSummary({ endDate: '2026-11-17' });
    expect(createdAtOf()).toEqual({ lte: RANGE.lte });
  });

  it('ค่าที่ไม่ใช่ YYYY-MM-DD (ISO เต็ม) ผ่านไปตามที่ส่งมา ไม่ขยายเป็นสิ้นวัน', async () => {
    const iso = { startDate: '2026-11-01T03:00:00.000Z', endDate: '2026-11-17T03:04:05.000Z' };
    const expected = { gte: new Date(iso.startDate), lte: new Date(iso.endDate) };
    await service.findAll(iso);
    expect(createdAtOf()).toEqual(expected);
    prisma.interCompanyTransaction.findMany.mockClear();
    await service.getProfitSummary(iso);
    expect(createdAtOf()).toEqual(expected);
  });

  it('ไม่ส่งวันที่ = ไม่กรอง createdAt', async () => {
    await service.findAll({});
    expect(prisma.interCompanyTransaction.findMany.mock.calls[0][0].where.createdAt).toBeUndefined();
  });
});
