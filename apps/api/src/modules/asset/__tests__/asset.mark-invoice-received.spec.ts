import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma, AssetStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AssetService } from '../asset.service';
import { AssetPurchaseTemplate } from '../../journal/cpa-templates/asset-purchase.template';
import { AssetPurchaseReverseTemplate } from '../../journal/cpa-templates/asset-purchase-reverse.template';
import { AssetDisposalTemplate } from '../../journal/cpa-templates/asset-disposal.template';
import { AssetDisposalReverseTemplate } from '../../journal/cpa-templates/asset-disposal-reverse.template';
import { AssetInvoiceReceivedTemplate } from '../../journal/cpa-templates/asset-invoice-received.template';
import { validatePeriodOpen } from '../../../utils/period-lock.util';

/**
 * Characterization (golden) tests for AssetService.markInvoiceReceived
 * (asset.service.ts ~lines 964-1071) — the 11-4102 → 11-4101 deferred-input-VAT
 * transfer ORCHESTRATION. Wave 3 gap-fill (audit HIGH gap).
 *
 * The JE math itself is already locked by the template spec
 * (asset-invoice-received-template.spec.ts) — this file deliberately STUBS the
 * template and asserts only the SERVICE-level orchestration: eligibility guards,
 * the V15 period guard, the atomic $transaction body, the TOCTOU updateMany +
 * rowCount guard, and the two audit-log writes.
 *
 * What this file locks:
 *   - eligibility guards (run OUTSIDE the tx, BEFORE the period guard):
 *       * asset not found            -> NotFoundException('ไม่พบสินทรัพย์')
 *       * status !== POSTED          -> BadRequestException(...POSTED...)
 *       * !hasVat                    -> BadRequestException(...ไม่มี VAT...)
 *       * vatAccount !== '11-4102'   -> BadRequestException(...ภาษีซื้ออยู่บัญชี...)
 *       * invoiceReceivedAt already set -> BadRequestException(...บันทึกใบกำกับมาถึงแล้ว...)
 *   - V15 period guard (993-1011): validatePeriodOpen rejects ->
 *       auditLog ASSET_INVOICE_RECEIVED_BLOCKED (entity 'fixed_asset',
 *       newValue.reason = err.message) then BadRequestException('ไม่สามารถบันทึกใบกำกับ: ...').
 *       Asserts the guard is called with TODAY (a fresh current Date), NOT
 *       asset.purchaseDate, and the template is NEVER executed.
 *   - happy path: template.execute called once with { assetId, triggeredById };
 *       tx.fixedAsset.updateMany.data flips vatAccount to '11-4101' + stamps
 *       invoiceReceivedAt(Date) / invoiceReceivedById / invoiceTransferJournalEntryId;
 *       INVOICE_RECEIVED audit oldValue.vatAccount='11-4102',
 *       newValue.vatAccount='11-4101', newValue.vatAmount==='700.00'; all in ONE $transaction.
 *   - TOCTOU guard (1027-1046): updateMany -> { count: 0 } ->
 *       BadRequestException('มีคนกดบันทึกใบกำกับไปแล้วในระหว่างนี้ — กรุณารีเฟรชหน้า'),
 *       where-clause pins vatAccount:'11-4102', invoiceReceivedAt:null,
 *       invoiceTransferJournalEntryId:null.
 *
 * Mock-only — no DB, no real templates. PrismaService is a hand-mocked stub
 * (only fixedAsset.findFirst, companyInfo.findFirst, auditLog.create, and
 * $transaction(cb => cb(tx))). validatePeriodOpen is jest-mocked at the module
 * level (the service imports it as a named function, not an injected dep).
 * Money is Prisma.Decimal in production — asset.vatAmount is passed as a real
 * Prisma.Decimal so `new Decimal(asset.vatAmount.toString()).toFixed(2)` behaves
 * faithfully ('700.00').
 */

jest.mock('../../../utils/period-lock.util', () => ({
  validatePeriodOpen: jest.fn(),
}));

const mockValidatePeriodOpen = validatePeriodOpen as jest.MockedFunction<typeof validatePeriodOpen>;

const FINANCE_COMPANY_ID = 'finance-company-uuid';
const TRIGGERED_BY = 'user-uuid-1';
const ASSET_ID = 'asset-uuid-1';

