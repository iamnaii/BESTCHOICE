import * as Sentry from '@sentry/nestjs';
import { BadRequestException } from '@nestjs/common';
import { StaffNotifyRulesService } from '../staff-notify-rules.service';
import { STAFF_EVENT_CATALOG, STAFF_NOTIFY_MONTHLY_CAP_KEY, STAFF_NOTIFY_RULES_KEY, catalogItem } from '../staff-event-catalog';

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn(), captureMessage: jest.fn() }));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let prisma: any;
let service: StaffNotifyRulesService;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let audit: any;
beforeEach(() => {
  jest.clearAllMocks();
  prisma = {
    systemConfig: { findFirst: jest.fn().mockResolvedValue(null), upsert: jest.fn().mockResolvedValue({}) },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };
  audit = { log: jest.fn().mockResolvedValue(undefined) };
  service = new StaffNotifyRulesService(prisma, audit);
});

describe('StaffEventCatalog', () => {
  it('has the 18 events of spec §5 + §13.4 with their default routing', () => {
    expect(STAFF_EVENT_CATALOG.map((c) => c.key)).toEqual([
      'recurring_bill', 'expense.pending_approval', 'ap.due', 'petty_cash.replenish',
      'chat.handoff', 'chat.slip_review', 'chat.slip_sla', 'chat.web_inquiry',
      'stock.low', 'cash_close.missed', 'cash_close.awaiting',
      'sale.completed', 'contract.activated',
      'overdue.owner_alert', 'auth.new_device_login',
      'report.owner_daily', 'collections.daily_summary', 'sms.credit_low',
    ]);
    expect(catalogItem('stock.low').defaults).toEqual({ enabled: true, roles: ['OWNER', 'BRANCH_MANAGER'], branchScoped: true, includeGroup: false });
    expect(catalogItem('chat.handoff')).toMatchObject({ defaults: { roles: ['OWNER', 'FINANCE_MANAGER'], includeGroup: true }, dedupeWindowHours: 1 });
    expect(catalogItem('sale.completed').defaults.enabled).toBe(false); // โควต้า §13.2
    expect(catalogItem('contract.activated').defaults.enabled).toBe(false);
    expect(catalogItem('chat.web_inquiry').defaults.enabled).toBe(false); // รีวิว I3 — ฟอร์มสาธารณะ ห้ามกินโควต้าโดยค่าเริ่มต้น
    expect(catalogItem('auth.new_device_login').dedupeWindowHours).toBe(0);
    for (const item of STAFF_EVENT_CATALOG) {
      expect(item.sample.title.length).toBeGreaterThan(0);
      expect(item.group.length).toBeGreaterThan(0);
    }
    expect(() => catalogItem('nope' as never)).toThrow(/ไม่รู้จักเหตุการณ์/);
  });
});

describe('StaffNotifyRulesService', () => {
  it('R1 no row → every key = catalog defaults', async () => {
    const rules = await service.getEffectiveRules();
    expect(Object.keys(rules)).toHaveLength(18);
    expect(await service.getRule('stock.low')).toEqual({ enabled: true, roles: ['OWNER', 'BRANCH_MANAGER'], branchScoped: true, includeGroup: false });
    expect(prisma.systemConfig.findFirst).toHaveBeenCalledWith({ where: { key: STAFF_NOTIFY_RULES_KEY, deletedAt: null }, select: { value: true } });
  });

  it('R2 stored row merges over defaults per key only', async () => {
    prisma.systemConfig.findFirst.mockResolvedValue({ value: JSON.stringify({ 'stock.low': { enabled: false, roles: ['OWNER'] } }) });
    const rules = await service.getEffectiveRules();
    expect(rules['stock.low']).toEqual({ enabled: false, roles: ['OWNER'], branchScoped: true, includeGroup: false });
    expect(rules['chat.handoff']).toEqual(catalogItem('chat.handoff').defaults);
  });

  it('R3 corrupt value → defaults + Sentry; unknown keys and roles are dropped silently', async () => {
    prisma.systemConfig.findFirst.mockResolvedValue({ value: 'not json' });
    const rules = await service.getEffectiveRules();
    expect(rules['stock.low']).toEqual(catalogItem('stock.low').defaults);
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
    prisma.systemConfig.findFirst.mockResolvedValue({ value: JSON.stringify({ 'foo.bar': { enabled: true }, 'stock.low': { roles: ['VIEWER', 'OWNER'] } }) });
    const rules2 = await service.getEffectiveRules();
    expect((rules2 as Record<string, unknown>)['foo.bar']).toBeUndefined();
    expect(rules2['stock.low'].roles).toEqual(['OWNER']);
  });

  it('R4 saveRules validates, stores all 18 keys and audits', async () => {
    const saved = await service.saveRules({ 'stock.low': { enabled: true, roles: ['OWNER', 'SALES'], branchScoped: false, includeGroup: false } }, 'u1');
    expect(saved['stock.low']).toEqual({ enabled: true, roles: ['OWNER', 'SALES'], branchScoped: false, includeGroup: false });
    const upsert = prisma.systemConfig.upsert.mock.calls[0][0];
    expect(upsert.where).toEqual({ key: STAFF_NOTIFY_RULES_KEY });
    const stored = JSON.parse(upsert.create.value);
    expect(Object.keys(stored)).toHaveLength(18);
    expect(stored['chat.handoff']).toEqual(catalogItem('chat.handoff').defaults);
    expect(upsert.update).toMatchObject({ value: upsert.create.value, deletedAt: null });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'STAFF_NOTIFY_RULES_UPDATED', entity: 'system_config', entityId: STAFF_NOTIFY_RULES_KEY, userId: 'u1' }));
  });

  it('R5 invalid input → 400 with Thai message, nothing written', async () => {
    await expect(service.saveRules({ nope: { enabled: true, roles: [], branchScoped: false, includeGroup: false } }, 'u1')).rejects.toThrow(/ไม่รู้จักเหตุการณ์/);
    await expect(service.saveRules({ 'stock.low': { enabled: true, roles: ['VIEWER'], branchScoped: false, includeGroup: false } }, 'u1')).rejects.toThrow(/บทบาท/);
    await expect(service.saveRules({ 'stock.low': { enabled: 'yes', roles: [], branchScoped: false, includeGroup: false } }, 'u1')).rejects.toThrow(BadRequestException);
    await expect(service.saveRules('x', 'u1')).rejects.toThrow(BadRequestException);
    expect(prisma.systemConfig.upsert).not.toHaveBeenCalled();
  });

  it('R6 monthly cap: default 280, reads stored, validates 1–100000, writes + audits', async () => {
    expect(await service.getMonthlyCap()).toBe(280);
    prisma.systemConfig.findFirst.mockResolvedValue({ value: '150' });
    expect(await service.getMonthlyCap()).toBe(150);
    prisma.systemConfig.findFirst.mockResolvedValue({ value: 'abc' });
    expect(await service.getMonthlyCap()).toBe(280);
    await expect(service.saveMonthlyCap(0, 'u1')).rejects.toThrow(BadRequestException);
    await expect(service.saveMonthlyCap(100001, 'u1')).rejects.toThrow(BadRequestException);
    await service.saveMonthlyCap(500, 'u1');
    expect(prisma.systemConfig.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { key: STAFF_NOTIFY_MONTHLY_CAP_KEY }, create: expect.objectContaining({ value: '500' }) }));
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'STAFF_NOTIFY_CAP_UPDATED', entityId: STAFF_NOTIFY_MONTHLY_CAP_KEY }));
  });
});
