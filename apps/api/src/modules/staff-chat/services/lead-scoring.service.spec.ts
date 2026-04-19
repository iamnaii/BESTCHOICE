import { Test, TestingModule } from '@nestjs/testing';
import { LeadScoringService } from './lead-scoring.service';
import { PrismaService } from '../../../prisma/prisma.service';

describe('LeadScoringService.scoreSession', () => {
  let service: LeadScoringService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  const message = (text: string) => ({ text, role: 'CUSTOMER' });

  beforeEach(async () => {
    prisma = {
      chatMessage: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      chatRoom: {
        findUnique: jest.fn().mockResolvedValue({ customer: null }),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const mod: TestingModule = await Test.createTestingModule({
      providers: [LeadScoringService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = mod.get(LeadScoringService);
  });

  it('returns COLD/0 with empty signals when no messages', async () => {
    const result = await service.scoreSession('room-1');
    expect(result).toEqual({ score: 0, temperature: 'COLD', signals: [] });
    expect(prisma.chatRoom.update).not.toHaveBeenCalled();
  });

  it('adds 30 for price/installment keywords', async () => {
    prisma.chatMessage.findMany.mockResolvedValue([message('ราคาเท่าไหร่ ผ่อนได้ไหม')]);
    const result = await service.scoreSession('room-1');
    expect(result.signals).toContain('ถามราคา/ผ่อน');
    // 30 (price) - 10 (single message penalty) = 20
    expect(result.score).toBe(20);
  });

  it('adds 20 for specific model mention', async () => {
    prisma.chatMessage.findMany.mockResolvedValue([message('มี iPhone 15 ไหม')]);
    const result = await service.scoreSession('room-1');
    expect(result.signals).toContain('ระบุรุ่นชัดเจน');
  });

  it('adds 15 for stock/color inquiry', async () => {
    prisma.chatMessage.findMany.mockResolvedValue([message('มีสต็อกสีดำไหม')]);
    const result = await service.scoreSession('room-1');
    expect(result.signals).toContain('ถามสต็อก/สี');
  });

  it('adds 15 for returning customer (has contracts)', async () => {
    prisma.chatMessage.findMany.mockResolvedValue([message('สวัสดี')]);
    prisma.chatRoom.findUnique.mockResolvedValue({
      customer: { contracts: [{ id: 'c-1' }] },
    });
    const result = await service.scoreSession('room-1');
    expect(result.signals).toContain('ลูกค้าเก่า (มีสัญญา)');
  });

  it('adds 10 for location/time inquiry', async () => {
    prisma.chatMessage.findMany.mockResolvedValue([message('สาขาเปิดกี่โมง')]);
    const result = await service.scoreSession('room-1');
    expect(result.signals).toContain('ถามสาขา/เวลา');
  });

  it('applies single-message penalty (-10)', async () => {
    prisma.chatMessage.findMany.mockResolvedValue([message('สวัสดี')]);
    const result = await service.scoreSession('room-1');
    // No positive signals → 0 - 10 = capped at 0
    expect(result.score).toBe(0);
    expect(result.signals).toContain('ส่งข้อความเดียว');
  });

  it('applies multi-message bonus (+5 per msg, max +15)', async () => {
    prisma.chatMessage.findMany.mockResolvedValue([
      message('x'),
      message('y'),
      message('z'),
      message('w'),
    ]);
    const result = await service.scoreSession('room-1');
    expect(result.signals.some((s) => s.includes('4 ข้อความ'))).toBe(true);
    expect(result.score).toBe(15); // max bonus, no other signals
  });

  it('classifies HOT when score >= 80', async () => {
    // 30 (price) + 20 (model) + 15 (stock) + 15 (returning) + 15 (msg bonus) = 95
    prisma.chatMessage.findMany.mockResolvedValue([
      message('ราคา iphone 15 มีสี ดำไหม'),
      message('a'),
      message('b'),
      message('c'),
    ]);
    prisma.chatRoom.findUnique.mockResolvedValue({
      customer: { contracts: [{ id: 'c-1' }] },
    });
    const result = await service.scoreSession('room-1');
    expect(result.temperature).toBe('HOT');
    expect(result.score).toBeGreaterThanOrEqual(80);
  });

  it('classifies WARM when 50 <= score < 80', async () => {
    // 30 (price) + 20 (model) + 15 (msg bonus, 3 msgs capped) = 65
    prisma.chatMessage.findMany.mockResolvedValue([
      message('ราคา iphone 15 ไหม'),
      message('a'),
      message('b'),
    ]);
    const result = await service.scoreSession('room-1');
    expect(result.temperature).toBe('WARM');
    expect(result.score).toBeGreaterThanOrEqual(50);
    expect(result.score).toBeLessThan(80);
  });

  it('caps score at 100', async () => {
    // Over-triggering all signals
    prisma.chatMessage.findMany.mockResolvedValue(
      Array.from({ length: 10 }, () =>
        message('ราคา iphone 15 มีสต็อกสีดำไหม สาขาเปิดกี่โมง ดาวน์เท่าไหร่'),
      ),
    );
    prisma.chatRoom.findUnique.mockResolvedValue({
      customer: { contracts: [{ id: 'c-1' }] },
    });
    const result = await service.scoreSession('room-1');
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it('persists score + temperature to ChatRoom', async () => {
    prisma.chatMessage.findMany.mockResolvedValue([message('ราคา iphone 15')]);
    await service.scoreSession('room-1');
    const args = prisma.chatRoom.update.mock.calls[0][0];
    expect(args.where.id).toBe('room-1');
    expect(args.data.leadScore).toBeDefined();
    expect(args.data.leadTemperature).toBeDefined();
  });

  it('score floor is 0 (no negative)', async () => {
    // Single meaningless message
    prisma.chatMessage.findMany.mockResolvedValue([message('...')]);
    const result = await service.scoreSession('room-1');
    expect(result.score).toBe(0);
  });
});