type AssetRow = {
  id: string;
  assetCode: string;
  name: string;
  status: AssetStatus;
  hasVat: boolean;
  vatAccount: string | null;
  vatAmount: Prisma.Decimal;
  invoiceReceivedAt: Date | null;
  purchaseDate: Date;
};

/** A POSTED, hasVat, 11-4102 asset with vatAmount 700.00 — the happy-path subject. */
const eligibleAsset = (over: Partial<AssetRow> = {}): AssetRow => ({
  id: ASSET_ID,
  assetCode: 'EQ-001',
  name: 'Test Notebook',
  status: AssetStatus.POSTED,
  hasVat: true,
  vatAccount: '11-4102',
  vatAmount: new Prisma.Decimal('700.00'),
  invoiceReceivedAt: null,
  // A purchaseDate firmly in the PAST so the "guard uses TODAY not purchaseDate"
  // assertion is unambiguous (a 2020 date can never equal `new Date()`).
  purchaseDate: new Date('2020-01-15T00:00:00.000Z'),
  ...over,
});

type TxMock = {
  fixedAsset: { updateMany: jest.Mock };
  auditLog: { create: jest.Mock };
};

type Mocks = {
  service: AssetService;
  prisma: {
    fixedAsset: { findFirst: jest.Mock };
    companyInfo: { findFirst: jest.Mock };
    auditLog: { create: jest.Mock };
    $transaction: jest.Mock;
  };
  tx: TxMock;
  templateExecute: jest.Mock;
};

/**
 * Build the service with a hand-mocked Prisma + a stubbed invoiceReceivedTemplate.
 * The four OTHER injected templates are bare stubs (never reached by this method).
 */
const build = (opts: {
  asset: AssetRow | null;
  updateCount?: number;
  templateResult?: { entryNo: string; journalEntryId: string };
}): Mocks => {
  const tx: TxMock = {
    fixedAsset: { updateMany: jest.fn().mockResolvedValue({ count: opts.updateCount ?? 1 }) },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };

  const prisma = {
    fixedAsset: { findFirst: jest.fn().mockResolvedValue(opts.asset) },
    companyInfo: {
      findFirst: jest.fn().mockResolvedValue({ id: FINANCE_COMPANY_ID }),
    },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
    // $transaction(cb => cb(tx)) — single-callback form.
    $transaction: jest.fn((cb: (t: TxMock) => unknown) => cb(tx)),
  };

  const templateExecute = jest.fn().mockResolvedValue(
    opts.templateResult ?? { entryNo: 'JE-202606-00001', journalEntryId: 'je-uuid-1' },
  );
  const invoiceReceivedTemplate = {
    execute: templateExecute,
  } as unknown as AssetInvoiceReceivedTemplate;

  const stub = {} as never;
  const service = new AssetService(
    prisma as unknown as PrismaService,
    stub as AssetPurchaseTemplate,
    stub as AssetPurchaseReverseTemplate,
    stub as AssetDisposalTemplate,
    stub as AssetDisposalReverseTemplate,
    invoiceReceivedTemplate,
  );

  return { service, prisma, tx, templateExecute };
};

