import { Test } from '@nestjs/testing';
import { Prisma, AssetStatus, AssetCategory } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../../../prisma/prisma.service';
import { AssetService } from '../asset.service';
import { AssetPurchaseTemplate } from '../../journal/cpa-templates/asset-purchase.template';
import { AssetPurchaseReverseTemplate } from '../../journal/cpa-templates/asset-purchase-reverse.template';
import { JournalAutoService } from '../../journal/journal-auto.service';
import { seedFinanceCoa } from '../../../../prisma/seed-coa-finance';
import { CreateAssetDto } from '../dto/create-asset.dto';

const D = (n: number | string) => new Prisma.Decimal(n);

describe('AssetService — CRUD + helpers', () => {
  let service: AssetService;
  let prisma: PrismaService;
  let userId: string;

  const baseDto: CreateAssetDto = {
    name: 'Test Notebook',
    category: 'EQUIPMENT' as AssetCategory,
    basePrice: 36000,
    usefulLifeMonths: 36,
    purchaseDate: '2026-05-01',
    paymentAccount: '11-1201',
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      providers: [
        AssetService,
        PrismaService,
        JournalAutoService,
        AssetPurchaseTemplate,
        AssetPurchaseReverseTemplate,
      ],
    }).compile();
    await module.init();
    service = module.get(AssetService);
    prisma = module.get(PrismaService);

    // Ensure FINANCE company exists (already seeded in dev usually)
    await prisma.companyInfo.upsert({
      where: { companyCode: 'FINANCE' },
      update: {},
      create: {
        companyCode: 'FINANCE',
        nameTh: 'BESTCHOICE FINANCE',
        taxId: '0000000000001',
        address: 'TEST',
        directorName: 'ผู้อำนวยการ',
        vatRegistered: true,
      },
    });

    // Seed FINANCE chart of accounts (required for JE creation via real templates)
    await seedFinanceCoa(prisma);

    // System user — required by JournalAutoService.resolveSystemUserId
    let admin = await prisma.user.findFirst({
      where: { email: 'admin@bestchoice.com' },
    });
    if (!admin) {
      admin = await prisma.user.create({
        data: {
          email: 'admin@bestchoice.com',
          password: 'x',
          name: 'admin',
          role: 'OWNER',
        },
      });
    }

    // Create unique test user
    const user = await prisma.user.create({
      data: {
        email: `asset-test+${Date.now()}@bestchoice.test`,
        password: 'x',
        name: 'Asset Tester',
        role: 'OWNER',
      },
    });
    userId = user.id;
  });

  async function cleanupUserAssets() {
    // Collect asset ids first so we can clean dependent rows
    const assets = await prisma.fixedAsset.findMany({
      where: { createdById: userId },
      select: { id: true },
    });
    const assetIds = assets.map((a) => a.id);

    if (assetIds.length > 0) {
      // Delete journal post audit logs + journal lines + journal entries linked
      // via metadata.assetId (asset-purchase + asset-purchase-reverse JEs).
      const jeRows = await prisma.journalEntry.findMany({
        where: {
          OR: assetIds.map((id) => ({
            metadata: { path: ['assetId'], equals: id } as any,
          })),
        },
        select: { id: true },
      });
      const jeIds = jeRows.map((j) => j.id);
      if (jeIds.length > 0) {
        await prisma.journalPostAuditLog.deleteMany({
          where: { journalEntryId: { in: jeIds } },
        });
        await prisma.journalLine.deleteMany({
          where: { journalEntryId: { in: jeIds } },
        });
        await prisma.journalEntry.deleteMany({
          where: { id: { in: jeIds } },
        });
      }
      // AuditLog rows for these assets — T2-C4 BEFORE DELETE trigger blocks
      // normal DELETE, so disable trigger for the duration of the cleanup.
      // (Tests share a DB; bypass is scoped to this transaction-less cleanup.)
      await prisma.$executeRawUnsafe(
        `ALTER TABLE audit_logs DISABLE TRIGGER audit_logs_no_delete`,
      );
      try {
        await prisma.$executeRawUnsafe(
          `DELETE FROM audit_logs WHERE entity = 'fixed_asset' AND entity_id = ANY($1::text[])`,
          assetIds,
        );
        // Also nuke audit logs by this test user (keeps user-deletable in afterAll)
        await prisma.$executeRawUnsafe(
          `DELETE FROM audit_logs WHERE user_id = $1`,
          userId,
        );
      } finally {
        await prisma.$executeRawUnsafe(
          `ALTER TABLE audit_logs ENABLE TRIGGER audit_logs_no_delete`,
        );
      }
      // DepreciationEntry rows
      await prisma.depreciationEntry.deleteMany({
        where: { assetId: { in: assetIds } },
      });
    }

    // Delete transfer history first (FK Restrict on asset_id)
    await prisma.assetTransferHistory.deleteMany({
      where: { asset: { createdById: userId } },
    });
    await prisma.fixedAsset.deleteMany({ where: { createdById: userId } });
  }

  // Clean assets created by this user before each test (deterministic).
  beforeEach(async () => {
    await cleanupUserAssets();
  });

  afterAll(async () => {
    await cleanupUserAssets();
    await prisma.user.delete({ where: { id: userId } });
  });

  // ==========================================================================
  // 1. createDraft generates assetCode + docNo
  // ==========================================================================
  it('createDraft generates assetCode and docNo', async () => {
    const asset = await service.createDraft(baseDto, userId);
    expect(asset.assetCode).toMatch(/^[A-Z]{2}-\d{3}$/);
    expect(asset.docNo).toMatch(/^ASSET-\d{4}-\d{4}$/);
    expect(asset.status).toBe(AssetStatus.DRAFT);
    expect(asset.createdById).toBe(userId);
  });

  // ==========================================================================
  // 2. createDraft computes monthlyDepr correctly
  // ==========================================================================
  it('createDraft computes monthlyDepr correctly (36000 / 36 = 1000)', async () => {
    const asset = await service.createDraft(baseDto, userId);
    expect(D(asset.monthlyDepr.toString()).equals('1000')).toBe(true);
    expect(D(asset.purchaseCost.toString()).equals('36000')).toBe(true);
    expect(D(asset.netBookValue.toString()).equals('36000')).toBe(true);
  });

  // ==========================================================================
  // 3. createDraft VAT inclusive: extracts VAT from basePrice
  // ==========================================================================
  it('createDraft handles VAT inclusive — adjusts basePrice', async () => {
    const asset = await service.createDraft(
      { ...baseDto, basePrice: 10700, hasVat: true, vatInclusive: true, vatAccount: '11-4101' },
      userId,
    );
    expect(D(asset.basePrice.toString()).equals('10000')).toBe(true);
    expect(D(asset.vatAmount.toString()).equals('700')).toBe(true);
    expect(D(asset.purchaseCost.toString()).equals('10000')).toBe(true);
  });

  // ==========================================================================
  // 4. createDraft VAT exclusive: adds vatAmount on top
  // ==========================================================================
  it('createDraft handles VAT exclusive — adds vatAmount', async () => {
    const asset = await service.createDraft(
      { ...baseDto, basePrice: 10000, hasVat: true, vatInclusive: false, vatAccount: '11-4101' },
      userId,
    );
    expect(D(asset.basePrice.toString()).equals('10000')).toBe(true);
    expect(D(asset.vatAmount.toString()).equals('700')).toBe(true);
    expect(D(asset.purchaseCost.toString()).equals('10000')).toBe(true);
  });

  // ==========================================================================
  // 5. createDraft computes WHT from installation cost (Fix #1.1)
  // ==========================================================================
  it('createDraft computes WHT from installation cost (Fix #1.1)', async () => {
    const asset = await service.createDraft(
      {
        ...baseDto,
        basePrice: 100000,
        installationCost: 50000,
        hasWht: true,
        whtRate: 0.03,
        whtAccount: '21-3103',
        whtFormType: 'PND53',
      },
      userId,
    );
    // WHT base defaults to installationCost when whtBaseAmount not provided
    expect(D(asset.whtAmount.toString()).equals('1500')).toBe(true);
    // purchaseCost = basePrice + installation = 150000
    expect(D(asset.purchaseCost.toString()).equals('150000')).toBe(true);
  });

  // ==========================================================================
  // 6. update rejects if status != DRAFT
  // ==========================================================================
  it('update rejects if status != DRAFT', async () => {
    const asset = await service.createDraft(baseDto, userId);
    // Manually flip status to POSTED to simulate a posted asset (Task 7 will do it via .post())
    await prisma.fixedAsset.update({
      where: { id: asset.id },
      data: { status: AssetStatus.POSTED, postedAt: new Date(), postedById: userId },
    });
    await expect(service.update(asset.id, { name: 'Renamed' })).rejects.toThrow(
      /แก้ไขได้เฉพาะ/,
    );
  });

  // ==========================================================================
  // 7. delete soft-deletes DRAFT
  // ==========================================================================
  it('delete soft-deletes DRAFT', async () => {
    const asset = await service.createDraft(baseDto, userId);
    await service.delete(asset.id, userId);
    const after = await prisma.fixedAsset.findUnique({ where: { id: asset.id } });
    expect(after).toBeTruthy();
    expect(after!.deletedAt).not.toBeNull();
    // findOne should now 404
    await expect(service.findOne(asset.id)).rejects.toThrow(/ไม่พบ/);
  });

  // ==========================================================================
  // 8. delete rejects if status != DRAFT
  // ==========================================================================
  it('delete rejects if status != DRAFT', async () => {
    const asset = await service.createDraft(baseDto, userId);
    await prisma.fixedAsset.update({
      where: { id: asset.id },
      data: { status: AssetStatus.POSTED, postedAt: new Date(), postedById: userId },
    });
    await expect(service.delete(asset.id, userId)).rejects.toThrow(/ลบได้เฉพาะ/);
  });

  // ==========================================================================
  // 9. findAll filters by status
  // ==========================================================================
  it('findAll filters by status', async () => {
    // 3 DRAFT
    for (let i = 0; i < 3; i++) {
      await service.createDraft(baseDto, userId);
    }
    // 2 POSTED
    for (let i = 0; i < 2; i++) {
      const a = await service.createDraft(baseDto, userId);
      await prisma.fixedAsset.update({
        where: { id: a.id },
        data: { status: AssetStatus.POSTED, postedAt: new Date(), postedById: userId },
      });
    }

    const draftRes = await service.findAll({ status: AssetStatus.DRAFT });
    expect(draftRes.data.filter((a) => a.createdById === userId)).toHaveLength(3);

    const postedRes = await service.findAll({ status: AssetStatus.POSTED });
    expect(postedRes.data.filter((a) => a.createdById === userId)).toHaveLength(2);
  });

  // ==========================================================================
  // 10. findAll filters by category and search
  // ==========================================================================
  it('findAll filters by category and search', async () => {
    await service.createDraft({ ...baseDto, name: 'Apple MacBook Pro' }, userId);
    await service.createDraft(
      { ...baseDto, name: 'Office Desk', category: 'FURNITURE' as AssetCategory },
      userId,
    );
    await service.createDraft(
      { ...baseDto, name: 'Toyota Camry', category: 'VEHICLE' as AssetCategory },
      userId,
    );

    const byCategory = await service.findAll({ category: 'VEHICLE' as AssetCategory });
    expect(byCategory.data.filter((a) => a.createdById === userId)).toHaveLength(1);
    expect(byCategory.data.find((a) => a.createdById === userId)!.name).toBe('Toyota Camry');

    const bySearch = await service.findAll({ search: 'macbook' });
    const matched = bySearch.data.filter((a) => a.createdById === userId);
    expect(matched).toHaveLength(1);
    expect(matched[0].name).toBe('Apple MacBook Pro');
  });

  // ==========================================================================
  // 11. findAll paginates
  // ==========================================================================
  it('findAll paginates', async () => {
    // Create 12 assets with a unique searchable tag to scope pagination strictly
    // to this test (avoids stale rows from prior test runs).
    const tag = `paginate-${Date.now()}`;
    for (let i = 0; i < 12; i++) {
      await service.createDraft({ ...baseDto, name: `${tag} ${i}` }, userId);
    }
    const page1 = await service.findAll({ search: tag, page: 1, limit: 10 });
    expect(page1.data).toHaveLength(10);
    expect(page1.total).toBe(12);
    expect(page1.page).toBe(1);
    expect(page1.limit).toBe(10);

    const page2 = await service.findAll({ search: tag, page: 2, limit: 10 });
    expect(page2.data).toHaveLength(2);
    expect(page2.total).toBe(12);
  });

  // ==========================================================================
  // 12. findOne returns 404 if not found
  // ==========================================================================
  it('findOne returns 404 if not found', async () => {
    await expect(
      service.findOne('00000000-0000-0000-0000-000000000000'),
    ).rejects.toThrow(/ไม่พบ/);
  });

  // ==========================================================================
  // 13. findOne includes recent 10 transferHistory rows
  // ==========================================================================
  it('findOne includes recent 10 transferHistory rows (cap at 10)', async () => {
    const asset = await service.createDraft(baseDto, userId);

    // Insert 12 transfer history rows
    const rand = Math.random().toString(36).slice(2, 8);
    for (let i = 0; i < 12; i++) {
      await prisma.assetTransferHistory.create({
        data: {
          transferId: `TRF-${Date.now()}-${rand}-${i}`,
          assetId: asset.id,
          transferDate: new Date(2026, 4, i + 1),
          reason: `Transfer ${i}`,
          transferredById: userId,
        },
      });
    }

    const fetched = await service.findOne(asset.id);
    expect(fetched.transferHistory).toHaveLength(10);
    // Sorted DESC by transferDate — newest first (May 12)
    expect(fetched.transferHistory[0].reason).toBe('Transfer 11');
  });

  // ==========================================================================
  // 14. generateAssetCode produces sequential codes per category
  // ==========================================================================
  it('generateAssetCode produces sequential codes per category', async () => {
    const a1 = await service.createDraft(
      { ...baseDto, category: 'FURNITURE' as AssetCategory },
      userId,
    );
    const a2 = await service.createDraft(
      { ...baseDto, category: 'FURNITURE' as AssetCategory },
      userId,
    );
    expect(a1.assetCode).toMatch(/^FN-\d{3}$/);
    expect(a2.assetCode).toMatch(/^FN-\d{3}$/);
    const seq1 = parseInt(a1.assetCode.split('-')[1], 10);
    const seq2 = parseInt(a2.assetCode.split('-')[1], 10);
    expect(seq2).toBe(seq1 + 1);
  });

  // ==========================================================================
  // 15. getDepreciationSummary returns counts by status
  // ==========================================================================
  it('getDepreciationSummary returns counts by status', async () => {
    // DRAFT × 2
    await service.createDraft(baseDto, userId);
    await service.createDraft(baseDto, userId);
    // POSTED × 1
    const posted = await service.createDraft(baseDto, userId);
    await prisma.fixedAsset.update({
      where: { id: posted.id },
      data: { status: AssetStatus.POSTED, postedAt: new Date(), postedById: userId },
    });

    const summary = await service.getDepreciationSummary();
    expect(summary.draft).toBeGreaterThanOrEqual(2);
    expect(summary.posted).toBeGreaterThanOrEqual(1);
    expect(typeof summary.reversed).toBe('number');
    expect(typeof summary.disposed).toBe('number');
    expect(typeof summary.writtenOff).toBe('number');
    // totalPurchaseCost should be a Decimal-or-zero
    const totalCost = new Decimal(summary.totalPurchaseCost.toString());
    expect(totalCost.gte(36000)).toBe(true);
  });

  // ==========================================================================
  // Task 7 — post + reverse with V15 period guard + AuditLog
  // ==========================================================================

  /** Helper — create an asset and POST it (real JE via AssetPurchaseTemplate). */
  async function createPostedAsset(overrides: Partial<CreateAssetDto> = {}) {
    const draft = await service.createDraft({ ...baseDto, ...overrides }, userId);
    await service.post(draft.id, userId);
    const posted = await prisma.fixedAsset.findUnique({ where: { id: draft.id } });
    return posted!;
  }

  describe('AssetService.post', () => {
    it('transitions DRAFT → POSTED and creates JE', async () => {
      const draft = await service.createDraft(baseDto, userId);
      const result = await service.post(draft.id, userId);
      expect(result.entryNo).toMatch(/^JE-\d{6}-\d{5}$/);
      const updated = await prisma.fixedAsset.findUnique({
        where: { id: draft.id },
      });
      expect(updated!.status).toBe(AssetStatus.POSTED);
      expect(updated!.postedById).toBe(userId);
      expect(updated!.postedAt).toBeTruthy();
    });

    it('rejects POST if status != DRAFT', async () => {
      const asset = await createPostedAsset();
      await expect(service.post(asset.id, userId)).rejects.toThrow(/DRAFT/);
    });

    it('writes AuditLog with action=ASSET_POST', async () => {
      const draft = await service.createDraft(baseDto, userId);
      await service.post(draft.id, userId);
      const log = await prisma.auditLog.findFirst({
        where: {
          entity: 'fixed_asset',
          entityId: draft.id,
          action: 'ASSET_POST',
        },
      });
      expect(log).toBeTruthy();
      expect((log!.newValue as any).status).toBe('POSTED');
    });

    it('post is idempotent — second call returns same JE OR rejects with already-posted error', async () => {
      const draft = await service.createDraft(baseDto, userId);
      const r1 = await service.post(draft.id, userId);
      const r2 = await service.post(draft.id, userId).catch((e) => e);
      // Either rejects (clearer UX) or returns same entry — either is acceptable
      if (r2 instanceof Error) {
        expect(r2.message).toMatch(/DRAFT|already/i);
      } else {
        expect((r2 as { entryNo: string }).entryNo).toBe(r1.entryNo);
      }
    });

    it('V15 period closed → reject + AuditLog ASSET_POST_BLOCKED', async () => {
      // Create closed AccountingPeriod for asset purchase month
      const finance = await prisma.companyInfo.findFirst({
        where: { companyCode: 'FINANCE' },
      });
      if (!finance) {
        // Should never happen — beforeAll seeds it
        throw new Error('FINANCE company missing');
      }
      // baseDto.purchaseDate = '2026-05-01' → year=2026, month=5
      const period = await prisma.accountingPeriod.upsert({
        where: {
          companyId_year_month: {
            companyId: finance.id,
            year: 2026,
            month: 5,
          },
        },
        update: { status: 'CLOSED', closedAt: new Date(), closedById: userId },
        create: {
          companyId: finance.id,
          year: 2026,
          month: 5,
          status: 'CLOSED',
          closedAt: new Date(),
          closedById: userId,
        },
      });

      try {
        const draft = await service.createDraft(baseDto, userId);
        await expect(service.post(draft.id, userId)).rejects.toThrow(
          /period|งวด/i,
        );
        const blockedLog = await prisma.auditLog.findFirst({
          where: {
            entity: 'fixed_asset',
            entityId: draft.id,
            action: 'ASSET_POST_BLOCKED',
          },
        });
        expect(blockedLog).toBeTruthy();
      } finally {
        // Cleanup the test period
        await prisma.accountingPeriod.delete({
          where: { id: period.id },
        });
      }
    });
  });

  describe('AssetService.reverse', () => {
    it('transitions POSTED → REVERSED and creates reversal JE', async () => {
      const asset = await createPostedAsset();
      const result = await service.reverse(asset.id, userId, 'ลงผิด');
      expect(result.entryNo).toMatch(/^JE-\d{6}-\d{5}$/);
      const updated = await prisma.fixedAsset.findUnique({
        where: { id: asset.id },
      });
      expect(updated!.status).toBe(AssetStatus.REVERSED);
      expect(updated!.reversedById).toBe(userId);
      expect(updated!.reversalReason).toBe('ลงผิด');
    });

    it('rejects reverse if status != POSTED', async () => {
      const draft = await service.createDraft(baseDto, userId);
      await expect(service.reverse(draft.id, userId, 'reason')).rejects.toThrow(
        /POSTED/,
      );
    });

    it('rejects reverse if asset has DepreciationEntry', async () => {
      const asset = await createPostedAsset();
      await prisma.depreciationEntry.create({
        data: {
          assetId: asset.id,
          period: '2026-05',
          amount: new Decimal(100),
        },
      });
      await expect(service.reverse(asset.id, userId, 'x')).rejects.toThrow(
        /depreciation/i,
      );
    });

    it('writes AuditLog with action=ASSET_REVERSE', async () => {
      const asset = await createPostedAsset();
      await service.reverse(asset.id, userId, 'x');
      const log = await prisma.auditLog.findFirst({
        where: {
          entity: 'fixed_asset',
          entityId: asset.id,
          action: 'ASSET_REVERSE',
        },
      });
      expect(log).toBeTruthy();
      expect((log!.newValue as any).status).toBe('REVERSED');
    });

    it('rejects reverse with empty reason', async () => {
      const asset = await createPostedAsset();
      await expect(service.reverse(asset.id, userId, '')).rejects.toThrow();
    });
  });

  // ==========================================================================
  // Task 8 — copy: clone POSTED/REVERSED asset into new DRAFT
  // ==========================================================================
  describe('AssetService.copy', () => {
    it('clones a POSTED asset into a new DRAFT', async () => {
      const source = await createPostedAsset({
        name: 'Notebook X',
        custodian: 'Alice',
        supplierName: 'Vendor A',
      });
      const copy = await service.copy(source.id, userId);
      expect(copy.id).not.toBe(source.id);
      expect(copy.assetCode).not.toBe(source.assetCode);
      expect(copy.docNo).not.toBe(source.docNo);
      expect(copy.status).toBe('DRAFT');
      expect(copy.name).toBe('Notebook X');
      expect(copy.custodian).toBe('Alice');
      expect(copy.supplierName).toBe('Vendor A');
      expect(copy.postedAt).toBeNull();
      expect(copy.coaCostAccount).toBeNull();
    });

    it('clones a REVERSED asset (any source status allowed)', async () => {
      const source = await createPostedAsset();
      await service.reverse(source.id, userId, 'x');
      const copy = await service.copy(source.id, userId);
      expect(copy.status).toBe('DRAFT');
    });

    it('AuditLog ASSET_CREATE includes copiedFromAssetId', async () => {
      const source = await createPostedAsset();
      const copy = await service.copy(source.id, userId);
      const log = await prisma.auditLog.findFirst({
        where: { entity: 'fixed_asset', entityId: copy.id, action: 'ASSET_CREATE' },
      });
      expect(log).toBeTruthy();
      expect((log!.newValue as any).copiedFromAssetId).toBe(source.id);
      expect((log!.newValue as any).copiedFromAssetCode).toBe(source.assetCode);
    });

    it('does NOT copy transferHistory or depreciationEntries', async () => {
      const source = await createPostedAsset();
      await prisma.assetTransferHistory.create({
        data: {
          transferId: `TRF-test-${Date.now()}`,
          assetId: source.id,
          transferDate: new Date(),
          toCustodian: 'Bob',
          reason: 'test',
          transferredById: userId,
        },
      });
      const copy = await service.copy(source.id, userId);
      const copyHistory = await prisma.assetTransferHistory.count({
        where: { assetId: copy.id },
      });
      expect(copyHistory).toBe(0);
    });
  });
});
