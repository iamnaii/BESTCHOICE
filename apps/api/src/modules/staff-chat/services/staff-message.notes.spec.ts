import { Test } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { StaffMessageService } from './staff-message.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { CannedResponseVariableService } from './canned-response-variable.service';
import { CHAT_GATEWAY_TOKEN } from '../../chat-engine/interfaces/chat-gateway.interface';

/** โน้ตภายใน: เพิ่ม/ลบ/ปักหมุด ต้องยิง WS ให้คนที่เปิดห้องอยู่ · ปักได้ห้องละ 1 · ลบได้เฉพาะเจ้าของหรือผู้จัดการ */
describe('StaffMessageService — โน้ตภายใน (ลบ/ปักหมุด/WS)', () => {
  let service: StaffMessageService;
  let prisma: any;
  let gateway: { emitNoteChanged: jest.Mock; emitNewMessage: jest.Mock; emitRoomUpdate: jest.Mock; emitToStaff: jest.Mock };

  beforeEach(async () => {
    prisma = {
      chatNote: {
        create: jest.fn().mockResolvedValue({ id: 'n1', roomId: 'r1', staffId: 'u1', content: 'x' }),
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue({ id: 'n1', pinnedAt: new Date() }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      $transaction: jest.fn((ops: any[]) => Promise.all(ops)),
    };
    gateway = { emitNoteChanged: jest.fn(), emitNewMessage: jest.fn(), emitRoomUpdate: jest.fn(), emitToStaff: jest.fn() };
    const module = await Test.createTestingModule({
      providers: [
        StaffMessageService,
        { provide: PrismaService, useValue: prisma },
        { provide: CannedResponseVariableService, useValue: {} },
        { provide: CHAT_GATEWAY_TOKEN, useValue: gateway },
      ],
    }).compile();
    service = module.get(StaffMessageService);
  });

  it('addNote → บันทึกแล้วยิง chat:note:changed (เดิมไม่ยิงเลย เพื่อนร่วมทีมไม่เห็น)', async () => {
    await service.addNote('r1', 'u1', 'ลูกค้าจะมารับพรุ่งนี้');
    expect(prisma.chatNote.create).toHaveBeenCalledWith(expect.objectContaining({ data: { roomId: 'r1', staffId: 'u1', content: 'ลูกค้าจะมารับพรุ่งนี้' } }));
    expect(gateway.emitNoteChanged).toHaveBeenCalledWith('r1', { roomId: 'r1', action: 'added', noteId: 'n1' });
  });

  it('pinNote → ปลดหมุดอันอื่นในห้อง + ปักอันนี้ ในทรานแซกชันเดียว แล้วยิง WS', async () => {
    prisma.chatNote.findFirst.mockResolvedValue({ id: 'n2' });
    await service.pinNote('r1', 'n2', 'u1');
    expect(prisma.$transaction).toHaveBeenCalled();
    expect(prisma.chatNote.updateMany).toHaveBeenCalledWith({
      where: { roomId: 'r1', pinnedAt: { not: null }, id: { not: 'n2' } },
      data: { pinnedAt: null, pinnedById: null },
    });
    expect(prisma.chatNote.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'n2' }, data: { pinnedAt: expect.any(Date), pinnedById: 'u1' } }),
    );
    expect(gateway.emitNoteChanged).toHaveBeenCalledWith('r1', { roomId: 'r1', action: 'pinned', noteId: 'n2' });
  });

  it('pinNote โน้ตที่ไม่มี/คนละห้อง → 404', async () => {
    prisma.chatNote.findFirst.mockResolvedValue(null);
    await expect(service.pinNote('r1', 'nope', 'u1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('deleteNote: เจ้าของลบได้ · SALES คนอื่นลบไม่ได้ · ผู้จัดการลบได้ · ลบแล้วปลดหมุดด้วย', async () => {
    prisma.chatNote.findFirst.mockResolvedValue({ id: 'n1', staffId: 'u1' });
    await expect(service.deleteNote('r1', 'n1', { id: 'u2', role: 'SALES' })).rejects.toBeInstanceOf(ForbiddenException);
    await service.deleteNote('r1', 'n1', { id: 'u1', role: 'SALES' });
    expect(prisma.chatNote.update).toHaveBeenLastCalledWith({ where: { id: 'n1' }, data: { deletedAt: expect.any(Date), pinnedAt: null, pinnedById: null } });
    await service.deleteNote('r1', 'n1', { id: 'boss', role: 'OWNER' });
    expect(gateway.emitNoteChanged).toHaveBeenCalledWith('r1', { roomId: 'r1', action: 'deleted', noteId: 'n1' });
  });
});
