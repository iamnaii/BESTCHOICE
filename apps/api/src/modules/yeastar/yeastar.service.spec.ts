import { YeastarService } from './yeastar.service';
import { YeastarTokenService } from './yeastar-token.service';
import { IntegrationConfigService } from '../integrations/integration-config.service';
import { PrismaService } from '../../prisma/prisma.service';

const mockTokenService = {
  getToken: jest.fn().mockResolvedValue('tok-123'),
} as unknown as YeastarTokenService;

const mockConfigService = {
  getConfig: jest.fn().mockResolvedValue({
    pbxUrl: 'https://pbx.example.com',
    clientId: 'id',
    clientSecret: 'secret',
  }),
} as unknown as IntegrationConfigService;

const mockPrisma = {
  user: { findFirst: jest.fn() },
  customer: { findFirst: jest.fn() },
} as unknown as PrismaService;

describe('YeastarService', () => {
  let service: YeastarService;

  beforeEach(() => {
    service = new YeastarService(mockTokenService, mockConfigService, mockPrisma);
    jest.clearAllMocks();
  });

  it('originateCall calls Yeastar dial API', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ call_id: 'call-abc' }),
    }) as jest.Mock;

    const result = await service.originateCall('1001', '0812345678');
    expect(result).toEqual({ callId: 'call-abc' });
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/openapi/v1.0/call/dial'),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('getExtensions returns list', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        extension_list: [{ number: '1001', name: 'แนน', status: 'Idle' }],
      }),
    }) as jest.Mock;

    const result = await service.getExtensions();
    expect(result).toHaveLength(1);
    expect(result[0].number).toBe('1001');
  });

  it('throws when Yeastar API returns error', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => 'Bad request',
    }) as jest.Mock;

    await expect(service.originateCall('1001', '0812345678')).rejects.toThrow();
  });

  it('sends Authorization header instead of access_token query', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ extension_list: [] }),
    }) as jest.Mock;
    global.fetch = fetchMock;

    await service.getExtensions();

    const [calledUrl, calledOpts] = fetchMock.mock.calls[0];
    expect(calledUrl).not.toContain('access_token=');
    expect((calledOpts as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer tok-123',
    });
  });

  it('originateForUser delegates to originateCall after Prisma lookup', async () => {
    (mockPrisma.user.findFirst as jest.Mock).mockResolvedValue({ yeastarExtension: '1001' });
    (mockPrisma.customer.findFirst as jest.Mock).mockResolvedValue({ phone: '0812345678' });
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ call_id: 'call-xyz' }),
    }) as jest.Mock;

    const result = await service.originateForUser('user-1', 'cust-1');
    expect(result).toEqual({ callId: 'call-xyz' });
  });

  it('originateForUser throws if user has no yeastarExtension', async () => {
    (mockPrisma.user.findFirst as jest.Mock).mockResolvedValue({ yeastarExtension: null });
    await expect(service.originateForUser('user-1', 'cust-1')).rejects.toThrow(
      /Extension Yeastar/,
    );
  });
});
