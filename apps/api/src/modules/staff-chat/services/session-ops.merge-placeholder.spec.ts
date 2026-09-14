import { BadRequestException, ConflictException } from '@nestjs/common';
import { SessionOpsService } from './session-ops.service';

const real = { acquisitionSource: null, phone: '0812345678', nationalId: null, deletedAt: null };
const ph = (src = 'CHAT_FACEBOOK') => ({ acquisitionSource: src, phone: null, nationalId: null, deletedAt: null });

function build(primary: any, secondary: any) {
  const tx: any = {
    chatMessage: { updateMany: jest.fn().mockResolvedValue({}), count: jest.fn().mockResolvedValue(0) },
    chatNote: { updateMany: jest.fn().mockResolvedValue({}) },
    conversationTag: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn(), delete: jest.fn() },
    chatRoom: { findUnique: jest.fn().mockResolvedValue({ waitingSince: null }), update: jest.fn().mockResolvedValue({}) },
  };
  const prisma: any = {
    chatRoom: { findFirst: jest.fn(({ where }: any) => Promise.resolve(where.id === 'p' ? primary : secondary)) },
    $transaction: jest.fn((fn: any) => fn(tx)),
  };
  const merge = { absorbPlaceholder: jest.fn().mockResolvedValue({}) };
  return { service: new SessionOpsService(prisma, merge as any), merge, tx, prisma };
}

describe('mergeRooms กับผู้สนใจอัตโนมัติ', () => {
  it('ห้องรองถือ placeholder, ห้องหลักคนจริง → absorb รองเข้าหลัก แล้วรวมห้องต่อ', async () => {
    const { service, merge, tx } = build(
      { id: 'p', customerId: 'c-real', customer: real, createdAt: new Date('2026-01-01') },
      { id: 's', customerId: 'c-ph', customer: ph(), createdAt: new Date('2026-02-01') },
    );
    await service.mergeRooms('p', 's');
    expect(merge.absorbPlaceholder).toHaveBeenCalledWith('c-ph', 'c-real', { id: 'system', role: 'SYSTEM' }, { allowPlaceholderTarget: true });
    expect(tx.chatRoom.update).toHaveBeenCalledWith({ where: { id: 's' }, data: { deletedAt: expect.any(Date) } });
  });
  it('ห้องหลักถือ placeholder, ห้องรองคนจริง → absorb หลักเข้าคนของห้องรอง', async () => {
    const { service, merge } = build(
      { id: 'p', customerId: 'c-ph', customer: ph(), createdAt: new Date('2026-01-01') },
      { id: 's', customerId: 'c-real', customer: real, createdAt: new Date('2026-02-01') },
    );
    await service.mergeRooms('p', 's');
    expect(merge.absorbPlaceholder).toHaveBeenCalledWith('c-ph', 'c-real', { id: 'system', role: 'SYSTEM' }, { allowPlaceholderTarget: true });
  });
  it('placeholder ทั้งคู่ → ใหม่กว่าเข้าเก่ากว่า', async () => {
    const { service, merge } = build(
      { id: 'p', customerId: 'c-old', customer: ph(), createdAt: new Date('2026-01-01') },
      { id: 's', customerId: 'c-new', customer: ph('CHAT_LINE_SHOP'), createdAt: new Date('2026-02-01') },
    );
    await service.mergeRooms('p', 's');
    expect(merge.absorbPlaceholder).toHaveBeenCalledWith('c-new', 'c-old', { id: 'system', role: 'SYSTEM' }, { allowPlaceholderTarget: true });
  });
  it('คนจริงคนละคน → 400 เหมือนเดิม', async () => {
    const { service, merge } = build(
      { id: 'p', customerId: 'c1', customer: real, createdAt: new Date() },
      { id: 's', customerId: 'c2', customer: { ...real, phone: '0899999999' }, createdAt: new Date() },
    );
    await expect(service.mergeRooms('p', 's')).rejects.toBeInstanceOf(BadRequestException);
    expect(merge.absorbPlaceholder).not.toHaveBeenCalled();
  });
  it('absorb ชนข้อจำกัด (409) → โยน error ต่อ ไม่รวมห้อง', async () => {
    const { service, merge, prisma, tx } = build(
      { id: 'p', customerId: 'c-real', customer: real, createdAt: new Date('2026-01-01') },
      { id: 's', customerId: 'c-ph', customer: ph(), createdAt: new Date('2026-02-01') },
    );
    const conflict = new ConflictException('รวมไม่ได้: ผู้สนใจคนนี้มีสัญญา 1 รายการ — ให้แก้ที่รายการนั้นก่อน');
    merge.absorbPlaceholder.mockRejectedValueOnce(conflict);
    await expect(service.mergeRooms('p', 's')).rejects.toBe(conflict);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.chatRoom.update).not.toHaveBeenCalled();
  });
});
