import { Test, TestingModule } from '@nestjs/testing';
import { JournalService } from './journal.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * GET /journal-entries?startDate&endDate — 'YYYY-MM-DD' = วันตามปฏิทินไทย (2026-11-18)
 * entryDate ของรายการอัตโนมัติเป็นเวลาจริง · รายการตั้งลูกหนี้งวดลงเที่ยงคืนไทยของวันครบกำหนด
 * เดิมใช้ new Date('YYYY-MM-DD') = 07:00 น. ไทย ⇒ ตัดรายการเที่ยงคืนของวันเริ่ม และทุกรายการหลัง 07:00 น. ของวันสิ้นสุด
 */
describe('JournalService.findAll — ช่วงวันที่ entryDate', () => {
  let service: JournalService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      journalEntry: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
    };
    const mod: TestingModule = await Test.createTestingModule({
      providers: [JournalService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = mod.get(JournalService);
  });

  const entryDateOf = () => prisma.journalEntry.findMany.mock.calls[0][0].where.entryDate;

  it('startDate + endDate = 00:00 น. วันเริ่ม ถึง 23:59:59.999 น. วันสิ้นสุด (เวลาไทย)', async () => {
    await service.findAll({ startDate: '2026-11-01', endDate: '2026-11-17' });
    expect(entryDateOf()).toEqual({
      gte: new Date('2026-10-31T17:00:00.000Z'),
      lte: new Date('2026-11-17T16:59:59.999Z'),
    });
  });

  it('รายการตั้งลูกหนี้งวดเที่ยงคืนไทยของวันเริ่มอยู่ในช่วง · เที่ยงคืนไทยของวันถัดจากวันสิ้นสุดอยู่นอกช่วง', async () => {
    await service.findAll({ startDate: '2026-11-01', endDate: '2026-11-17' });
    const { gte, lte } = entryDateOf() as { gte: Date; lte: Date };
    const accrual = new Date('2026-11-01T00:00:00+07:00');
    const lateEvening = new Date('2026-11-17T23:59:00+07:00');
    const nextDayAccrual = new Date('2026-11-18T00:00:00+07:00');
    expect(accrual >= gte && accrual <= lte).toBe(true);
    expect(lateEvening <= lte).toBe(true);
    expect(nextDayAccrual <= lte).toBe(false);
  });

  it('ส่งแค่ startDate = มีเฉพาะ gte · ส่งแค่ endDate = มีเฉพาะ lte', async () => {
    await service.findAll({ startDate: '2026-11-01' });
    expect(entryDateOf()).toEqual({ gte: new Date('2026-10-31T17:00:00.000Z') });
    prisma.journalEntry.findMany.mockClear();
    await service.findAll({ endDate: '2026-11-17' });
    expect(entryDateOf()).toEqual({ lte: new Date('2026-11-17T16:59:59.999Z') });
  });

  it('ค่าที่ไม่ใช่ YYYY-MM-DD (ISO เต็ม) ผ่านไปตามที่ส่งมา ไม่ขยายเป็นสิ้นวัน', async () => {
    await service.findAll({ startDate: '2026-11-01T03:00:00.000Z', endDate: '2026-11-17T03:04:05.000Z' });
    expect(entryDateOf()).toEqual({
      gte: new Date('2026-11-01T03:00:00.000Z'),
      lte: new Date('2026-11-17T03:04:05.000Z'),
    });
  });

  it('ไม่ส่งวันที่ = ไม่กรอง entryDate', async () => {
    await service.findAll({});
    expect(prisma.journalEntry.findMany.mock.calls[0][0].where.entryDate).toBeUndefined();
  });
});
