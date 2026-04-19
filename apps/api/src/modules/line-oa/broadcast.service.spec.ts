import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BroadcastService } from './broadcast.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { IntegrationConfigService } from '../integrations/integration-config.service';

describe('BroadcastService approval workflow (P2Q15=A)', () => {
  let service: BroadcastService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  const pendingRecord = (overrides: Record<string, unknown> = {}) => ({
    id: 'br-1',
    messages: [{ type: 'text', content: 'hi' }],
    audience: 'ALL',
    audienceCount: 100,
    status: 'PENDING_APPROVAL',
    scheduledAt: null,
    createdById: 'u-creator',
    approvedById: null,
    approvedAt: null,
    ...overrides,
  });

  beforeEach(async () => {
    prisma = {
      broadcastMessage: {
        findUnique: jest.fn().mockResolvedValue(pendingRecord()),
        update: jest.fn((args) => Promise.resolve({ ...pendingRecord(), ...args.data })),
        create: jest.fn((args) => Promise.resolve({ id: 'br-1', ...args.data })),
      },
      customer: { count: jest.fn().mockResolvedValue(0) },
      customerLineLink: { count: jest.fn().mockResolvedValue(0) },
    };

    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        BroadcastService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: StorageService, useValue: { upload: jest.fn() } },
        { provide: IntegrationConfigService, useValue: { getValue: jest.fn() } },
      ],
    }).compile();
    service = mod.get(BroadcastService);

    // Stub the send dispatcher so we don't hit LINE
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any).dispatchLineMessages = jest.fn().mockResolvedValue({
      success: true,
      message: 'sent',
    });
  });

  it('sendBroadcast saves as PENDING_APPROVAL (no immediate dispatch)', async () => {
    const result = await service.sendBroadcast({
      messages: [{ type: 'text', content: 'hi' }],
      audience: 'ALL',
      createdById: 'u-creator',
    });
    expect(result.success).toBe(true);
    expect(result.message).toMatch(/รอผู้อนุมัติ/);
    const createArgs = prisma.broadcastMessage.create.mock.calls[0][0];
    expect(createArgs.data.status).toBe('PENDING_APPROVAL');
  });

  it('approveBroadcast rejects self-approval by creator', async () => {
    await expect(
      service.approveBroadcast('br-1', 'u-creator'),
    ).rejects.toThrow(ForbiddenException);
  });

  it('approveBroadcast rejects records already in SENT state', async () => {
    prisma.broadcastMessage.findUnique.mockResolvedValue(pendingRecord({ status: 'SENT' }));
    await expect(
      service.approveBroadcast('br-1', 'u-approver'),
    ).rejects.toThrow(BadRequestException);
  });

  it('approveBroadcast throws NotFound for missing id', async () => {
    prisma.broadcastMessage.findUnique.mockResolvedValue(null);
    await expect(
      service.approveBroadcast('missing', 'u-approver'),
    ).rejects.toThrow(NotFoundException);
  });

  it('approveBroadcast marks SCHEDULED when scheduledAt in future', async () => {
    const future = new Date(Date.now() + 60 * 60 * 1000);
    prisma.broadcastMessage.findUnique.mockResolvedValue(
      pendingRecord({ scheduledAt: future }),
    );

    await service.approveBroadcast('br-1', 'u-approver');

    const updateArgs = prisma.broadcastMessage.update.mock.calls[0][0];
    expect(updateArgs.data.status).toBe('SCHEDULED');
    expect(updateArgs.data.approvedById).toBe('u-approver');
    expect(updateArgs.data.approvedAt).toBeInstanceOf(Date);
  });

  it('approveBroadcast dispatches immediately when not scheduled', async () => {
    await service.approveBroadcast('br-1', 'u-approver');
    const updateArgs = prisma.broadcastMessage.update.mock.calls[0][0];
    expect(updateArgs.data.status).toBe('SENT');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((service as any).dispatchLineMessages).toHaveBeenCalled();
  });

  it('rejectBroadcast requires reason ≥ 5 chars', async () => {
    await expect(
      service.rejectBroadcast('br-1', 'u-approver', 'bad'),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejectBroadcast blocks self-rejection by creator', async () => {
    await expect(
      service.rejectBroadcast('br-1', 'u-creator', 'looks fishy'),
    ).rejects.toThrow(ForbiddenException);
  });

  it('rejectBroadcast updates status REJECTED with reason', async () => {
    await service.rejectBroadcast('br-1', 'u-approver', 'message copy looks phishy');
    const updateArgs = prisma.broadcastMessage.update.mock.calls[0][0];
    expect(updateArgs.data.status).toBe('REJECTED');
    expect(updateArgs.data.rejectedReason).toBe('message copy looks phishy');
    expect(updateArgs.data.rejectedById).toBe('u-approver');
  });
});
