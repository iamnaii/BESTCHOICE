import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../prisma/prisma.service';
import { MdmLockService } from '../mdm-lock.service';
import { OwnerAlertHelper } from '../owner-alert.helper';
import { MdmAutoProposeCron } from './mdm-auto-propose.cron';

const mockPrisma = {
  systemConfig: { findUnique: jest.fn() },
  contract: { findMany: jest.fn() },
  user: { findFirst: jest.fn() },
  $queryRaw: jest.fn(),
};
const mockMdmService = { proposeAuto: jest.fn() };
const mockOwnerAlert = {
  sendToAllOwners: jest.fn().mockResolvedValue({ sent: 1, failed: 0 }),
};

describe('MdmAutoProposeCron', () => {
  let cron: MdmAutoProposeCron;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockOwnerAlert.sendToAllOwners.mockResolvedValue({ sent: 1, failed: 0 });
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MdmAutoProposeCron,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: MdmLockService, useValue: mockMdmService },
        { provide: OwnerAlertHelper, useValue: mockOwnerAlert },
      ],
    }).compile();
    cron = module.get(MdmAutoProposeCron);

    // Default configs: enabled, thresholds default
    mockPrisma.systemConfig.findUnique.mockImplementation(
      ({ where: { key } }: { where: { key: string } }) => {
        if (key === 'mdm_auto_propose_enabled') return Promise.resolve({ value: 'true' });
        if (key === 'mdm_uncontactable_threshold_hours') return Promise.resolve({ value: '72' });
        if (key === 'mdm_no_promise_threshold_days') return Promise.resolve({ value: '3' });
        return Promise.resolve(null);
      },
    );
    mockPrisma.$queryRaw.mockResolvedValue([]);
    mockPrisma.contract.findMany.mockResolvedValue([]);
    mockPrisma.user.findFirst.mockResolvedValue({ id: 'system-user-id' }); // M2 cache
  });

  it('skips when mdm_auto_propose_enabled=false', async () => {
    mockPrisma.systemConfig.findUnique.mockImplementationOnce(() =>
      Promise.resolve({ value: 'false' }),
    );
    const result = await cron.run();
    expect(result).toEqual({ uncontactable: 0, noPromise: 0 });
    expect(mockMdmService.proposeAuto).not.toHaveBeenCalled();
  });

  it('proposes UNCONTACTABLE_3D for contracts returned by the raw query', async () => {
    mockPrisma.$queryRaw.mockResolvedValueOnce([
      { contract_id: 'c1' },
      { contract_id: 'c2' },
    ]);
    await cron.run();
    expect(mockMdmService.proposeAuto).toHaveBeenCalledTimes(2);
    expect(mockMdmService.proposeAuto).toHaveBeenCalledWith(
      'c1',
      'UNCONTACTABLE_3D',
      expect.any(String),
      'system-user-id', // M2: cron passes pre-resolved systemUserId
    );
  });

  it('proposes NO_PROMISE_3D for contracts from findMany', async () => {
    mockPrisma.contract.findMany.mockResolvedValueOnce([{ id: 'c3' }]);
    await cron.run();
    expect(mockMdmService.proposeAuto).toHaveBeenCalledWith(
      'c3',
      'NO_PROMISE_3D',
      expect.any(String),
      'system-user-id', // M2 pre-resolved
    );
  });

  it('deduplicates contracts already in UNCONTACTABLE from NO_PROMISE', async () => {
    mockPrisma.$queryRaw.mockResolvedValueOnce([{ contract_id: 'c4' }]);
    mockPrisma.contract.findMany.mockResolvedValueOnce([{ id: 'c4' }, { id: 'c5' }]);
    await cron.run();
    // c4 proposed as UNCONTACTABLE_3D only, c5 proposed as NO_PROMISE_3D
    const calls = mockMdmService.proposeAuto.mock.calls;
    expect(calls.length).toBe(2);
    const triggers = calls.map((c: unknown[]) => c[1]);
    expect(triggers.sort()).toEqual(['NO_PROMISE_3D', 'UNCONTACTABLE_3D']);
  });

  it('does not throw when individual propose fails', async () => {
    mockPrisma.$queryRaw.mockResolvedValueOnce([{ contract_id: 'c1' }]);
    mockMdmService.proposeAuto.mockRejectedValueOnce(new Error('db down'));
    await expect(cron.run()).resolves.toBeTruthy();
  });

  it('sends OWNER alert when new requests are proposed', async () => {
    mockPrisma.$queryRaw.mockResolvedValueOnce([{ contract_id: 'c1' }]);
    mockPrisma.contract.findMany.mockResolvedValueOnce([{ id: 'c2' }]);
    await cron.run();
    expect(mockOwnerAlert.sendToAllOwners).toHaveBeenCalledWith(
      expect.stringContaining('คำขอล็อคเครื่อง'),
      'mdm-auto-propose',
    );
  });

  it('skips OWNER alert when nothing was proposed', async () => {
    // $queryRaw returns empty, contract.findMany returns empty (defaults already set in beforeEach)
    await cron.run();
    expect(mockOwnerAlert.sendToAllOwners).not.toHaveBeenCalled();
  });

  it('does not fail the cron when OWNER alert throws', async () => {
    mockPrisma.$queryRaw.mockResolvedValueOnce([{ contract_id: 'c1' }]);
    mockOwnerAlert.sendToAllOwners.mockRejectedValueOnce(new Error('LINE down'));
    await expect(cron.run()).resolves.toBeTruthy();
  });
});
