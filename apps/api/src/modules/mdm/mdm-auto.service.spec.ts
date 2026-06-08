import { Test, TestingModule } from '@nestjs/testing';
import { MdmAutoService } from './mdm-auto.service';
import { PrismaService } from '../../prisma/prisma.service';
import { MdmService } from './mdm.service';
import { LineOaService } from '../line-oa/line-oa.service';
import { NotificationsService } from '../notifications/notifications.service';

jest.mock('@sentry/nestjs', () => ({
  captureMessage: jest.fn(),
  captureException: jest.fn(),
}));

import * as Sentry from '@sentry/nestjs';

/**
 * CHARACTERIZATION (golden) spec for MdmAutoService.
 *
 * SAFETY-CRITICAL behaviors pinned here:
 *  1. auto-lock fires ONLY when daysOverdue >= settings.autoLockDays (threshold guard)
 *  2. Phantom-lock guard (audit finding P1): the DB `mdmLockedAt` row is written
 *     ONLY AFTER mdmService.lockDeviceByImei() succeeds. If the MDM API call
 *     throws OR returns { success: false }, NO contract.update is issued — the DB
 *     never claims "locked" while the device is unlocked.
 *  3. auto-unlock fires ONLY when zero overdue installments remain.
 *
 * These tests assert CURRENT behavior of the existing code. They do not fix bugs.
 * Wired-ness confirmed: autoLockOverdueContracts() <- MdmAutoCron (@Cron '30 1 * * *');
 * autoUnlockAfterPayment() <- payments.service.ts (fire-and-forget). Both providers
 * registered in mdm.module.ts.
 */
