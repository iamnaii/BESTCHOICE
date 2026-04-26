import { YeastarService } from './yeastar.service';
import { YeastarTokenService } from './yeastar-token.service';
import { IntegrationConfigService } from '../integrations/integration-config.service';

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

describe('YeastarService', () => {
  let service: YeastarService;

  beforeEach(() => {
    service = new YeastarService(mockTokenService, mockConfigService);
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
});
