import { BadGatewayException, BadRequestException } from '@nestjs/common';
import { GfinLineGroupService } from '../services/gfin-line-group.service';
import { LineFinanceNotConfiguredError } from '../../chatbot-finance/services/line-finance-client.service';

const company = { id: 'gfin-1', name: 'GFIN', lineGroupId: 'C1', precheckTemplate: null };
function make(over: { company?: unknown; row?: unknown; configured?: boolean } = {}) {
  const prisma: any = {
    externalFinanceCompany: { findFirst: jest.fn().mockResolvedValue(over.company === undefined ? company : over.company), update: jest.fn().mockResolvedValue({}) },
    user: { findUnique: jest.fn().mockResolvedValue({ name: 'สมชาย' }) },
  };
  const lineFinance = { isConfigured: jest.fn().mockResolvedValue(over.configured ?? true), pushMessageStrict: jest.fn().mockResolvedValue({ requestId: 'req-1' }) };
  const memberships = {
    find: jest.fn().mockResolvedValue(over.row === undefined ? { groupId: 'C1', groupName: 'GFIN : BESTCHOICE', leftAt: null } : over.row),
    list: jest.fn().mockResolvedValue([{ groupId: 'C1', groupName: 'GFIN : BESTCHOICE', pictureUrl: null, memberCount: 4, joinedAt: new Date('2026-09-25'), leftAt: null }]),
  };
  return { prisma, lineFinance, memberships, service: new GfinLineGroupService(prisma, lineFinance as never, memberships as never) };
}

describe('GfinLineGroupService.status', () => {
  it('linked + bot in group + token → ready', async () => {
    await expect(make().service.status()).resolves.toEqual({ groupId: 'C1', groupName: 'GFIN : BESTCHOICE', botInGroup: true, tokenConfigured: true, ready: true, reason: null });
  });
  it('no lineGroupId → NOT_LINKED', async () => {
    await expect(make({ company: { ...company, lineGroupId: null } }).service.status()).resolves.toEqual(expect.objectContaining({ ready: false, reason: 'NOT_LINKED', groupId: null }));
  });
  it('bot left → BOT_LEFT (name still shown)', async () => {
    await expect(make({ row: { groupId: 'C1', groupName: 'เก่า', leftAt: new Date() } }).service.status()).resolves.toEqual(expect.objectContaining({ ready: false, reason: 'BOT_LEFT', groupName: 'เก่า', botInGroup: false }));
  });
  it('no token → NO_TOKEN', async () => {
    await expect(make({ configured: false }).service.status()).resolves.toEqual(expect.objectContaining({ ready: false, reason: 'NO_TOKEN' }));
  });
});

describe('GfinLineGroupService.requireSendTarget / pushText', () => {
  it('not ready → 400 with the reason and the copy fallback hint', async () => {
    await expect(make({ row: { leftAt: new Date(), groupName: 'x' } }).service.requireSendTarget()).rejects.toThrow(/บอท OA ไฟแนนซ์ไม่อยู่ในกลุ่มแล้ว.*คัดลอกข้อความ/);
  });
  it('pushText sends one text message and returns the request id', async () => {
    const { lineFinance, service } = make();
    await expect(service.pushText('C1', 'สวัสดี')).resolves.toEqual({ requestId: 'req-1' });
    expect(lineFinance.pushMessageStrict).toHaveBeenCalledWith('C1', [{ type: 'text', text: 'สวัสดี' }]);
  });
  it('pushText: over 5,000 chars → 400 before calling LINE', async () => {
    const { lineFinance, service } = make();
    await expect(service.pushText('C1', 'x'.repeat(5001))).rejects.toBeInstanceOf(BadRequestException);
    expect(lineFinance.pushMessageStrict).not.toHaveBeenCalled();
  });
  it('pushText: LINE error → 502 · missing token → 400', async () => {
    const { lineFinance, service } = make();
    lineFinance.pushMessageStrict.mockRejectedValueOnce(new Error('LINE API 500: boom'));
    await expect(service.pushText('C1', 'x')).rejects.toBeInstanceOf(BadGatewayException);
    lineFinance.pushMessageStrict.mockRejectedValueOnce(new LineFinanceNotConfiguredError());
    await expect(service.pushText('C1', 'x')).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('GfinLineGroupService.updateSettings', () => {
  it('links a group the bot is in and stores a valid template', async () => {
    const { prisma, service } = make();
    await service.updateSettings({ lineGroupId: 'C1', precheckTemplate: 'เช็ค {{customerName}} {{link}}' });
    expect(prisma.externalFinanceCompany.update).toHaveBeenCalledWith({ where: { id: 'gfin-1' }, data: { lineGroupId: 'C1', precheckTemplate: 'เช็ค {{customerName}} {{link}}' } });
  });
  it('unknown group → 400 · group the bot left → 400', async () => {
    await expect(make({ row: null }).service.updateSettings({ lineGroupId: 'Cx' })).rejects.toThrow(/ไม่พบกลุ่มนี้/);
    await expect(make({ row: { leftAt: new Date() } }).service.updateSettings({ lineGroupId: 'C1' })).rejects.toThrow(/ออกจากกลุ่มนี้แล้ว/);
  });
  it('template without {{link}} / with a typo placeholder → 400 naming the problem', async () => {
    await expect(make().service.updateSettings({ precheckTemplate: 'ไม่มีลิงก์' })).rejects.toThrow(/\{\{link\}\}/);
    await expect(make().service.updateSettings({ precheckTemplate: '{{cusomerName}} {{link}}' })).rejects.toThrow(/\{\{cusomerName\}\}/);
  });
  it('empty template → null (back to the built-in default) · lineGroupId null → unlink', async () => {
    const { prisma, service } = make();
    await service.updateSettings({ lineGroupId: null, precheckTemplate: '   ' });
    expect(prisma.externalFinanceCompany.update).toHaveBeenCalledWith({ where: { id: 'gfin-1' }, data: { lineGroupId: null, precheckTemplate: null } });
  });
});

describe('GfinLineGroupService.sendTestMessage', () => {
  it('pushes a test text naming the staff member to the linked group', async () => {
    const { lineFinance, service } = make();
    await expect(service.sendTestMessage({ id: 'u1', role: 'OWNER', name: null })).resolves.toEqual({ ok: true, groupName: 'GFIN : BESTCHOICE', requestId: 'req-1' });
    expect(lineFinance.pushMessageStrict.mock.calls[0][1][0].text).toMatch(/ทดสอบการเชื่อมต่อจาก BESTCHOICE[\s\S]*ส่งโดย สมชาย/);
  });
});
