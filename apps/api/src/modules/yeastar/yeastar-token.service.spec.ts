import { YeastarTokenService } from './yeastar-token.service';
import { IntegrationConfigService } from '../integrations/integration-config.service';

const mockConfig = jest.fn();
const mockConfigService = {
  getConfig: mockConfig,
} as unknown as IntegrationConfigService;

describe('YeastarTokenService', () => {
  let service: YeastarTokenService;

  beforeEach(() => {
    service = new YeastarTokenService(mockConfigService);
    jest.clearAllMocks();
  });

  afterEach(() => {
    service.onModuleDestroy();
  });

  it('fetches token when cache is empty', async () => {
    mockConfig.mockResolvedValue({
      pbxUrl: 'https://pbx.example.com',
      clientId: 'test-id',
      clientSecret: 'test-secret',
    });

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: 'tok-123',
        refresh_token: 'ref-456',
        expires_in: 1800,
      }),
    }) as jest.Mock;

    const token = await service.getToken();
    expect(token).toBe('tok-123');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('returns cached token on second call', async () => {
    mockConfig.mockResolvedValue({
      pbxUrl: 'https://pbx.example.com',
      clientId: 'test-id',
      clientSecret: 'test-secret',
    });

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: 'tok-123',
        refresh_token: 'ref-456',
        expires_in: 1800,
      }),
    }) as jest.Mock;

    await service.getToken();
    await service.getToken();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('throws if Yeastar not configured', async () => {
    mockConfig.mockResolvedValue({ pbxUrl: '', clientId: '', clientSecret: '' });
    await expect(service.getToken()).rejects.toThrow('Yeastar ยังไม่ได้ตั้งค่า');
  });
});
