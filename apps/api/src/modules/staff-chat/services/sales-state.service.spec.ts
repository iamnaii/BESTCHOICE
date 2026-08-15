import { Prisma } from '@prisma/client';
import { SalesStateService, SalesState } from './sales-state.service';

describe('SalesStateService', () => {
  function build() {
    const prisma = {
      chatRoom: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const svc = new SalesStateService(prisma as any);
    const create = jest.fn();
    // ยัด client ปลอมแทน lazy `new Anthropic()` — spec ห้ามยิง API จริง
    (svc as any)._client = { messages: { create } };
    return { svc, prisma, create };
  }

  describe('buildNote', () => {
    it('คืน null เมื่อไม่มีสถานะ หรือสถานะว่างเปล่า', () => {
      const { svc } = build();
      expect(svc.buildNote(null)).toBeNull();
      expect(svc.buildNote({} as SalesState)).toBeNull();
      expect(svc.buildNote({ interestModel: null, updatedAt: new Date().toISOString() })).toBeNull();
    });

    it('รวมช่องที่มีค่าเป็นบรรทัด พร้อมหัวโน้ตห้ามเอ่ยถึง', () => {
      const { svc } = build();
      const note = svc.buildNote({
        interestModel: 'iPhone 15 Plus 128GB มือสอง',
        downBudget: 3000,
        chosenRate: 'เรทที่ 1',
        offered: ['iPhone 14'],
      });
      expect(note).toContain('ห้ามเอ่ยถึงบันทึกนี้กับลูกค้า');
      expect(note).toContain('iPhone 15 Plus 128GB มือสอง');
      expect(note).toContain('3,000 บาท');
      expect(note).toContain('เรทที่ 1');
      expect(note).toContain('iPhone 14');
    });

    it('เติมอายุโน้ตเมื่อคุยล่าสุดนานแล้ว (ข้ามวัน = หน่วยวัน)', () => {
      const { svc } = build();
      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 3_600_000).toISOString();
      const note = svc.buildNote({ interestModel: 'iPhone 13', updatedAt: threeDaysAgo });
      expect(note).toContain('คุยล่าสุดเมื่อ 3 วันก่อน');
      // เพิ่งคุย (< 2 ชม.) → ไม่ใส่อายุ
      const fresh = svc.buildNote({
        interestModel: 'iPhone 13',
        updatedAt: new Date().toISOString(),
      });
      expect(fresh).not.toContain('คุยล่าสุด');
    });
  });

  describe('load / clear', () => {
    it('load อ่าน aiSalesState จากห้อง และคืน null เมื่อ query พัง', async () => {
      const { svc, prisma } = build();
      prisma.chatRoom.findUnique.mockResolvedValueOnce({
        aiSalesState: { interestModel: 'iPhone 12' },
      });
      expect(await svc.load('r1')).toEqual({ interestModel: 'iPhone 12' });
      prisma.chatRoom.findUnique.mockRejectedValueOnce(new Error('db down'));
      expect(await svc.load('r1')).toBeNull();
    });

    it('clear ตั้งค่าเป็น DbNull และกลืน error (ไม่ throw)', async () => {
      const { svc, prisma } = build();
      await svc.clear('r1');
      expect(prisma.chatRoom.update).toHaveBeenCalledWith({
        where: { id: 'r1' },
        data: { aiSalesState: Prisma.DbNull },
      });
      prisma.chatRoom.update.mockRejectedValueOnce(new Error('db down'));
      await expect(svc.clear('r1')).resolves.toBeUndefined();
    });
  });

  describe('extractAndSave', () => {
    it('parse JSON จากคำตอบ Haiku (มีข้อความหุ้ม) แล้วบันทึกพร้อม updatedAt', async () => {
      const { svc, prisma, create } = build();
      create.mockResolvedValue({
        content: [
          {
            type: 'text',
            text: 'นี่คือสถานะ:\n{"interestModel":"iPhone 15 Plus 128GB","downBudget":3000}',
          },
        ],
      });
      await svc.extractAndSave('r1', { interestModel: 'iPhone 15 Plus' }, 'งบ 3000', 'รับทราบค่ะ');
      expect(prisma.chatRoom.update).toHaveBeenCalledTimes(1);
      const saved = prisma.chatRoom.update.mock.calls[0][0].data.aiSalesState;
      expect(saved.interestModel).toBe('iPhone 15 Plus 128GB');
      expect(saved.downBudget).toBe(3000);
      expect(typeof saved.updatedAt).toBe('string');
      // สถานะเดิมถูกส่งให้ Haiku ใช้ merge
      const userMsg = create.mock.calls[0][0].messages[0].content;
      expect(userMsg).toContain('iPhone 15 Plus');
      expect(userMsg).toContain('งบ 3000');
    });

    it('Haiku ไม่คืน JSON → ไม่บันทึกอะไร ไม่ throw', async () => {
      const { svc, prisma, create } = build();
      create.mockResolvedValue({ content: [{ type: 'text', text: 'ขอโทษค่ะ ตอบไม่ได้' }] });
      await expect(svc.extractAndSave('r1', null, 'x', 'y')).resolves.toBeUndefined();
      expect(prisma.chatRoom.update).not.toHaveBeenCalled();
    });

    it('API พัง → กลืน error (fire-and-forget ห้ามทำให้เทิร์นหลักล้ม)', async () => {
      const { svc, prisma, create } = build();
      create.mockRejectedValue(new Error('overloaded'));
      await expect(svc.extractAndSave('r1', null, 'x', 'y')).resolves.toBeUndefined();
      expect(prisma.chatRoom.update).not.toHaveBeenCalled();
    });
  });
});
