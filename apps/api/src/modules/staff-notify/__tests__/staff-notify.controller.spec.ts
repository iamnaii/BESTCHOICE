import { BadRequestException } from '@nestjs/common';
import { StaffNotifyController } from '../staff-notify.controller';
import { STAFF_EVENT_CATALOG } from '../staff-event-catalog';

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn(), captureMessage: jest.fn() }));

const owner = { id: 'u-owner', role: 'OWNER', branchId: null, name: 'เจ้าของ' };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let service: any, rules: any, lineConfig: any, link: any;
let controller: StaffNotifyController;
const RULES = Object.fromEntries(STAFF_EVENT_CATALOG.map((c) => [c.key, c.defaults]));

beforeEach(() => {
  jest.clearAllMocks();
  service = {
    usage: jest.fn().mockResolvedValue({ used: 12, cap: 280, monthKey: '2026-10' }),
    listUnlinkedUsers: jest.fn().mockResolvedValue([{ id: 'u2', name: 'สมหญิง', role: 'ACCOUNTANT', branchName: null }]),
    sendSample: jest.fn().mockResolvedValue({ recipients: 1, sent: 1, deduped: 0, failed: 0, quotaSkipped: 0 }),
    testToUser: jest.fn().mockResolvedValue({ ok: true }),
  };
  rules = {
    getEffectiveRules: jest.fn().mockResolvedValue(RULES),
    saveRules: jest.fn().mockResolvedValue(RULES),
    getMonthlyCap: jest.fn().mockResolvedValue(280),
    saveMonthlyCap: jest.fn().mockResolvedValue(500),
  };
  lineConfig = { isConfigured: jest.fn().mockResolvedValue(true), groupTargets: jest.fn().mockResolvedValue(['G1', 'G2']) };
  link = { issueCode: jest.fn().mockResolvedValue({ code: '123456', expiresAt: new Date('2026-10-26T03:15:00Z') }), unlink: jest.fn().mockResolvedValue({ ok: true }) };
  controller = new StaffNotifyController(service, rules, lineConfig, link);
});

describe('StaffNotifyController', () => {
  it('C1 GET rules → status, usage, webhook url, catalog with defaults, effective rules, unlinked users', async () => {
    const res = await controller.getRules();
    expect(res).toMatchObject({ configured: true, groupTargets: 2, usage: { used: 12, cap: 280, monthKey: '2026-10' }, monthlyCap: 280 });
    expect(res.webhookUrl).toMatch(/\/api\/webhooks\/line-staff$/);
    expect(res.catalog).toHaveLength(18);
    expect(res.catalog[0]).toMatchObject({ key: 'recurring_bill', group: 'บิลประจำ', defaults: { roles: ['OWNER', 'ACCOUNTANT'] } });
    expect(res.rules['stock.low']).toEqual(RULES['stock.low']);
    expect(res.unlinkedUsers).toEqual([{ id: 'u2', name: 'สมหญิง', role: 'ACCOUNTANT', branchName: null }]);
    expect(service.listUnlinkedUsers).toHaveBeenCalledWith(RULES);
  });

  it('C2 PUT rules forwards the body to saveRules with the actor id', async () => {
    await controller.saveRules({ rules: { 'stock.low': { enabled: false, roles: ['OWNER'], branchScoped: true, includeGroup: false } } }, owner);
    expect(rules.saveRules).toHaveBeenCalledWith({ 'stock.low': { enabled: false, roles: ['OWNER'], branchScoped: true, includeGroup: false } }, 'u-owner');
  });

  it('C3 PUT monthly-cap', async () => {
    expect(await controller.saveMonthlyCap({ cap: 500 }, owner)).toEqual({ cap: 500 });
    expect(rules.saveMonthlyCap).toHaveBeenCalledWith(500, 'u-owner');
  });

  it('C4 POST test: unknown event → 400; known → sendSample to the caller', async () => {
    await expect(controller.test({ eventKey: 'nope' }, owner)).rejects.toThrow(BadRequestException);
    expect(service.sendSample).not.toHaveBeenCalled();
    await controller.test({ eventKey: 'chat.handoff' }, owner);
    expect(service.sendSample).toHaveBeenCalledWith('chat.handoff', 'u-owner');
  });

  it('C5 POST users/:id/test · link-code · DELETE link', async () => {
    await controller.testUser('u2', owner);
    expect(service.testToUser).toHaveBeenCalledWith('u2', 'เจ้าของ');
    expect(await controller.issueLinkCode('u2', owner)).toEqual({ code: '123456', expiresAt: new Date('2026-10-26T03:15:00Z') });
    expect(link.issueCode).toHaveBeenCalledWith('u2', 'u-owner');
    await controller.unlink('u2', owner);
    expect(link.unlink).toHaveBeenCalledWith('u2', 'u-owner');
  });

  it('C6 the whole controller is OWNER-only', () => {
    expect(Reflect.getMetadata('roles', StaffNotifyController)).toEqual(['OWNER']);
  });
});
