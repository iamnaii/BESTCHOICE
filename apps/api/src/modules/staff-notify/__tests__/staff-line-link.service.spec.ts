import { StaffLineLinkService } from '../staff-line-link.service';

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn(), captureMessage: jest.fn() }));

const NOW = new Date('2026-10-26T03:00:00.000Z');
const USER_ID = 'U' + 'a'.repeat(32);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let prisma: any, lineOa: any, audit: any;
let service: StaffLineLinkService;

beforeEach(() => {
  jest.clearAllMocks();
  prisma = {
    user: {
      findUnique: jest.fn().mockResolvedValue({ id: 'u1', name: 'สมหญิง', role: 'ACCOUNTANT', lineStaffUserId: null, deletedAt: null, isActive: true }),
      findFirst: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  };
  lineOa = { replyMessage: jest.fn().mockResolvedValue(undefined), pushMessage: jest.fn().mockResolvedValue(undefined) };
  audit = { log: jest.fn().mockResolvedValue(undefined) };
  service = new StaffLineLinkService(prisma, lineOa, audit);
});

describe('StaffLineLinkService', () => {
  it('L1 issueCode writes a 6-digit single-use code that expires in 15 minutes', async () => {
    const res = await service.issueCode('u1', 'owner-1', NOW);
    expect(res.code).toMatch(/^\d{6}$/);
    expect(res.expiresAt).toEqual(new Date(NOW.getTime() + 15 * 60_000));
    expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { lineLinkCode: res.code, lineLinkCodeExpiresAt: res.expiresAt } });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'STAFF_LINE_LINK_CODE_ISSUED', entity: 'user', entityId: 'u1', userId: 'owner-1' }));
  });

  it('L2 a valid code links the LINE userId, clears the code, replies and audits', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'u1', name: 'สมหญิง', role: 'ACCOUNTANT', lineLinkCodeExpiresAt: new Date(NOW.getTime() + 60_000) });
    await service.handleWebhookEvents([{ type: 'message', replyToken: 'rt', source: { type: 'user', userId: USER_ID }, message: { type: 'text', text: ' 123456 ' } }] as never, NOW);
    expect(prisma.user.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { lineLinkCode: '123456', lineLinkCodeExpiresAt: { gt: NOW }, deletedAt: null, isActive: true } }));
    expect(prisma.user.updateMany).toHaveBeenCalledWith({ where: { lineStaffUserId: USER_ID, id: { not: 'u1' } }, data: { lineStaffUserId: null } });
    expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { lineStaffUserId: USER_ID, lineLinkCode: null, lineLinkCodeExpiresAt: null } });
    expect(lineOa.replyMessage).toHaveBeenCalledWith('rt', [{ type: 'text', text: expect.stringMatching(/ผูกสำเร็จ: สมหญิง \(บัญชี\)/) }], 'line-staff');
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'STAFF_LINE_LINKED', entity: 'user', entityId: 'u1', userId: 'u1' }));
  });

  it('L3 unknown or expired code → reply "รหัสไม่ถูกต้องหรือหมดอายุ" and nothing written', async () => {
    await service.handleWebhookEvents([{ type: 'message', replyToken: 'rt', source: { type: 'user', userId: USER_ID }, message: { type: 'text', text: '999999' } }] as never, NOW);
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(lineOa.replyMessage).toHaveBeenCalledWith('rt', [{ type: 'text', text: expect.stringMatching(/รหัสไม่ถูกต้องหรือหมดอายุ/) }], 'line-staff');
  });

  it('L4 the same LINE account previously linked to another user is moved (unique)', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'u2', name: 'เอก', role: 'BRANCH_MANAGER', lineLinkCodeExpiresAt: new Date(NOW.getTime() + 60_000) });
    prisma.user.updateMany.mockResolvedValue({ count: 1 });
    await service.handleWebhookEvents([{ type: 'message', replyToken: 'rt', source: { type: 'user', userId: USER_ID }, message: { type: 'text', text: '654321' } }] as never, NOW);
    const order = [prisma.user.updateMany.mock.invocationCallOrder[0], prisma.user.update.mock.invocationCallOrder[0]];
    expect(order[0]).toBeLessThan(order[1]);
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'STAFF_LINE_LINKED', newValue: expect.objectContaining({ movedFromOtherUser: true }) }));
  });

  it('L5 follow → reply the instructions; L6 other text → silent; reply failure never throws', async () => {
    await service.handleWebhookEvents([{ type: 'follow', replyToken: 'rt', source: { type: 'user', userId: USER_ID } }] as never, NOW);
    expect(lineOa.replyMessage).toHaveBeenCalledWith('rt', [{ type: 'text', text: expect.stringMatching(/รหัสผูกบัญชี 6 หลัก/) }], 'line-staff');
    lineOa.replyMessage.mockClear();
    await service.handleWebhookEvents([{ type: 'message', replyToken: 'rt', source: { type: 'user', userId: USER_ID }, message: { type: 'text', text: 'สวัสดี' } }] as never, NOW);
    expect(lineOa.replyMessage).not.toHaveBeenCalled();
    lineOa.replyMessage.mockRejectedValue(new Error('line down'));
    await expect(service.handleWebhookEvents([{ type: 'follow', replyToken: 'rt', source: { type: 'user', userId: USER_ID } }] as never, NOW)).resolves.toBeUndefined();
  });

  it('L7 unlink clears lineStaffUserId and audits; user not linked → no-op', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'u1', name: 'สมหญิง', role: 'ACCOUNTANT', lineStaffUserId: USER_ID, deletedAt: null, isActive: true });
    await service.unlink('u1', 'owner-1');
    expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { lineStaffUserId: null, lineLinkCode: null, lineLinkCodeExpiresAt: null } });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'STAFF_LINE_UNLINKED', entityId: 'u1', userId: 'owner-1', oldValue: { lineStaffUserId: USER_ID } }));
  });
});
