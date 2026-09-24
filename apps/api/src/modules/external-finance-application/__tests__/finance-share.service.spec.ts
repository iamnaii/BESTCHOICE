import { ConflictException, NotFoundException } from '@nestjs/common';
import { FinanceShareService } from '../services/finance-share.service';
import { hashShareToken } from '../finance-share-token.util';

const raw = 'a'.repeat(43);
const future = new Date(Date.now() + 86400000);
const past = new Date(Date.now() - 1000);
const app = (over: Record<string, unknown> = {}) => ({
  id: 'app-1', number: 'BC-260924-001', status: 'SENT', shareTokenHash: hashShareToken(raw), shareExpiresAt: future, shareRevokedAt: null, filesPurgedAt: null,
  messageText: 'ข้อความ', shareViewCount: 0, shareLastViewedAt: null,
  files: [{ id: 'f1', slot: 'ID_CARD', mimeType: 'image/jpeg', size: 10, originalName: 'a.jpg', storageKey: 'k1', sortOrder: 0 }],
  events: [], ...over,
});
function makePrisma(row: any) {
  const update = jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...row, ...data }));
  // updateMany เดียวกันทั้ง top-level และภายใน $transaction (ปิด closure ตัวเดียว) — CAS ของ
  // reply() ใช้ updateMany({where:{id,status,deletedAt:null}}) แทน update() ธรรมดา (fix round 1
  // Important 3); ค่าเริ่มต้น count:1 = "แถวยังเป็นสถานะที่อ่านไว้" ส่วนเทส TOCTOU override เป็น 0
  const updateMany = jest.fn().mockResolvedValue({ count: 1 });
  const eventCreate = jest.fn().mockResolvedValue({});
  return {
    externalFinanceApplication: { findFirst: jest.fn().mockResolvedValue(row), update, updateMany },
    externalFinanceApplicationEvent: { create: eventCreate, findFirst: jest.fn().mockResolvedValue(null) },
    $transaction: (fn: any) => fn({ externalFinanceApplication: { findFirst: jest.fn().mockResolvedValue(row), update, updateMany }, externalFinanceApplicationEvent: { create: eventCreate } }),
  } as any;
}
const storage = { getStream: jest.fn().mockResolvedValue({ pipe: jest.fn() }) } as any;
const notify = { partnerReplied: jest.fn().mockResolvedValue(undefined) } as any;

describe('FinanceShareService.resolve', () => {
  it('returns OK for a live token and the same GONE shape for unknown / expired / revoked / purged', async () => {
    expect((await new FinanceShareService(makePrisma(app()), storage, notify).resolve(raw)).state).toBe('OK');
    expect(await new FinanceShareService(makePrisma(null), storage, notify).resolve('x')).toEqual({ state: 'GONE', reason: 'NOT_FOUND' });
    expect(await new FinanceShareService(makePrisma(app({ shareExpiresAt: past })), storage, notify).resolve(raw)).toEqual({ state: 'GONE', reason: 'EXPIRED' });
    expect(await new FinanceShareService(makePrisma(app({ shareRevokedAt: past })), storage, notify).resolve(raw)).toEqual({ state: 'GONE', reason: 'REVOKED' });
    expect(await new FinanceShareService(makePrisma(app({ filesPurgedAt: past })), storage, notify).resolve(raw)).toEqual({ state: 'GONE', reason: 'PURGED' });
  });
  it('looks up by sha256 hash only — never by the raw token', async () => {
    const prisma = makePrisma(app());
    await new FinanceShareService(prisma, storage, notify).resolve(raw);
    const where = prisma.externalFinanceApplication.findFirst.mock.calls[0][0].where;
    expect(where.shareTokenHash).toBe(hashShareToken(raw));
    expect(JSON.stringify(where)).not.toContain(raw);
  });
});

describe('FinanceShareService.recordView', () => {
  it('counts a view once per ipHash within 5 minutes and stamps the application', async () => {
    const prisma = makePrisma(app());
    const service = new FinanceShareService(prisma, storage, notify);
    await service.recordView('app-1', 'iphash', 'Mozilla');
    expect(prisma.externalFinanceApplicationEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ kind: 'LINK_VIEWED', actorType: 'PARTNER' }) }));
    expect(prisma.externalFinanceApplication.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ shareViewCount: { increment: 1 } }) }));
    prisma.externalFinanceApplicationEvent.findFirst.mockResolvedValueOnce({ id: 'e1' });
    await service.recordView('app-1', 'iphash', 'Mozilla');
    expect(prisma.externalFinanceApplicationEvent.create).toHaveBeenCalledTimes(1);
  });
});

