import { Test } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { YeastarWebhookController } from './yeastar-webhook.controller';
import { IntegrationConfigService } from '../integrations/integration-config.service';
import { PrismaService } from '../../prisma/prisma.service';
import { EventsGateway } from '../notifications/events.gateway';

const mockConfigService = {
  getConfig: jest.fn().mockResolvedValue({ webhookSecret: 'secret123' }),
} as unknown as IntegrationConfigService;

const mockPrisma = {
  customer: { findFirst: jest.fn() },
  contract: { findFirst: jest.fn() },
  callLog: { upsert: jest.fn() },
  user: { findFirst: jest.fn() },
} as unknown as PrismaService;

const mockGateway = {
  emitToUser: jest.fn(),
} as unknown as EventsGateway;

describe('YeastarWebhookController', () => {
  let controller: YeastarWebhookController;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      controllers: [YeastarWebhookController],
      providers: [
        { provide: IntegrationConfigService, useValue: mockConfigService },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EventsGateway, useValue: mockGateway },
      ],
    }).compile();

    controller = module.get(YeastarWebhookController);
    jest.clearAllMocks();
  });

  it('rejects request with wrong token', async () => {
    await expect(
      controller.handleEvent({ event: 'ExtensionCallStatus' }, 'wrong-token'),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('handles ExtensionCallStatus RINGING — emits socket to agent', async () => {
    (mockPrisma.customer.findFirst as jest.Mock).mockResolvedValue({
      id: 'cust-1',
      name: 'สมชาย',
    });
    (mockPrisma.contract.findFirst as jest.Mock).mockResolvedValue({
      id: 'con-1',
      contractNumber: 'BC-001',
    });
    (mockPrisma.user.findFirst as jest.Mock).mockResolvedValue({ id: 'user-1' });

    await controller.handleEvent(
      {
        event: 'ExtensionCallStatus',
        callId: 'call-abc',
        callStatus: 'RINGING',
        callerNumber: '0812345678',
        answeredBy: '1001',
      },
      'secret123',
    );

    expect(mockGateway.emitToUser).toHaveBeenCalledWith(
      'user-1',
      'yeastar:inbound',
      expect.objectContaining({ callerNumber: '0812345678' }),
    );
  });

  it('skips NewCdr when no matching customer', async () => {
    (mockPrisma.customer.findFirst as jest.Mock).mockResolvedValue(null);

    await controller.handleEvent(
      {
        event: 'NewCdr',
        id: 'cdr-1',
        callFrom: '0899999999',
        callTo: '1001',
        duration: 120,
        startTime: '2026-04-25T10:00:00Z',
        callType: 'Inbound',
      },
      'secret123',
    );

    expect(mockPrisma.callLog.upsert).not.toHaveBeenCalled();
  });
});
