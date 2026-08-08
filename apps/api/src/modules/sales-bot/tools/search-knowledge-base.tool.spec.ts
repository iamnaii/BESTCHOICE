import { PrismaService } from '../../../prisma/prisma.service';
import { SearchKnowledgeBaseTool } from './search-knowledge-base.tool';

const entry = (over: Record<string, unknown> = {}) => ({
  intent: 'shop_hours',
  category: 'general',
  responseTemplate: 'เปิด 10:00-20:00 ทุกวัน',
  responseType: 'info',
  triggerKeywords: ['เปิดกี่โมง', 'เวลาเปิด'],
  exampleQuestions: ['ร้านเปิดกี่โมง'],
  priority: 5,
  ...over,
});

const makePrisma = (rows: unknown[]) =>
  ({ chatKnowledgeBase: { findMany: jest.fn().mockResolvedValue(rows) } }) as unknown as PrismaService;

describe('SearchKnowledgeBaseTool.run', () => {
  it('ดึง FAQ ของช่องบอทขาย + FAQ กลาง (channel = null)', async () => {
    const prisma = makePrisma([]);
    await new SearchKnowledgeBaseTool(prisma).run({ query: 'เปิดกี่โมง' });
    const where = (prisma.chatKnowledgeBase.findMany as jest.Mock).mock.calls[0][0].where;
    expect(where).toEqual({
      OR: [{ channel: null }, { channel: { in: ['LINE_SHOP', 'FACEBOOK', 'WEB'] } }],
      active: true,
      deletedAt: null,
    });
  });

  it('คืน match ที่สกอร์แล้ว', async () => {
    const r = await new SearchKnowledgeBaseTool(makePrisma([entry()])).run({ query: 'ร้านเปิดกี่โมง' });
    expect(r.matches[0].intent).toBe('shop_hours');
    expect(r.matches[0].responseTemplate).toContain('10:00');
  });

  it('คำค้นว่าง → ไม่ยิง DB', async () => {
    const prisma = makePrisma([entry()]);
    const r = await new SearchKnowledgeBaseTool(prisma).run({ query: '  ' });
    expect(r.matches).toEqual([]);
    expect(prisma.chatKnowledgeBase.findMany).not.toHaveBeenCalled();
  });

  it('ไม่มี FAQ ตรงเลย → matches ว่าง (ไม่ throw)', async () => {
    const r = await new SearchKnowledgeBaseTool(makePrisma([entry()])).run({ query: 'ผ่อนไอโฟน' });
    expect(r.matches).toEqual([]);
  });
});
