import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { AssetCategory, AssetStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AssetService } from '../asset.service';
import { AssetTransferService } from '../asset-transfer.service';
import { AssetPurchaseTemplate } from '../../journal/cpa-templates/asset-purchase.template';
import { AssetPurchaseReverseTemplate } from '../../journal/cpa-templates/asset-purchase-reverse.template';
import { JournalAutoService } from '../../journal/journal-auto.service';
import { seedFinanceCoa } from '../../../../prisma/seed-coa-finance';
import { CreateAssetDto } from '../dto/create-asset.dto';

describe('AssetTransferService', () => {
  let svc: AssetService;
  let transferSvc: AssetTransferService;
  let prisma: PrismaService;
  let userId: string;

  const baseDto: CreateAssetDto = {
    name: 'Notebook',
    category: 'EQUIPMENT' as AssetCategory,
    basePrice: 30000,
    usefulLifeMonths: 36,
    purchaseDate: '2026-04-01',
    paymentAccount: '11-1201',
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        AssetService,
        AssetTransferService,
        AssetPurchaseTemplate,
        AssetPurchaseReverseTemplate,
        JournalAutoService,
        PrismaService,
      ],
    }).compile();
    await moduleRef.init();
    svc = moduleRef.get(AssetService);
    transferSvc = moduleRef.get(AssetTransferService);
    prisma = moduleRef.get(PrismaService);

    // Ensure FINANCE company exists
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

    // System user for JournalAutoService.resolveSystemUserId
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
        email: `asset-transfer-test+${Date.now()}@bestchoice.test`,
        password: 'x',
        name: 'Asset Transfer Tester',
        role: 'OWNER',
      },
    });
    userId = user.id;
  });

  async function cleanupUserAssets() {
    const assets = await prisma.fixedAsset.findMany({
      where: { createdById: userId },
      select: { id: true },
    });
    const assetIds = assets.map((a) => a.id);

    if (assetIds.length > 0) {
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

      // AuditLog rows — bypass T2-C4 BEFORE DELETE trigger
      await prisma.$executeRawUnsafe(
        `ALTER TABLE audit_logs DISABLE TRIGGER audit_logs_no_delete`,
      );
      try {
        await prisma.$executeRawUnsafe(
          `DELETE FROM audit_logs WHERE entity = 'fixed_asset' AND entity_id = ANY($1::text[])`,
          assetIds,
        );
        await prisma.$executeRawUnsafe(
          `DELETE FROM audit_logs WHERE user_id = $1`,
          userId,
        );
      } finally {
        await prisma.$executeRawUnsafe(
          `ALTER TABLE audit_logs ENABLE TRIGGER audit_logs_no_delete`,
        );
      }
      await prisma.depreciationEntry.deleteMany({
        where: { assetId: { in: assetIds } },
      });
    }

    // Transfer history first (FK Restrict)
    await prisma.assetTransferHistory.deleteMany({
      where: { asset: { createdById: userId } },
    });
    await prisma.fixedAsset.deleteMany({ where: { createdById: userId } });
  }

  beforeEach(async () => {
    await cleanupUserAssets();
  });

  afterAll(async () => {
    await cleanupUserAssets();
    await prisma.user.delete({ where: { id: userId } });
  });

  async function createPostedAsset(
    custodian: string | undefined = 'Alice',
    location: string | undefined = 'HQ',
  ) {
    const draft = await svc.createDraft(
      { ...baseDto, custodian, location },
      userId,
    );
    await svc.post(draft.id, userId);
    const posted = await prisma.fixedAsset.findUnique({
      where: { id: draft.id },
    });
    return posted!;
  }

  // 1. changes custodian only — no JE, history row created
  it('changes custodian only — no JE, history row created with from/to custodian, location unchanged', async () => {
    const asset = await createPostedAsset('Alice', 'HQ');
    await transferSvc.transfer(
      asset.id,
      {
        transferDate: '2026-05-08',
        toCustodian: 'Bob',
        reason: 'Alice resigned',
      },
      userId,
    );
    const updated = await prisma.fixedAsset.findUnique({
      where: { id: asset.id },
    });
    expect(updated!.custodian).toBe('Bob');
    expect(updated!.location).toBe('HQ');

    const history = await prisma.assetTransferHistory.findMany({
      where: { assetId: asset.id },
    });
    expect(history).toHaveLength(1);
    expect(history[0].fromCustodian).toBe('Alice');
    expect(history[0].toCustodian).toBe('Bob');
    expect(history[0].fromLocation).toBe('HQ');
    expect(history[0].toLocation).toBe('HQ');
    expect(history[0].reason).toBe('Alice resigned');
  });

  // 2. changes location only
  it('changes location only', async () => {
    const asset = await createPostedAsset('Alice', 'HQ');
    await transferSvc.transfer(
      asset.id,
      {
        transferDate: '2026-05-08',
        toLocation: 'Branch A',
        reason: 'relocation',
      },
      userId,
    );
    const updated = await prisma.fixedAsset.findUnique({
      where: { id: asset.id },
    });
    expect(updated!.custodian).toBe('Alice');
    expect(updated!.location).toBe('Branch A');

    const history = await prisma.assetTransferHistory.findMany({
      where: { assetId: asset.id },
    });
    expect(history).toHaveLength(1);
    expect(history[0].fromLocation).toBe('HQ');
    expect(history[0].toLocation).toBe('Branch A');
  });

  // 3. changes both
  it('changes both custodian and location', async () => {
    const asset = await createPostedAsset('Alice', 'HQ');
    await transferSvc.transfer(
      asset.id,
      {
        transferDate: '2026-05-08',
        toCustodian: 'Bob',
        toLocation: 'Branch B',
        reason: 'reassignment',
      },
      userId,
    );
    const updated = await prisma.fixedAsset.findUnique({
      where: { id: asset.id },
    });
    expect(updated!.custodian).toBe('Bob');
    expect(updated!.location).toBe('Branch B');
  });

  // 4. rejects if asset.status != POSTED
  it('rejects if asset.status !== POSTED', async () => {
    const draft = await svc.createDraft(
      { ...baseDto, custodian: 'Alice', location: 'HQ' },
      userId,
    );
    await expect(
      transferSvc.transfer(
        draft.id,
        {
          transferDate: '2026-05-08',
          toCustodian: 'Bob',
          reason: 'should fail',
        },
        userId,
      ),
    ).rejects.toThrow(/POSTED/);
  });

  // 5. rejects if both toCustodian and toLocation are empty/unchanged
  it('rejects if both toCustodian and toLocation are empty/unchanged (no change requested)', async () => {
    const asset = await createPostedAsset('Alice', 'HQ');
    await expect(
      transferSvc.transfer(
        asset.id,
        {
          transferDate: '2026-05-08',
          reason: 'no change',
        },
        userId,
      ),
    ).rejects.toThrow(/no change/i);
  });

  // 6. rejects if reason is empty
  it('rejects if reason is empty', async () => {
    const asset = await createPostedAsset();
    await expect(
      transferSvc.transfer(
        asset.id,
        {
          transferDate: '2026-05-08',
          toCustodian: 'Bob',
          reason: '',
        },
        userId,
      ),
    ).rejects.toThrow();
  });

  // 7. rejects if transferDate is in the future
  it('rejects if transferDate is in the future', async () => {
    const asset = await createPostedAsset();
    const future = new Date();
    future.setFullYear(future.getFullYear() + 1);
    await expect(
      transferSvc.transfer(
        asset.id,
        {
          transferDate: future.toISOString().slice(0, 10),
          toCustodian: 'Bob',
          reason: 'future test',
        },
        userId,
      ),
    ).rejects.toThrow(/future|อนาคต/i);
  });

  // 8. writes AuditLog ASSET_TRANSFER
  it('writes AuditLog with action=ASSET_TRANSFER (oldValue + newValue)', async () => {
    const asset = await createPostedAsset('Alice', 'HQ');
    await transferSvc.transfer(
      asset.id,
      {
        transferDate: '2026-05-08',
        toCustodian: 'Bob',
        reason: 'reassign to Bob',
      },
      userId,
    );
    const log = await prisma.auditLog.findFirst({
      where: {
        entity: 'fixed_asset',
        entityId: asset.id,
        action: 'ASSET_TRANSFER',
      },
    });
    expect(log).toBeTruthy();
    expect((log!.oldValue as any).custodian).toBe('Alice');
    expect((log!.oldValue as any).location).toBe('HQ');
    expect((log!.newValue as any).custodian).toBe('Bob');
    expect((log!.newValue as any).location).toBe('HQ');
    expect((log!.newValue as any).transferId).toMatch(/^TRF-[a-f0-9]{12}$/);
    expect((log!.newValue as any).reason).toBe('reassign to Bob');
  });

  // 9. multiple transfers stack in history
  it('multiple transfers stack in history (asset has 2 history rows after 2 transfers)', async () => {
    const asset = await createPostedAsset('A', 'HQ');
    await transferSvc.transfer(
      asset.id,
      { transferDate: '2026-05-07', toCustodian: 'B', reason: 'first transfer' },
      userId,
    );
    await transferSvc.transfer(
      asset.id,
      { transferDate: '2026-05-08', toCustodian: 'C', reason: 'second transfer' },
      userId,
    );
    const history = await prisma.assetTransferHistory.findMany({
      where: { assetId: asset.id },
      orderBy: { transferDate: 'asc' },
    });
    expect(history).toHaveLength(2);
    expect(history[0].fromCustodian).toBe('A');
    expect(history[0].toCustodian).toBe('B');
    expect(history[1].fromCustodian).toBe('B');
    expect(history[1].toCustodian).toBe('C');
  });

  // 10. transferId is unique and TRF-prefixed (TRF-<12 hex chars>, crypto.randomUUID)
  it('transferId is unique and TRF-prefixed (regex /^TRF-[a-f0-9]{12}$/)', async () => {
    const asset = await createPostedAsset();
    await transferSvc.transfer(
      asset.id,
      { transferDate: '2026-05-08', toCustodian: 'Bob', reason: 'unique id test' },
      userId,
    );
    const history = await prisma.assetTransferHistory.findFirst({
      where: { assetId: asset.id },
    });
    expect(history).toBeTruthy();
    expect(history!.transferId).toMatch(/^TRF-[a-f0-9]{12}$/);
  });
});