describe('FinanceShareService.reply', () => {
  it('APPROVED moves SENT → APPROVED with resultSource PARTNER_LINK, closes, and notifies staff', async () => {
    const prisma = makePrisma(app());
    const service = new FinanceShareService(prisma, storage, notify);
    const result = await service.reply(raw, { action: 'APPROVED', name: 'คุณเอ', note: 'ok' }, 'iphash');
    expect(result.status).toBe('APPROVED');
    const call = prisma.externalFinanceApplication.updateMany.mock.calls[0][0];
    expect(call.where).toMatchObject({ id: 'app-1', status: 'SENT' });
    expect(call.data).toMatchObject({ status: 'APPROVED', resultSource: 'PARTNER_LINK' });
    expect(call.data.closedAt).toBeInstanceOf(Date);
    expect(notify.partnerReplied).toHaveBeenCalledWith('app-1');
  });
  it('ACK moves SENT → ACKNOWLEDGED and stores the replier name; a second ACK only logs an event', async () => {
    const prisma = makePrisma(app());
    const service = new FinanceShareService(prisma, storage, notify);
    await service.reply(raw, { action: 'ACK', name: 'คุณเอ' }, 'h');
    expect(prisma.externalFinanceApplication.updateMany.mock.calls[0][0].data.status).toBe('ACKNOWLEDGED');
    const acked = makePrisma(app({ status: 'ACKNOWLEDGED' }));
    await new FinanceShareService(acked, storage, notify).reply(raw, { action: 'ACK', name: 'คุณเอ' }, 'h');
    expect(acked.externalFinanceApplication.updateMany.mock.calls[0][0].data.status).toBe('ACKNOWLEDGED');
  });
  it('rejects a reply on a closed application with 409 and does not change anything', async () => {
    const prisma = makePrisma(app({ status: 'APPROVED' }));
    await expect(new FinanceShareService(prisma, storage, notify).reply(raw, { action: 'REJECTED', name: 'x' }, 'iphash')).rejects.toThrow(ConflictException);
    expect(prisma.externalFinanceApplication.updateMany).not.toHaveBeenCalled();
  });
  it('reply on an expired link is 404-equivalent (GONE) — same message as unknown token', async () => {
    await expect(new FinanceShareService(makePrisma(app({ shareExpiresAt: past })), storage, notify).reply(raw, { action: 'APPROVED', name: 'x' }, 'h')).rejects.toThrow(NotFoundException);
  });
  // fix round 1 Important 3 — TOCTOU: the row's status was read outside the transaction; a
  // concurrent writer (STAFF_* result / CANCEL / a second partner reply) can change it before
  // our update lands. The CAS (updateMany matched on id+status) must reject with 409 instead of
  // blindly overwriting whatever the concurrent writer landed on.
  it('rejects with 409 when the row changed status between resolve and write (TOCTOU CAS) and logs no event', async () => {
    const prisma = makePrisma(app());
    prisma.externalFinanceApplication.updateMany.mockResolvedValueOnce({ count: 0 });
    const service = new FinanceShareService(prisma, storage, notify);
    const notifyCallsBefore = notify.partnerReplied.mock.calls.length; // `notify` is a module-level shared mock across this describe block
    await expect(service.reply(raw, { action: 'APPROVED', name: 'คุณเอ' }, 'iphash')).rejects.toThrow(ConflictException);
    expect(prisma.externalFinanceApplicationEvent.create).not.toHaveBeenCalled();
    expect(notify.partnerReplied.mock.calls.length).toBe(notifyCallsBefore);
  });
});

describe('FinanceShareService.fileStream / zipStream', () => {
  it('streams only files that belong to the resolved application', async () => {
    const service = new FinanceShareService(makePrisma(app()), storage, notify);
    await expect(service.fileStream(raw, 'f1')).resolves.toMatchObject({ file: expect.objectContaining({ id: 'f1' }) });
    await expect(service.fileStream(raw, 'other')).rejects.toThrow(NotFoundException);
  });
  it('zip filename uses the application number and names entries NN-<ป้ายช่อง>.<ext> (spec §5.2)', async () => {
    const service = new FinanceShareService(makePrisma(app()), storage, notify);
    const zip = await service.zipStream(raw);
    expect(zip.filename).toBe('BC-260924-001.zip');
    expect(zip.entries).toEqual([{ name: '01-บัตรประชาชน.jpg', storageKey: 'k1' }]);
  });
});
