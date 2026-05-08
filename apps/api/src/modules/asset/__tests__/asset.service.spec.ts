import { Test } from '@nestjs/testing';
import { Prisma, AssetStatus, AssetCategory } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../../../prisma/prisma.service';
import { AssetService } from '../asset.service';
import { AssetPurchaseTemplate } from '../../journal/cpa-templates/asset-purchase.template';
import { AssetPurchaseReverseTemplate } from '../../journal/cpa-templates/asset-purchase-reverse.template';
import { CreateAssetDto } from '../dto/create-asset.dto';

const D = (n: number | string) => new Prisma.Decimal(n);

// Stub templates (Tasks 7-8 will exercise the real ones via service.post / service.reverse).
const stubPurchaseTemplate = {
  execute: async () => ({ entryNo: 'JE-STUB' }),
};
const stubReverseTemplate = {
  execute: async () => ({ entryNo: 'JE-STUB-REV' }),
};

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
        { provide: AssetPurchaseTemplate, useValue: stubPurchaseTemplate },
        { provide: AssetPurchaseReverseTemplate, useValue: stubReverseTemplate },
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
});