describe('AssetService.markInvoiceReceived (characterization)', () => {
  beforeEach(() => {
    mockValidatePeriodOpen.mockReset();
    // Default: period is OPEN (resolves) so the happy path proceeds.
    mockValidatePeriodOpen.mockResolvedValue(undefined);
  });

  // ==========================================================================
  // Eligibility guards (run outside the tx, BEFORE the period guard)
  // ==========================================================================
  describe('eligibility guards', () => {
    it('throws NotFoundException when the asset is missing', async () => {
      const { service, templateExecute } = build({ asset: null });
      await expect(service.markInvoiceReceived(ASSET_ID, TRIGGERED_BY)).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.markInvoiceReceived(ASSET_ID, TRIGGERED_BY)).rejects.toThrow(
        'ไม่พบสินทรัพย์',
      );
      expect(templateExecute).not.toHaveBeenCalled();
      expect(mockValidatePeriodOpen).not.toHaveBeenCalled();
    });

    it('rejects when status is not POSTED', async () => {
      const { service, templateExecute } = build({
        asset: eligibleAsset({ status: AssetStatus.DRAFT }),
      });
      await expect(service.markInvoiceReceived(ASSET_ID, TRIGGERED_BY)).rejects.toThrow(
        /POSTED/,
      );
      expect(templateExecute).not.toHaveBeenCalled();
    });

    it('rejects when the asset has no VAT', async () => {
      const { service, templateExecute } = build({ asset: eligibleAsset({ hasVat: false }) });
      await expect(service.markInvoiceReceived(ASSET_ID, TRIGGERED_BY)).rejects.toThrow(
        /ไม่มี VAT/,
      );
      expect(templateExecute).not.toHaveBeenCalled();
    });

    it("rejects when vatAccount is not '11-4102' (already 11-4101)", async () => {
      const { service, templateExecute } = build({
        asset: eligibleAsset({ vatAccount: '11-4101' }),
      });
      await expect(service.markInvoiceReceived(ASSET_ID, TRIGGERED_BY)).rejects.toThrow(
        /ภาษีซื้ออยู่บัญชี 11-4101/,
      );
      expect(templateExecute).not.toHaveBeenCalled();
    });

    it('rejects when invoiceReceivedAt is already set (idempotent re-click)', async () => {
      const { service, templateExecute } = build({
        asset: eligibleAsset({ invoiceReceivedAt: new Date('2026-06-01T00:00:00.000Z') }),
      });
      await expect(service.markInvoiceReceived(ASSET_ID, TRIGGERED_BY)).rejects.toThrow(
        /บันทึกใบกำกับมาถึงแล้ว/,
      );
      expect(templateExecute).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // V15 period guard (993-1011)
  // ==========================================================================
  describe('V15 period guard', () => {
    it('blocks when validatePeriodOpen rejects: writes ASSET_INVOICE_RECEIVED_BLOCKED audit then throws, template NEVER runs', async () => {
      const { service, prisma, templateExecute } = build({ asset: eligibleAsset() });
      mockValidatePeriodOpen.mockRejectedValue(new Error('งวดบัญชี 2026-06 ปิดแล้ว'));

      await expect(service.markInvoiceReceived(ASSET_ID, TRIGGERED_BY)).rejects.toThrow(
        BadRequestException,
      );

      // Audit log records the block with the period-guard error as the reason.
      expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: {
          userId: TRIGGERED_BY,
          action: 'ASSET_INVOICE_RECEIVED_BLOCKED',
          entity: 'fixed_asset',
          entityId: ASSET_ID,
          oldValue: { vatAccount: '11-4102' },
          newValue: { reason: 'งวดบัญชี 2026-06 ปิดแล้ว' },
        },
      });

      // The template must never post a JE when the period is closed.
      expect(templateExecute).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('throws the ไม่สามารถบันทึกใบกำกับ message wrapping the guard error', async () => {
      const { service } = build({ asset: eligibleAsset() });
      mockValidatePeriodOpen.mockRejectedValue(new Error('boom'));
      await expect(service.markInvoiceReceived(ASSET_ID, TRIGGERED_BY)).rejects.toThrow(
        /ไม่สามารถบันทึกใบกำกับ: boom/,
      );
    });

    it('calls validatePeriodOpen with TODAY (fresh current Date) + FINANCE companyId, NOT asset.purchaseDate', async () => {
      const { service } = build({ asset: eligibleAsset() });
      const before = Date.now();
      await service.markInvoiceReceived(ASSET_ID, TRIGGERED_BY);
      const after = Date.now();

      expect(mockValidatePeriodOpen).toHaveBeenCalledTimes(1);
      const [prismaArg, dateArg, companyArg] = mockValidatePeriodOpen.mock.calls[0];
      expect(prismaArg).toBeDefined();
      expect(dateArg).toBeInstanceOf(Date);
      // The date passed is "now", bounded by the call window — and decidedly NOT
      // the 2020 purchaseDate. (V15: the transfer JE posts in the current period.)
      const ts = (dateArg as Date).getTime();
      expect(ts).toBeGreaterThanOrEqual(before);
      expect(ts).toBeLessThanOrEqual(after);
      expect(ts).not.toBe(new Date('2020-01-15T00:00:00.000Z').getTime());
      expect(companyArg).toBe(FINANCE_COMPANY_ID);
    });
  });

  // ==========================================================================
  // Happy path — orchestration inside one $transaction
  // ==========================================================================
  describe('happy path', () => {
    it('executes the template once, flips vatAccount, writes INVOICE_RECEIVED audit — all in ONE $transaction', async () => {
      const { service, prisma, tx, templateExecute } = build({ asset: eligibleAsset() });

      const result = await service.markInvoiceReceived(ASSET_ID, TRIGGERED_BY);

      // Exactly one transaction wraps the whole orchestration.
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);

      // Template executed once with the asset id + actor (and a tx as 2nd arg).
      expect(templateExecute).toHaveBeenCalledTimes(1);
      const [tmplInput] = templateExecute.mock.calls[0];
      expect(tmplInput).toEqual({ assetId: ASSET_ID, triggeredById: TRIGGERED_BY });

      // updateMany flips the account + stamps the received fields.
      expect(tx.fixedAsset.updateMany).toHaveBeenCalledTimes(1);
      const updArg = tx.fixedAsset.updateMany.mock.calls[0][0];
      expect(updArg.data).toEqual({
        vatAccount: '11-4101',
        invoiceReceivedAt: expect.any(Date),
        invoiceReceivedById: TRIGGERED_BY,
        invoiceTransferJournalEntryId: 'je-uuid-1',
      });

      // INVOICE_RECEIVED audit captured before/after + the JE entryNo + vatAmount.
      expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
      const auditArg = tx.auditLog.create.mock.calls[0][0];
      expect(auditArg.data.userId).toBe(TRIGGERED_BY);
      expect(auditArg.data.action).toBe('INVOICE_RECEIVED');
      expect(auditArg.data.entity).toBe('fixed_asset');
      expect(auditArg.data.entityId).toBe(ASSET_ID);
      expect(auditArg.data.oldValue).toEqual({ vatAccount: '11-4102', invoiceReceivedAt: null });
      expect(auditArg.data.newValue.vatAccount).toBe('11-4101');
      expect(auditArg.data.newValue.transferEntryNumber).toBe('JE-202606-00001');
      expect(auditArg.data.newValue.vatAmount).toBe('700.00');
      expect(typeof auditArg.data.newValue.invoiceReceivedAt).toBe('string');

      // Return shape: { entryNo, invoiceReceivedAt }.
      expect(result.entryNo).toBe('JE-202606-00001');
      expect(result.invoiceReceivedAt).toBeInstanceOf(Date);
    });

    it('updateMany where-clause pins the idempotency filter (vatAccount 11-4102, invoiceReceivedAt null, JE id null, deletedAt null)', async () => {
      const { service, tx } = build({ asset: eligibleAsset() });
      await service.markInvoiceReceived(ASSET_ID, TRIGGERED_BY);
      const updArg = tx.fixedAsset.updateMany.mock.calls[0][0];
      expect(updArg.where).toEqual({
        id: ASSET_ID,
        vatAccount: '11-4102',
        invoiceReceivedAt: null,
        invoiceTransferJournalEntryId: null,
        deletedAt: null,
      });
    });

    it('stamps invoiceTransferJournalEntryId from the template journalEntryId (not entryNo)', async () => {
      const { service, tx } = build({
        asset: eligibleAsset(),
        templateResult: { entryNo: 'JE-202606-09999', journalEntryId: 'je-uuid-distinct' },
      });
      await service.markInvoiceReceived(ASSET_ID, TRIGGERED_BY);
      const updArg = tx.fixedAsset.updateMany.mock.calls[0][0];
      expect(updArg.data.invoiceTransferJournalEntryId).toBe('je-uuid-distinct');
    });
  });

  // ==========================================================================
  // TOCTOU guard (1027-1046) — updateMany rowCount race protection
  // ==========================================================================
  describe('TOCTOU guard', () => {
    it('throws when updateMany affects 0 rows (concurrent click already transferred)', async () => {
      const { service, tx } = build({ asset: eligibleAsset(), updateCount: 0 });
      await expect(service.markInvoiceReceived(ASSET_ID, TRIGGERED_BY)).rejects.toThrow(
        'มีคนกดบันทึกใบกำกับไปแล้วในระหว่างนี้ — กรุณารีเฟรชหน้า',
      );
      // Threw inside the tx — the INVOICE_RECEIVED audit is NOT written
      // (the whole tx rolls back, including the duplicate JE the template posted).
      expect(tx.auditLog.create).not.toHaveBeenCalled();
    });

    it('throws when updateMany affects more than 1 row (count !== 1 guard, not just 0)', async () => {
      const { service } = build({ asset: eligibleAsset(), updateCount: 2 });
      await expect(service.markInvoiceReceived(ASSET_ID, TRIGGERED_BY)).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
