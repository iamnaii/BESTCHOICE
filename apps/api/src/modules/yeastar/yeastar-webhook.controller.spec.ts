import { Test } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { createHmac } from 'crypto';
import { YeastarWebhookController } from './yeastar-webhook.controller';
import { IntegrationConfigService } from '../integrations/integration-config.service';
import { PrismaService } from '../../prisma/prisma.service';
import { EventsGateway } from '../notifications/events.gateway';

const fakeReq = (rawBody?: Buffer) => ({ rawBody, headers: {}, ip: '127.0.0.1' }) as never;

const mockConfigService = {
  getConfig: jest.fn().mockResolvedValue({ webhookSecret: 'secret123' }),
} as unknown as IntegrationConfigService;

const mockPrisma = {
  customer: { findFirst: jest.fn() },
  contract: { findFirst: jest.fn() },
  callLog: { upsert: jest.fn() },
  user: { findFirst: jest.fn() },
  payment: { count: jest.fn().mockResolvedValue(0) },
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
      controller.handleEvent({ event: 'ExtensionCallStatus' }, 'wrong-token', undefined, fakeReq()),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('accepts request with valid HMAC signature', async () => {
    const body = { event: 'ExtensionCallStatus', callStatus: 'RINGING', callerNumber: '0812345678' };
    const rawBody = Buffer.from(JSON.stringify(body));
    const signature = createHmac('sha256', 'secret123').update(rawBody).digest('hex');

    (mockPrisma.customer.findFirst as jest.Mock).mockResolvedValue(null);

    await expect(
      controller.handleEvent(body, '', signature, fakeReq(rawBody)),
    ).resolves.toEqual({ ok: true });
  });

  it('rejects request with invalid HMAC signature', async () => {
    const body = { event: 'ExtensionCallStatus' };
    const rawBody = Buffer.from(JSON.stringify(body));
    const wrongSig = createHmac('sha256', 'wrong-secret').update(rawBody).digest('hex');

    await expect(
      controller.handleEvent(body, '', wrongSig, fakeReq(rawBody)),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('handles ExtensionCallStatus RINGING — emits socket to agent with overdueCount', async () => {
    (mockPrisma.customer.findFirst as jest.Mock).mockResolvedValue({
      id: 'cust-1',
      name: 'สมชาย',
    });
    (mockPrisma.contract.findFirst as jest.Mock).mockResolvedValue({
      id: 'con-1',
      contractNumber: 'BC-001',
    });
    (mockPrisma.user.findFirst as jest.Mock).mockResolvedValue({ id: 'user-1' });
    (mockPrisma.payment.count as jest.Mock).mockResolvedValue(3);

    await controller.handleEvent(
      {
        event: 'ExtensionCallStatus',
        callId: 'call-abc',
        callStatus: 'RINGING',
        callerNumber: '0812345678',
        answeredBy: '1001',
      },
      'secret123',
      undefined,
      fakeReq(),
    );

    expect(mockGateway.emitToUser).toHaveBeenCalledWith(
      'user-1',
      'yeastar:inbound',
      expect.objectContaining({ callerNumber: '0812345678', overdueCount: 3 }),
    );
  });

  it('does not throw when EventsGateway is null (ENABLE_WEBSOCKET=false)', async () => {
    const module = await Test.createTestingModule({
      controllers: [YeastarWebhookController],
      providers: [
        { provide: IntegrationConfigService, useValue: mockConfigService },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EventsGateway, useValue: null },
      ],
    }).compile();
    const c = module.get(YeastarWebhookController);

    (mockPrisma.customer.findFirst as jest.Mock).mockResolvedValue({
      id: 'cust-1',
      name: 'สมชาย',
    });
    (mockPrisma.contract.findFirst as jest.Mock).mockResolvedValue({
      id: 'con-1',
      contractNumber: 'BC-001',
    });
    (mockPrisma.user.findFirst as jest.Mock).mockResolvedValue({ id: 'user-1' });

    await expect(
      c.handleEvent(
        {
          event: 'ExtensionCallStatus',
          callId: 'call-abc',
          callStatus: 'RINGING',
          callerNumber: '0812345678',
          answeredBy: '1001',
        },
        'secret123',
        undefined,
        fakeReq(),
      ),
    ).resolves.toEqual({ ok: true });
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
      undefined,
      fakeReq(),
    );

    expect(mockPrisma.callLog.upsert).not.toHaveBeenCalled();
  });
});