describe('MdmAutoService (characterization)', () => {
  let service: MdmAutoService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mdm: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let lineOa: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let notifications: any;

  const DAY_MS = 1000 * 60 * 60 * 24;

  // Settings rows the service reads via systemConfig.findMany.
  // Helper builds the 4 rows from a plain settings object.
  const settingsRows = (s: {
    autoLockEnabled?: boolean;
    autoLockDays?: number;
    autoUnlockEnabled?: boolean;
    notifyLine?: boolean;
  }) => {
    const rows: { key: string; value: string }[] = [];
    if (s.autoLockEnabled !== undefined)
      rows.push({ key: 'mdm.autoLockEnabled', value: String(s.autoLockEnabled) });
    if (s.autoLockDays !== undefined)
      rows.push({ key: 'mdm.autoLockDays', value: String(s.autoLockDays) });
    if (s.autoUnlockEnabled !== undefined)
      rows.push({ key: 'mdm.autoUnlockEnabled', value: String(s.autoUnlockEnabled) });
    if (s.notifyLine !== undefined)
      rows.push({ key: 'mdm.notifyLine', value: String(s.notifyLine) });
    return rows;
  };

  const makeContract = (overrides: {
    daysOverdue: number;
    id?: string;
    imei?: string | null;
    contractNumber?: string;
    lineId?: string | null;
  }) => {
    const oldestDue =
      overrides.daysOverdue === null
        ? null
        : new Date(Date.now() - overrides.daysOverdue * DAY_MS);
    return {
      id: overrides.id ?? 'contract-1',
      contractNumber: overrides.contractNumber ?? 'C-0001',
      createdAt: new Date('2024-01-01'),
      mdmLockedAt: null,
      product: { id: 'prod-1', imeiSerial: overrides.imei === undefined ? '359000000000001' : overrides.imei },
      customer: {
        id: 'cust-1',
        name: 'สมชาย',
        lineIdFinance: overrides.lineId === undefined ? 'Uline123' : overrides.lineId,
      },
      payments: oldestDue ? [{ dueDate: oldestDue }] : [],
    };
  };

  beforeEach(async () => {
    (Sentry.captureMessage as jest.Mock).mockClear();
    (Sentry.captureException as jest.Mock).mockClear();

    prisma = {
      systemConfig: { findMany: jest.fn() },
      contract: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
      payment: { count: jest.fn() },
    };

    mdm = {
      lockDeviceByImei: jest.fn(),
      unlockDeviceByImei: jest.fn(),
    };

    lineOa = { pushMessage: jest.fn().mockResolvedValue(undefined) };
    notifications = { sendFromTemplate: jest.fn().mockResolvedValue(undefined) };

    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        MdmAutoService,
        { provide: PrismaService, useValue: prisma },
        { provide: MdmService, useValue: mdm },
        { provide: LineOaService, useValue: lineOa },
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile();

    service = mod.get(MdmAutoService);
  });

  // ─── getSettings ───────────────────────────────────────────

  describe('getSettings', () => {
    it('parses config rows; notifyLine defaults true, autoLockDays defaults 30', async () => {
      prisma.systemConfig.findMany.mockResolvedValue([
        { key: 'mdm.autoLockEnabled', value: 'true' },
        { key: 'mdm.autoLockDays', value: '45' },
        { key: 'mdm.autoUnlockEnabled', value: 'true' },
        // notifyLine row omitted -> default true (only 'false' disables)
      ]);

      const settings = await service.getSettings();

      expect(settings).toEqual({
        autoLockEnabled: true,
        autoLockDays: 45,
        autoUnlockEnabled: true,
        notifyLine: true,
      });
    });

    it('falls back to autoLockDays=30 when value is non-numeric/empty', async () => {
      prisma.systemConfig.findMany.mockResolvedValue([
        { key: 'mdm.autoLockDays', value: 'not-a-number' },
        { key: 'mdm.notifyLine', value: 'false' },
      ]);

      const settings = await service.getSettings();

      expect(settings.autoLockDays).toBe(30);
      expect(settings.notifyLine).toBe(false);
      expect(settings.autoLockEnabled).toBe(false);
      expect(settings.autoUnlockEnabled).toBe(false);
    });
  });

  // ─── autoLockOverdueContracts: disabled short-circuit ──────

  describe('autoLockOverdueContracts — disabled', () => {
    it('returns zeros and never queries contracts when autoLockEnabled=false', async () => {
      prisma.systemConfig.findMany.mockResolvedValue(
        settingsRows({ autoLockEnabled: false, autoLockDays: 30 }),
      );

      const result = await service.autoLockOverdueContracts();

      expect(result).toEqual({ locked: 0, skipped: 0, failed: 0 });
      expect(prisma.contract.findMany).not.toHaveBeenCalled();
      expect(mdm.lockDeviceByImei).not.toHaveBeenCalled();
    });
  });

  // ─── autoLockOverdueContracts: threshold guard ─────────────

  describe('autoLockOverdueContracts — daysOverdue threshold', () => {
    it('does NOT lock when daysOverdue is below the threshold (skipped++)', async () => {
      prisma.systemConfig.findMany.mockResolvedValue(
        settingsRows({ autoLockEnabled: true, autoLockDays: 30, notifyLine: false }),
      );
      // 29 days overdue, threshold 30 -> below
      prisma.contract.findMany.mockResolvedValue([makeContract({ daysOverdue: 29 })]);

      const result = await service.autoLockOverdueContracts();

      expect(result).toEqual({ locked: 0, skipped: 1, failed: 0 });
      expect(mdm.lockDeviceByImei).not.toHaveBeenCalled();
      expect(prisma.contract.update).not.toHaveBeenCalled();
    });

    it('locks when daysOverdue equals the threshold (>= boundary) and MDM succeeds', async () => {
      prisma.systemConfig.findMany.mockResolvedValue(
        settingsRows({ autoLockEnabled: true, autoLockDays: 30, notifyLine: false }),
      );
      // 31 days to be safely >= 30 after Math.floor of (now - dueDate)
      prisma.contract.findMany.mockResolvedValue([makeContract({ daysOverdue: 31 })]);
      mdm.lockDeviceByImei.mockResolvedValue({ success: true, message: 'ok' });

      const result = await service.autoLockOverdueContracts();

      expect(result).toEqual({ locked: 1, skipped: 0, failed: 0 });
      expect(mdm.lockDeviceByImei).toHaveBeenCalledTimes(1);
      // reason string includes daysOverdue + contractNumber
      const [imeiArg, reasonArg] = mdm.lockDeviceByImei.mock.calls[0];
      expect(imeiArg).toBe('359000000000001');
      expect(reasonArg).toContain('C-0001');
      expect(reasonArg).toContain('วัน');
      // DB lock row written AFTER success
      expect(prisma.contract.update).toHaveBeenCalledWith({
        where: { id: 'contract-1' },
        data: { mdmLockedAt: expect.any(Date) },
      });
    });

    it('skips contracts with no IMEI', async () => {
      prisma.systemConfig.findMany.mockResolvedValue(
        settingsRows({ autoLockEnabled: true, autoLockDays: 30, notifyLine: false }),
      );
      prisma.contract.findMany.mockResolvedValue([
        makeContract({ daysOverdue: 60, imei: null }),
      ]);

      const result = await service.autoLockOverdueContracts();

      expect(result).toEqual({ locked: 0, skipped: 1, failed: 0 });
      expect(mdm.lockDeviceByImei).not.toHaveBeenCalled();
    });

    it('skips contracts with no oldest unpaid payment (no dueDate)', async () => {
      prisma.systemConfig.findMany.mockResolvedValue(
        settingsRows({ autoLockEnabled: true, autoLockDays: 30, notifyLine: false }),
      );
      const c = makeContract({ daysOverdue: 60 });
      c.payments = []; // no overdue payment rows
      prisma.contract.findMany.mockResolvedValue([c]);

      const result = await service.autoLockOverdueContracts();

      expect(result).toEqual({ locked: 0, skipped: 1, failed: 0 });
      expect(mdm.lockDeviceByImei).not.toHaveBeenCalled();
    });
  });

  // ─── autoLockOverdueContracts: PHANTOM-LOCK GUARD ──────────

  describe('autoLockOverdueContracts — phantom-lock guard (P1)', () => {
    it('writes NO DB lock row when the MDM API call THROWS', async () => {
      prisma.systemConfig.findMany.mockResolvedValue(
        settingsRows({ autoLockEnabled: true, autoLockDays: 30, notifyLine: false }),
      );
      prisma.contract.findMany.mockResolvedValue([makeContract({ daysOverdue: 60 })]);
      mdm.lockDeviceByImei.mockRejectedValue(new Error('MDM down'));

      const result = await service.autoLockOverdueContracts();

      // CRITICAL: API call happened, but DB lock row was NEVER written.
      expect(mdm.lockDeviceByImei).toHaveBeenCalledTimes(1);
      expect(prisma.contract.update).not.toHaveBeenCalled();
      expect(result).toEqual({ locked: 0, skipped: 0, failed: 1 });
      // unexpected-error branch reports to Sentry via captureException
      expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    });

    it('writes NO DB lock row when the MDM API returns { success: false }', async () => {
      prisma.systemConfig.findMany.mockResolvedValue(
        settingsRows({ autoLockEnabled: true, autoLockDays: 30, notifyLine: false }),
      );
      prisma.contract.findMany.mockResolvedValue([makeContract({ daysOverdue: 60 })]);
      mdm.lockDeviceByImei.mockResolvedValue({ success: false, message: 'device offline' });

      const result = await service.autoLockOverdueContracts();

      expect(mdm.lockDeviceByImei).toHaveBeenCalledTimes(1);
      expect(prisma.contract.update).not.toHaveBeenCalled();
      expect(result).toEqual({ locked: 0, skipped: 0, failed: 1 });
      // failed-result branch reports a Sentry warning (not exception)
      expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
      expect(Sentry.captureException).not.toHaveBeenCalled();
    });

    it('on success path, the DB update is the LAST step — never before the API call', async () => {
      prisma.systemConfig.findMany.mockResolvedValue(
        settingsRows({ autoLockEnabled: true, autoLockDays: 30, notifyLine: false }),
      );
      prisma.contract.findMany.mockResolvedValue([makeContract({ daysOverdue: 60 })]);

      const order: string[] = [];
      mdm.lockDeviceByImei.mockImplementation(async () => {
        order.push('api');
        return { success: true, message: 'ok' };
      });
      prisma.contract.update.mockImplementation(async () => {
        order.push('db');
        return {};
      });

      await service.autoLockOverdueContracts();

      expect(order).toEqual(['api', 'db']);
    });
  });

  // ─── autoLockOverdueContracts: notification on success ─────

  describe('autoLockOverdueContracts — LINE notify', () => {
    it('sends mdm.lock_notice template when notifyLine=true and customer has lineIdFinance', async () => {
      prisma.systemConfig.findMany.mockResolvedValue(
        settingsRows({ autoLockEnabled: true, autoLockDays: 30, notifyLine: true }),
      );
      prisma.contract.findMany.mockResolvedValue([makeContract({ daysOverdue: 60 })]);
      mdm.lockDeviceByImei.mockResolvedValue({ success: true, message: 'ok' });

      const result = await service.autoLockOverdueContracts();

      expect(result.locked).toBe(1);
      expect(notifications.sendFromTemplate).toHaveBeenCalledTimes(1);
      const [templateKey, vars, lineId, ctx] = notifications.sendFromTemplate.mock.calls[0];
      expect(templateKey).toBe('mdm.lock_notice');
      expect(vars.contractNumber).toBe('C-0001');
      expect(lineId).toBe('Uline123');
      expect(ctx).toEqual({ relatedId: 'contract-1', customerId: 'cust-1' });
    });

    it('still counts as locked even if the LINE notify throws (notify failure does not affect lock result)', async () => {
      prisma.systemConfig.findMany.mockResolvedValue(
        settingsRows({ autoLockEnabled: true, autoLockDays: 30, notifyLine: true }),
      );
      prisma.contract.findMany.mockResolvedValue([makeContract({ daysOverdue: 60 })]);
      mdm.lockDeviceByImei.mockResolvedValue({ success: true, message: 'ok' });
      notifications.sendFromTemplate.mockRejectedValue(new Error('LINE down'));

      const result = await service.autoLockOverdueContracts();

      expect(result).toEqual({ locked: 1, skipped: 0, failed: 0 });
      expect(prisma.contract.update).toHaveBeenCalledTimes(1);
    });
  });

  // ─── autoUnlockAfterPayment ────────────────────────────────

  describe('autoUnlockAfterPayment', () => {
    const lockedContract = {
      id: 'contract-1',
      contractNumber: 'C-0001',
      mdmLockedAt: new Date('2024-05-01'),
      product: { id: 'prod-1', imeiSerial: '359000000000001' },
      customer: { id: 'cust-1', name: 'สมชาย', lineIdFinance: 'Uline123' },
    };

    it('does nothing when autoUnlock disabled', async () => {
      prisma.systemConfig.findMany.mockResolvedValue(
        settingsRows({ autoUnlockEnabled: false }),
      );

      await service.autoUnlockAfterPayment('contract-1');

      expect(prisma.contract.findUnique).not.toHaveBeenCalled();
      expect(mdm.unlockDeviceByImei).not.toHaveBeenCalled();
    });

    it('does NOT unlock while overdue installments remain (overdueCount > 0)', async () => {
      prisma.systemConfig.findMany.mockResolvedValue(
        settingsRows({ autoUnlockEnabled: true, notifyLine: false }),
      );
      prisma.contract.findUnique.mockResolvedValue(lockedContract);
      prisma.payment.count.mockResolvedValue(2); // still 2 overdue

      await service.autoUnlockAfterPayment('contract-1');

      expect(prisma.payment.count).toHaveBeenCalledWith({
        where: { contractId: 'contract-1', status: 'OVERDUE', paidAt: null, deletedAt: null },
      });
      expect(mdm.unlockDeviceByImei).not.toHaveBeenCalled();
      expect(prisma.contract.update).not.toHaveBeenCalled();
    });

    it('unlocks ONLY when zero overdue installments remain, then clears mdmLockedAt', async () => {
      prisma.systemConfig.findMany.mockResolvedValue(
        settingsRows({ autoUnlockEnabled: true, notifyLine: false }),
      );
      prisma.contract.findUnique.mockResolvedValue(lockedContract);
      prisma.payment.count.mockResolvedValue(0); // zero overdue -> eligible
      mdm.unlockDeviceByImei.mockResolvedValue({ success: true, message: 'ok' });

      await service.autoUnlockAfterPayment('contract-1');

      expect(mdm.unlockDeviceByImei).toHaveBeenCalledWith('359000000000001');
      expect(prisma.contract.update).toHaveBeenCalledWith({
        where: { id: 'contract-1' },
        data: { mdmLockedAt: null },
      });
    });

    it('does nothing when the contract is not currently locked (mdmLockedAt null)', async () => {
      prisma.systemConfig.findMany.mockResolvedValue(
        settingsRows({ autoUnlockEnabled: true, notifyLine: false }),
      );
      prisma.contract.findUnique.mockResolvedValue({ ...lockedContract, mdmLockedAt: null });

      await service.autoUnlockAfterPayment('contract-1');

      expect(prisma.payment.count).not.toHaveBeenCalled();
      expect(mdm.unlockDeviceByImei).not.toHaveBeenCalled();
      expect(prisma.contract.update).not.toHaveBeenCalled();
    });

    it('does NOT clear mdmLockedAt when the MDM unlock API returns { success: false }', async () => {
      prisma.systemConfig.findMany.mockResolvedValue(
        settingsRows({ autoUnlockEnabled: true, notifyLine: false }),
      );
      prisma.contract.findUnique.mockResolvedValue(lockedContract);
      prisma.payment.count.mockResolvedValue(0);
      mdm.unlockDeviceByImei.mockResolvedValue({ success: false, message: 'device offline' });

      await service.autoUnlockAfterPayment('contract-1');

      expect(mdm.unlockDeviceByImei).toHaveBeenCalledTimes(1);
      expect(prisma.contract.update).not.toHaveBeenCalled();
      expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
    });

    it('is non-blocking: swallows unexpected errors and reports to Sentry (no rethrow)', async () => {
      prisma.systemConfig.findMany.mockResolvedValue(
        settingsRows({ autoUnlockEnabled: true, notifyLine: false }),
      );
      prisma.contract.findUnique.mockRejectedValue(new Error('db boom'));

      await expect(service.autoUnlockAfterPayment('contract-1')).resolves.toBeUndefined();
      expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    });

    it('returns early (no unlock) when the contract is not found', async () => {
      prisma.systemConfig.findMany.mockResolvedValue(
        settingsRows({ autoUnlockEnabled: true, notifyLine: false }),
      );
      prisma.contract.findUnique.mockResolvedValue(null);

      await service.autoUnlockAfterPayment('missing-contract');

      expect(prisma.payment.count).not.toHaveBeenCalled();
      expect(mdm.unlockDeviceByImei).not.toHaveBeenCalled();
    });
  });
});
