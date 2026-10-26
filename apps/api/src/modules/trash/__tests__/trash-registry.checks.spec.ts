import { BadRequestException, ConflictException } from '@nestjs/common';
import { trashEntry, type TrashRestoreContext } from '../trash-registry';

/** ก้อน 8 A10 Task 4 — กติกาเฉพาะประเภทตอนกู้ (สเปก §4.1 คอลัมน์ "เงื่อนไข/ตรวจตอนกู้" + §13.2) */
const NOW = new Date('2026-10-26T03:00:00.000Z');

function tx(overrides: Record<string, Record<string, jest.Mock>> = {}) {
  const calls: string[] = [];
  const base: Record<string, unknown> = {
    $executeRaw: jest.fn(async () => { calls.push('lock'); return 1; }),
    customer: { findFirst: jest.fn(async () => { calls.push('findFirst'); return null; }) },
    booking: { findFirst: jest.fn().mockResolvedValue(null) },
    expenseDocument: { findFirst: jest.fn().mockResolvedValue(null) },
    expenseTemplate: { count: jest.fn().mockResolvedValue(0) },
    systemConfig: { findFirst: jest.fn().mockResolvedValue(null) },
    buybackChoice: { updateMany: jest.fn().mockResolvedValue({ count: 2 }) },
  };
  for (const [k, v] of Object.entries(overrides)) base[k] = { ...(base[k] as object), ...v };
  return { tx: base as never, calls, m: (k: string) => base[k] as Record<string, jest.Mock> };
}
const ctx = (t: never): TrashRestoreContext => ({ tx: t, actorId: 'u-owner' });

describe('trash registry — per-type restore rules', () => {
  it('C1 customer: the phone advisory lock is the first statement, then the duplicate check runs on the same tx', async () => {
    const h = tx();
    await trashEntry('customer')!.check!(ctx(h.tx), { id: 'c1', name: 'สมหญิง', phone: '0812345678', phoneHash: 'h1', email: null, deletedAt: NOW });
    expect(h.calls[0]).toBe('lock');
    expect(h.m('customer').findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ phoneHash: 'h1', deletedAt: null, id: { not: 'c1' } }) }));
  });

  it('C2 customer: a live customer with the same phone hash → 409 naming them, masked phone', async () => {
    const h = tx({ customer: { findFirst: jest.fn().mockResolvedValue({ id: 'c9', name: 'ประสิทธิ์ ท.' }) } });
    const err = await trashEntry('customer')!.check!(ctx(h.tx), { id: 'c1', name: 'สมหญิง', phone: '0812345678', phoneHash: 'h1', email: null, deletedAt: NOW }).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.message).toContain('ประสิทธิ์ ท.');
    expect(err.message).not.toContain('0812345678');
  });

  it('C3 customer: a live customer with the same email → 409', async () => {
    const h = tx({ customer: { findFirst: jest.fn(async ({ where }: { where: Record<string, unknown> }) => ('email' in where ? { id: 'c9', name: 'คนอีเมล' } : null)) } });
    await expect(trashEntry('customer')!.check!(ctx(h.tx), { id: 'c1', name: 'x', phone: null, phoneHash: null, email: 'a@b.co', deletedAt: NOW })).rejects.toThrow(ConflictException);
  });

  it('C4 customer afterRestore recomputes journey + tags, and warns when no chat room is bound (§13.2)', async () => {
    const services = { prisma: { chatRoom: { count: jest.fn().mockResolvedValue(0) } }, journeyState: { recompute: jest.fn().mockResolvedValue(undefined) }, tags: { recomputeForCustomer: jest.fn().mockResolvedValue({}) } };
    const warnings = await trashEntry('customer')!.afterRestore!({ id: 'c1', name: 'x', deletedAt: NOW }, services);
    expect(services.journeyState.recompute).toHaveBeenCalledWith(['c1']);
    expect(services.tags.recomputeForCustomer).toHaveBeenCalledWith('c1');
    expect(warnings.some((w) => w.includes('ห้องแชท'))).toBe(true);
    services.prisma.chatRoom.count.mockResolvedValue(1);
    expect(await trashEntry('customer')!.afterRestore!({ id: 'c1', name: 'x', deletedAt: NOW }, services)).toEqual([]);
  });

  it('C5 booking: another live booking locks the same product → 409', async () => {
    const h = tx({ booking: { findFirst: jest.fn().mockResolvedValue({ id: 'b9', bookingNumber: 'BK-9' }) } });
    await expect(trashEntry('booking')!.check!(ctx(h.tx), { id: 'b1', bookingNumber: 'BK-1', lockedProductId: 'p1', deletedAt: NOW })).rejects.toThrow(/BK-9/);
    const free = tx();
    await expect(trashEntry('booking')!.check!(ctx(free.tx), { id: 'b1', bookingNumber: 'BK-1', lockedProductId: null, deletedAt: NOW })).resolves.toBeUndefined();
    expect(free.m('booking').findFirst).not.toHaveBeenCalled();
  });

  it('C6 expense document: non-draft → 400; number re-issued → 409', async () => {
    const h = tx();
    await expect(trashEntry('expense_document')!.check!(ctx(h.tx), { id: 'e1', number: 'EX-1', status: 'POSTED', deletedAt: NOW })).rejects.toThrow(BadRequestException);
    const dup = tx({ expenseDocument: { findFirst: jest.fn().mockResolvedValue({ id: 'e9' }) } });
    await expect(trashEntry('expense_document')!.check!(ctx(dup.tx), { id: 'e1', number: 'EX-1', status: 'DRAFT', deletedAt: NOW })).rejects.toThrow(/EX-1/);
    await expect(trashEntry('other_income')!.check!(ctx(h.tx), { id: 'o1', status: 'POSTED', deletedAt: NOW })).rejects.toThrow(BadRequestException);
    await expect(trashEntry('fixed_asset')!.check!(ctx(h.tx), { id: 'a1', status: 'POSTED', deletedAt: NOW })).rejects.toThrow(BadRequestException);
  });

  it('C7 expense template: owner already at quota → 409 with the cap', async () => {
    const h = tx({ expenseTemplate: { count: jest.fn().mockResolvedValue(2) }, systemConfig: { findFirst: jest.fn().mockResolvedValue({ value: '2' }) } });
    await expect(trashEntry('expense_template')!.check!(ctx(h.tx), { id: 't1', name: 'x', createdById: 'u1', deletedAt: NOW })).rejects.toThrow(/2/);
    expect(h.m('expenseTemplate').count).toHaveBeenCalledWith({ where: { createdById: 'u1', deletedAt: null } });
  });

  it('C8 buyback question: choices deleted at the same instant come back with it', async () => {
    const h = tx();
    await trashEntry('buyback_question')!.restoreExtra!(ctx(h.tx), { id: 'q1', key: 'k', title: 't', deletedAt: NOW });
    expect(h.m('buybackChoice').updateMany).toHaveBeenCalledWith({ where: { questionId: 'q1', deletedAt: NOW }, data: { deletedAt: null } });
  });
});
