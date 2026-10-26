import { BadRequestException, ConflictException } from '@nestjs/common';
import { hashPII } from '../../../utils/pii.util';
import { trashEntry, type TrashRestoreContext } from '../trash-registry';

/** ก้อน 8 A10 Task 4 — กติกาเฉพาะประเภทตอนกู้ (สเปก §4.1 คอลัมน์ "เงื่อนไข/ตรวจตอนกู้" + §13.2) */
const NOW = new Date('2026-10-26T03:00:00.000Z');
/** hashPII ต้องการ salt ≥ 32 ตัวอักษร — ตั้งให้ทั้งไฟล์แล้วคืนค่าเดิมตอนจบ */
const SALT = 'trash-checks-spec-salt-0123456789abcdef';
const ORIGINAL_SALT = process.env.PII_HASH_SALT;
beforeAll(() => { process.env.PII_HASH_SALT = SALT; });
afterAll(() => { if (ORIGINAL_SALT === undefined) delete process.env.PII_HASH_SALT; else process.env.PII_HASH_SALT = ORIGINAL_SALT; });

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
    expect(h.m('customer').findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ phoneHash: hashPII('0812345678', SALT), deletedAt: null, id: { not: 'c1' } }) }));
  });

  it('C2b customer: duplicate check hashes the normalized phone exactly like the lock key (not the stored hash)', async () => {
    const h = tx();
    await trashEntry('customer')!.check!(ctx(h.tx), { id: 'c1', name: 'x', phone: '081-234-5678', phoneHash: 'stale-hash', email: null, deletedAt: NOW });
    expect(h.m('customer').findFirst.mock.calls[0][0].where.phoneHash).toBe(hashPII('0812345678', SALT));
  });

  it('C2 customer: a live customer with the same phone hash → 409 naming them, masked phone', async () => {
    const h = tx({ customer: { findFirst: jest.fn().mockResolvedValue({ id: 'c9', name: 'ประสิทธิ์ ท.' }) } });
    const err = await trashEntry('customer')!.check!(ctx(h.tx), { id: 'c1', name: 'สมหญิง', phone: '0812345678', phoneHash: 'h1', email: null, deletedAt: NOW }).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.message).toContain('ประสิทธิ์ ท.');
    expect(err.message).not.toContain('0812345678');
    expect(err.message).not.toContain('รวมเป็นคนเดียวกัน');
  });

  it('C3 customer: a live customer with the same email → 409', async () => {
    const h = tx({ customer: { findFirst: jest.fn(async ({ where }: { where: Record<string, unknown> }) => ('email' in where ? { id: 'c9', name: 'คนอีเมล' } : null)) } });
    await expect(trashEntry('customer')!.check!(ctx(h.tx), { id: 'c1', name: 'x', phone: null, phoneHash: null, email: 'a@b.co', deletedAt: NOW })).rejects.toThrow(ConflictException);
  });

  it('C4 customer afterRestore recomputes journey + tags, and warns only for a chat-linked customer with no live room (§13.2)', async () => {
    const services = { prisma: { chatRoom: { count: jest.fn().mockResolvedValue(0) } }, journeyState: { recompute: jest.fn().mockResolvedValue(undefined) }, tags: { recomputeForCustomer: jest.fn().mockResolvedValue({}) } };
    const linked = { id: 'c1', name: 'x', lineIdShop: 'Uabc', lineIdFinance: null, deletedAt: NOW };
    const warnings = await trashEntry('customer')!.afterRestore!(linked, services);
    expect(services.journeyState.recompute).toHaveBeenCalledWith(['c1']);
    expect(services.tags.recomputeForCustomer).toHaveBeenCalledWith('c1');
    expect(services.prisma.chatRoom.count).toHaveBeenCalledWith({ where: { customerId: 'c1', deletedAt: null } });
    expect(warnings.some((w) => w.includes('ห้องแชท'))).toBe(true);
    services.prisma.chatRoom.count.mockResolvedValue(1);
    expect(await trashEntry('customer')!.afterRestore!(linked, services)).toEqual([]);
    services.prisma.chatRoom.count.mockResolvedValue(0);
    expect(await trashEntry('customer')!.afterRestore!({ id: 'c1', name: 'walk-in', lineIdShop: null, lineIdFinance: null, deletedAt: NOW }, services)).toEqual([]);
  });

  it('C9 interest config: another active config covering the same product category → 409; otherwise OK', async () => {
    const h = tx({ interestConfig: { findFirst: jest.fn().mockResolvedValue({ id: 'ic9', name: 'ดอกเบี้ยปัจจุบัน' }) } });
    await expect(trashEntry('interest_config')!.check!(ctx(h.tx), { id: 'ic1', name: 'เก่า', productCategories: ['PHONE_NEW'], deletedAt: NOW })).rejects.toThrow(/ดอกเบี้ยปัจจุบัน/);
    expect(h.m('interestConfig').findFirst.mock.calls[0][0].where).toMatchObject({ isActive: true, deletedAt: null, id: { not: 'ic1' }, productCategories: { hasSome: ['PHONE_NEW'] } });
    const free = tx({ interestConfig: { findFirst: jest.fn().mockResolvedValue(null) } });
    await expect(trashEntry('interest_config')!.check!(ctx(free.tx), { id: 'ic1', name: 'เก่า', productCategories: [], deletedAt: NOW })).resolves.toBeUndefined();
  });

  it('C11 expense template: recurring bills skip the quota; the quota counts only non-recurring templates', async () => {
    const h = tx({ expenseTemplate: { count: jest.fn().mockResolvedValue(99) } });
    await expect(trashEntry('expense_template')!.check!(ctx(h.tx), { id: 't1', name: 'x', createdById: 'u1', isRecurring: true, deletedAt: NOW })).resolves.toBeUndefined();
    expect(h.m('expenseTemplate').count).not.toHaveBeenCalled();
    const h2 = tx({ expenseTemplate: { count: jest.fn().mockResolvedValue(0) } });
    await trashEntry('expense_template')!.check!(ctx(h2.tx), { id: 't1', name: 'x', createdById: 'u1', isRecurring: false, deletedAt: NOW });
    expect(h2.m('expenseTemplate').count).toHaveBeenCalledWith({ where: { createdById: 'u1', deletedAt: null, isRecurring: false } });
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
    await expect(trashEntry('expense_template')!.check!(ctx(h.tx), { id: 't1', name: 'x', createdById: 'u1', isRecurring: false, deletedAt: NOW })).rejects.toThrow(/2/);
    expect(h.m('expenseTemplate').count).toHaveBeenCalledWith({ where: { createdById: 'u1', deletedAt: null, isRecurring: false } });
  });

  it('C8 buyback question: choices deleted at the same instant come back with it', async () => {
    const h = tx();
    await trashEntry('buyback_question')!.restoreExtra!(ctx(h.tx), { id: 'q1', key: 'k', title: 't', deletedAt: NOW });
    expect(h.m('buybackChoice').updateMany).toHaveBeenCalledWith({ where: { questionId: 'q1', deletedAt: NOW }, data: { deletedAt: null } });
  });
});
