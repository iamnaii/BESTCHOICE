import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../prisma/prisma.service';
import { ContractLetterService } from '../contract-letter.service';
import { OwnerAlertHelper } from '../owner-alert.helper';
import { LetterAutoGenerateCron } from './letter-auto-generate.cron';

const mockPrisma = {
  systemConfig: { findUnique: jest.fn() },
  contract: { findMany: jest.fn() },
};

const mockLetterService = {
  createIfNotExists: jest.fn(),
};

const mockOwnerAlert = {
  sendToAllOwners: jest.fn().mockResolvedValue({ sent: 1, failed: 0 }),
};

describe('LetterAutoGenerateCron', () => {
  let cron: LetterAutoGenerateCron;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockOwnerAlert.sendToAllOwners.mockResolvedValue({ sent: 1, failed: 0 });
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LetterAutoGenerateCron,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ContractLetterService, useValue: mockLetterService },
        { provide: OwnerAlertHelper, useValue: mockOwnerAlert },
      ],
    }).compile();
    cron = module.get(LetterAutoGenerateCron);

    // Default: enabled + default thresholds
    mockPrisma.systemConfig.findUnique.mockImplementation(
      ({ where: { key } }: { where: { key: string } }) => {
        if (key === 'letter_auto_generate_enabled') return Promise.resolve({ value: 'true' });
        if (key === 'letter_return_device_days') return Promise.resolve({ value: '45' });
        if (key === 'letter_termination_days') return Promise.resolve({ value: '60' });
        return Promise.resolve(null);
      },
    );
    mockPrisma.contract.findMany.mockResolvedValue([]);
    mockLetterService.createIfNotExists.mockResolvedValue({ id: 'letter-new' });
  });

  it('skips all processing when letter_auto_generate_enabled=false', async () => {
    mockPrisma.systemConfig.findUnique.mockImplementationOnce(() =>
      Promise.resolve({ value: 'false' }),
    );
    const result = await cron.run();
    expect(result).toEqual({ returnDevice: 0, termination: 0 });
    expect(mockPrisma.contract.findMany).not.toHaveBeenCalled();
    expect(mockLetterService.createIfNotExists).not.toHaveBeenCalled();
  });

  it('creates RETURN_DEVICE_45D for matching contracts', async () => {
    mockPrisma.contract.findMany
      .mockResolvedValueOnce([{ id: 'c1' }, { id: 'c2' }]) // returnCandidates
      .mockResolvedValueOnce([]); // terminationCandidates

    const result = await cron.run();
    expect(result.returnDevice).toBe(2);
    expect(result.termination).toBe(0);
    expect(mockLetterService.createIfNotExists).toHaveBeenCalledTimes(2);
    expect(mockLetterService.createIfNotExists).toHaveBeenCalledWith('c1', 'RETURN_DEVICE_45D');
    expect(mockLetterService.createIfNotExists).toHaveBeenCalledWith('c2', 'RETURN_DEVICE_45D');
  });

  it('creates CONTRACT_TERMINATION_60D for matching contracts', async () => {
    mockPrisma.contract.findMany
      .mockResolvedValueOnce([]) // returnCandidates
      .mockResolvedValueOnce([{ id: 'c3' }, { id: 'c4' }, { id: 'c5' }]); // terminationCandidates

    const result = await cron.run();
    expect(result.returnDevice).toBe(0);
    expect(result.termination).toBe(3);
    expect(mockLetterService.createIfNotExists).toHaveBeenCalledTimes(3);
    expect(mockLetterService.createIfNotExists).toHaveBeenCalledWith('c3', 'CONTRACT_TERMINATION_60D');
  });

  it('does not abort the cron when individual createIfNotExists throws', async () => {
    mockPrisma.contract.findMany
      .mockResolvedValueOnce([{ id: 'c6' }, { id: 'c7' }]) // returnCandidates
      .mockResolvedValueOnce([]); // terminationCandidates

    mockLetterService.createIfNotExists
      .mockRejectedValueOnce(new Error('DB error'))
      .mockResolvedValueOnce({ id: 'letter-ok' });

    const result = await cron.run();
    // c6 failed, c7 succeeded → returnDevice = 1
    expect(result.returnDevice).toBe(1);
    expect(result.termination).toBe(0);
  });

  it('respects custom threshold config values when querying candidates', async () => {
    mockPrisma.systemConfig.findUnique.mockImplementation(
      ({ where: { key } }: { where: { key: string } }) => {
        if (key === 'letter_auto_generate_enabled') return Promise.resolve({ value: 'true' });
        if (key === 'letter_return_device_days') return Promise.resolve({ value: '30' });
        if (key === 'letter_termination_days') return Promise.resolve({ value: '45' });
        return Promise.resolve(null);
      },
    );
    mockPrisma.contract.findMany.mockResolvedValue([]);

    await cron.run();

    // Verify findMany was called twice (return + termination queries)
    expect(mockPrisma.contract.findMany).toHaveBeenCalledTimes(2);
  });

  it('handles outer catch block and returns zeros on catastrophic error', async () => {
    mockPrisma.systemConfig.findUnique
      .mockResolvedValueOnce({ value: 'true' }) // enabled check passes
      .mockRejectedValueOnce(new Error('config read failed')); // subsequent read fails

    const result = await cron.run();
    expect(result).toEqual({ returnDevice: 0, termination: 0 });
  });

  it('sends OWNER alert when new letters were created', async () => {
    mockPrisma.contract.findMany
      .mockResolvedValueOnce([{ id: 'c1' }]) // returnCandidates
      .mockResolvedValueOnce([{ id: 'c2' }, { id: 'c3' }]); // terminationCandidates

    await cron.run();

    expect(mockOwnerAlert.sendToAllOwners).toHaveBeenCalledWith(
      expect.stringContaining('หนังสือทวงถาม'),
      'letter-auto-generate',
    );
  });

  it('skips OWNER alert when no letters were created', async () => {
    // Both findMany return empty (defaults already set in beforeEach)
    await cron.run();
    expect(mockOwnerAlert.sendToAllOwners).not.toHaveBeenCalled();
  });

  it('does not fail the cron when OWNER alert throws', async () => {
    mockPrisma.contract.findMany
      .mockResolvedValueOnce([{ id: 'c1' }])
      .mockResolvedValueOnce([]);
    mockOwnerAlert.sendToAllOwners.mockRejectedValueOnce(new Error('LINE down'));

    await expect(cron.run()).resolves.toBeTruthy();
  });
});
