import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { DunningEngineService } from './dunning-engine.service';
import { MdmLockService } from './mdm-lock.service';

const mockPrisma = {
  contract: { findFirst: jest.fn(), update: jest.fn() },
  mdmLockRequest: {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    findMany: jest.fn(),
  },
  user: { findFirst: jest.fn(), findUnique: jest.fn() },
  systemConfig: { findUnique: jest.fn() },
  auditLog: { create: jest.fn() },
  $transaction: jest.fn(async (ops: unknown[]) => ops),
};
const mockEngine = { executeEventTrigger: jest.fn().mockResolvedValue(undefined) };

describe('MdmLockService', () => {
  let service: MdmLockService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MdmLockService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: DunningEngineService, useValue: mockEngine },
      ],
    }).compile();
    service = module.get(MdmLockService);
  });

  describe('proposeManual', () => {
    it('throws when reason < 5 chars', async () => {
      await expect(service.proposeManual('c1', 'u1', 'x')).rejects.toThrow(/≥ 5/);
    });

    it('throws NotFound when contract missing', async () => {
      mockPrisma.contract.findFirst.mockResolvedValueOnce(null);
      await expect(service.proposeManual('c1', 'u1', 'ลูกค้าไม่ติดต่อ')).rejects.toThrow(/ไม่พบ/);
    });

    it('creates PENDING MANUAL_COLLECTOR with includeWallpaper=true', async () => {
      mockPrisma.contract.findFirst.mockResolvedValueOnce({ id: 'c1' });
      mockPrisma.mdmLockRequest.findFirst.mockResolvedValueOnce(null);
      const fakeReq = {
        id: 'r1',
        status: 'PENDING',
        trigger: 'MANUAL_COLLECTOR',
        includeWallpaper: true,
      };
      mockPrisma.mdmLockRequest.create.mockResolvedValueOnce(fakeReq);

      const result = await service.proposeManual('c1', 'u1', 'ลูกค้าไม่ติดต่อ 3 วัน');
      expect(result).toEqual(fakeReq);
      const createArg = mockPrisma.mdmLockRequest.create.mock.calls[0][0];
      expect(createArg.data.trigger).toBe('MANUAL_COLLECTOR');
      expect(createArg.data.includeWallpaper).toBe(true);
      expect(createArg.data.proposedById).toBe('u1');
    });

    it('returns existing PENDING request (idempotent)', async () => {
      mockPrisma.contract.findFirst.mockResolvedValueOnce({ id: 'c1' });
      const existing = { id: 'r0', status: 'PENDING' };
      mockPrisma.mdmLockRequest.findFirst.mockResolvedValueOnce(existing);

      const result = await service.proposeManual('c1', 'u1', 'ลูกค้าไม่ติดต่อ');
      expect(result).toBe(existing);
      expect(mockPrisma.mdmLockRequest.create).not.toHaveBeenCalled();
    });
  });

  describe('proposeAuto', () => {
    it('uses SYSTEM user as proposer', async () => {
      mockPrisma.contract.findFirst.mockResolvedValueOnce({ id: 'c1' });
      mockPrisma.mdmLockRequest.findFirst.mockResolvedValueOnce(null);
      mockPrisma.user.findFirst.mockResolvedValueOnce({ id: 'system-user' });
      mockPrisma.mdmLockRequest.create.mockResolvedValueOnce({ id: 'r1' });

      await service.proposeAuto('c1', 'UNCONTACTABLE_3D', 'auto');
      const createArg = mockPrisma.mdmLockRequest.create.mock.calls[0][0];
      expect(createArg.data.proposedById).toBe('system-user');
      expect(createArg.data.trigger).toBe('UNCONTACTABLE_3D');
    });

    it('throws if SYSTEM user not seeded', async () => {
      mockPrisma.contract.findFirst.mockResolvedValueOnce({ id: 'c1' });
      mockPrisma.mdmLockRequest.findFirst.mockResolvedValueOnce(null);
      mockPrisma.user.findFirst.mockResolvedValueOnce(null);
      await expect(service.proposeAuto('c1', 'UNCONTACTABLE_3D', 'auto')).rejects.toThrow(
        /SYSTEM user/,
      );
    });
  });

  describe('approve', () => {
    it('flips to EXECUTED_MANUAL + sets contract lock flags + fires DEVICE_LOCKED', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({ role: 'OWNER' });
      mockPrisma.mdmLockRequest.findUnique.mockResolvedValueOnce({
        id: 'r1',
        status: 'PENDING',
        contractId: 'c1',
        includeWallpaper: true,
        trigger: 'MANUAL_COLLECTOR',
      });
      mockPrisma.systemConfig.findUnique.mockResolvedValueOnce({ value: 'https://s3/wall.png' });
      const updatedReq = { id: 'r1', status: 'EXECUTED_MANUAL' };
      mockPrisma.$transaction.mockResolvedValueOnce([updatedReq, {}, {}]);

      const result = await service.approve('r1', 'owner1');
      expect(result).toEqual(updatedReq);
      expect(mockEngine.executeEventTrigger).toHaveBeenCalledWith(
        'DEVICE_LOCKED',
        'c1',
        null,
        null,
      );
    });

    it('forbids SALES', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({ role: 'SALES' });
      await expect(service.approve('r1', 'sales1')).rejects.toThrow(/สิทธิ์อนุมัติ/);
    });

    it('rejects if request not PENDING', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({ role: 'OWNER' });
      mockPrisma.mdmLockRequest.findUnique.mockResolvedValueOnce({
        id: 'r1',
        status: 'EXECUTED_MANUAL',
      });
      await expect(service.approve('r1', 'owner1')).rejects.toThrow(/รออนุมัติ/);
    });

    it('approve does not rollback if LINE send throws', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({ role: 'OWNER' });
      mockPrisma.mdmLockRequest.findUnique.mockResolvedValueOnce({
        id: 'r1',
        status: 'PENDING',
        contractId: 'c1',
        includeWallpaper: true,
        trigger: 'MANUAL_COLLECTOR',
      });
      mockPrisma.systemConfig.findUnique.mockResolvedValueOnce(null);
      mockPrisma.$transaction.mockResolvedValueOnce([{ id: 'r1', status: 'EXECUTED_MANUAL' }, {}, {}]);
      mockEngine.executeEventTrigger.mockRejectedValueOnce(new Error('line down'));

      const result = await service.approve('r1', 'owner1');
      expect(result.status).toBe('EXECUTED_MANUAL');
    });
  });

  describe('reject', () => {
    it('requires reason ≥ 5', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({ role: 'OWNER' });
      await expect(service.reject('r1', 'owner1', 'no')).rejects.toThrow(/เหตุผล/);
    });

    it('flips to REJECTED', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({ role: 'OWNER' });
      mockPrisma.mdmLockRequest.findUnique.mockResolvedValueOnce({ id: 'r1', status: 'PENDING' });
      mockPrisma.mdmLockRequest.update.mockResolvedValueOnce({ id: 'r1', status: 'REJECTED' });

      const result = await service.reject('r1', 'owner1', 'ลูกค้าติดต่อแล้ว');
      expect(result.status).toBe('REJECTED');
    });
  });

  describe('unlock', () => {
    it('refuses if request not executed', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({ role: 'OWNER' });
      mockPrisma.mdmLockRequest.findUnique.mockResolvedValueOnce({ id: 'r1', status: 'PENDING' });
      await expect(service.unlock('r1', 'owner1')).rejects.toThrow(/execute/);
    });

    it('flips contract + request + fires DEVICE_UNLOCKED', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({ role: 'OWNER' });
      mockPrisma.mdmLockRequest.findUnique.mockResolvedValueOnce({
        id: 'r1',
        status: 'EXECUTED_MANUAL',
        contractId: 'c1',
      });
      mockPrisma.$transaction.mockResolvedValueOnce([{ id: 'r1', status: 'UNLOCKED' }, {}, {}]);

      const result = await service.unlock('r1', 'owner1');
      expect(result.status).toBe('UNLOCKED');
      expect(mockEngine.executeEventTrigger).toHaveBeenCalledWith(
        'DEVICE_UNLOCKED',
        'c1',
        null,
        null,
      );
    });
  });
});
