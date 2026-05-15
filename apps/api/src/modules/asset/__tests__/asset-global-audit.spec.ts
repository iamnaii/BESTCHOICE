import { Test, TestingModule } from '@nestjs/testing';
import { AssetController } from '../asset.controller';
import { AssetService } from '../asset.service';
import { AssetTransferService } from '../asset-transfer.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { BranchGuard } from '../../auth/guards/branch.guard';

describe('AssetController — GET /assets/audit (global)', () => {
  let controller: AssetController;
  let assetService: { listGlobalAudit: jest.Mock };

  // Fake Prisma — used directly in service calls to verify query shape
  let prisma: {
    auditLog: { findMany: jest.Mock; count: jest.Mock };
    fixedAsset: { findMany: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      auditLog: { findMany: jest.fn(), count: jest.fn() },
      fixedAsset: { findMany: jest.fn() },
    };

    // Stub AssetService so we don't pull in the full template DI chain.
    // We delegate to a real listGlobalAudit bound to our prisma mock so
    // the Prisma call assertions still work.
    const realService = new (AssetService as any)(prisma as unknown as PrismaService);
    assetService = { listGlobalAudit: jest.fn((...args) => realService.listGlobalAudit(...args)) };

    const transferServiceStub = { transfer: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AssetController],
      providers: [
        { provide: AssetService, useValue: assetService },
        { provide: AssetTransferService, useValue: transferServiceStub },
        { provide: PrismaService, useValue: prisma },
      ],
    })
      .overrideGuard(JwtAuthGuard).useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard).useValue({ canActivate: () => true })
      .overrideGuard(BranchGuard).useValue({ canActivate: () => true })
      .compile();

    controller = module.get(AssetController);
  });

  it('returns paginated audit rows with entity="fixed_asset"', async () => {
    prisma.auditLog.findMany.mockResolvedValue([
      {
        id: 'a1',
        action: 'ASSET_POST',
        entity: 'fixed_asset',
        entityId: 'asset-1',
        userId: 'u1',
        user: { id: 'u1', name: 'Test User' },
        oldValue: {},
        newValue: {},
        ipAddress: null,
        createdAt: new Date(),
      },
    ]);
    prisma.auditLog.count.mockResolvedValue(1);
    prisma.fixedAsset.findMany.mockResolvedValue([
      { id: 'asset-1', assetCode: 'EQ-001', name: 'MacBook' },
    ]);

    const result = await controller.listGlobalAudit(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    );

    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ entity: 'fixed_asset' }),
        take: 50,
        skip: 0,
      }),
    );
    expect(result.data).toHaveLength(1);
    expect(result.data[0].assetCode).toBe('EQ-001');
    expect(result.data[0].assetName).toBe('MacBook');
    expect(result.total).toBe(1);
  });

  it('respects page + limit (max 200)', async () => {
    prisma.auditLog.findMany.mockResolvedValue([]);
    prisma.auditLog.count.mockResolvedValue(0);
    prisma.fixedAsset.findMany.mockResolvedValue([]);

    await controller.listGlobalAudit('3', '500', undefined, undefined, undefined);

    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 200, // capped from 500
        skip: 400, // (page 3 - 1) * 200
      }),
    );
  });

  it('filters by action when provided', async () => {
    prisma.auditLog.findMany.mockResolvedValue([]);
    prisma.auditLog.count.mockResolvedValue(0);
    prisma.fixedAsset.findMany.mockResolvedValue([]);

    await controller.listGlobalAudit(
      undefined,
      undefined,
      'ASSET_POST',
      undefined,
      undefined,
    );

    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ entity: 'fixed_asset', action: 'ASSET_POST' }),
      }),
    );
  });

  it('filters by date range when provided', async () => {
    prisma.auditLog.findMany.mockResolvedValue([]);
    prisma.auditLog.count.mockResolvedValue(0);
    prisma.fixedAsset.findMany.mockResolvedValue([]);

    await controller.listGlobalAudit(
      undefined,
      undefined,
      undefined,
      '2026-05-01',
      '2026-05-31',
    );

    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          entity: 'fixed_asset',
          createdAt: expect.objectContaining({
            gte: expect.any(Date),
            lte: expect.any(Date),
          }),
        }),
      }),
    );
  });
});
