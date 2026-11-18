import { Test, TestingModule } from '@nestjs/testing';
import { AuditService } from './audit.service';
import { PrismaService } from '../../prisma/prisma.service';

jest.mock('@sentry/nestjs');

/**
 * GET /audit/logs?from&to รับ 'YYYY-MM-DD' = วันตามปฏิทินไทย (2026-11-18)
 * เดิม new Date('YYYY-MM-DD') = 07:00 น. ไทย ⇒ from = to = วันนี้ ได้ช่วงศูนย์วินาที (ผลว่างเปล่า)
 * และ log 00:00–06:59 น. ของวันเริ่ม / หลัง 07:00 น. ของวันสิ้นสุดหาย
 */
describe('AuditService.getAuditLogs — ช่วงวันที่ตามเวลาไทย', () => {
  let service: AuditService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      auditLog: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
    };
    const mod: TestingModule = await Test.createTestingModule({
      providers: [AuditService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = mod.get(AuditService);
  });

  const createdAtOf = () => prisma.auditLog.findMany.mock.calls[0][0].where.createdAt;

  it('from = to = วันนี้ ได้ช่วงเต็มวันไทย ไม่ใช่ช่วงศูนย์วินาที', async () => {
    await service.getAuditLogs({ from: '2026-11-18', to: '2026-11-18' });
    const { gte, lte } = createdAtOf();
    expect(gte.toISOString()).toBe('2026-11-17T17:00:00.000Z');
    expect(lte.toISOString()).toBe('2026-11-18T16:59:59.999Z');
    expect(lte.getTime()).toBeGreaterThan(gte.getTime());
  });

  it('ช่วงหลายวัน: 00:00 น. วันเริ่ม ถึง 23:59:59.999 น. วันสิ้นสุด (เวลาไทย)', async () => {
    await service.getAuditLogs({ from: '2026-11-01', to: '2026-11-17' });
    const { gte, lte } = createdAtOf();
    expect(gte.toISOString()).toBe('2026-10-31T17:00:00.000Z');
    expect(lte.toISOString()).toBe('2026-11-17T16:59:59.999Z');
  });

  it('ขอบ: log 00:00 น. ไทยของวันเริ่มอยู่ในช่วง · 00:00 น. ของวันถัดจากวันสิ้นสุดอยู่นอกช่วง', async () => {
    await service.getAuditLogs({ from: '2026-11-01', to: '2026-11-17' });
    const { gte, lte } = createdAtOf();
    const firstInstant = new Date('2026-11-01T00:00:00+07:00').getTime();
    const nextDayMidnight = new Date('2026-11-18T00:00:00+07:00').getTime();
    expect(firstInstant >= gte.getTime() && firstInstant <= lte.getTime()).toBe(true);
    expect(nextDayMidnight <= lte.getTime()).toBe(false);
  });

  it('ส่งแค่ from หรือแค่ to ได้ขอบข้างเดียว', async () => {
    await service.getAuditLogs({ from: '2026-11-01' });
    expect(Object.keys(createdAtOf())).toEqual(['gte']);

    prisma.auditLog.findMany.mockClear();
    await service.getAuditLogs({ to: '2026-11-17' });
    expect(Object.keys(createdAtOf())).toEqual(['lte']);
  });

  it('ค่า ISO เต็ม (ไม่ใช่ YYYY-MM-DD) ใช้ตามเดิม', async () => {
    await service.getAuditLogs({ from: '2026-11-17T03:00:00.000Z', to: '2026-11-17T10:00:00.000Z' });
    const { gte, lte } = createdAtOf();
    expect(gte.toISOString()).toBe('2026-11-17T03:00:00.000Z');
    expect(lte.toISOString()).toBe('2026-11-17T10:00:00.000Z');
  });

  it('ไม่ส่งวันที่ = ไม่มีเงื่อนไข createdAt ตามเดิม · count ใช้ where เดียวกับ findMany', async () => {
    await service.getAuditLogs({});
    expect(prisma.auditLog.findMany.mock.calls[0][0].where.createdAt).toBeUndefined();

    prisma.auditLog.findMany.mockClear();
    await service.getAuditLogs({ from: '2026-11-18', to: '2026-11-18' });
    expect(prisma.auditLog.count.mock.calls[1][0].where).toEqual(
      prisma.auditLog.findMany.mock.calls[0][0].where,
    );
  });
});
