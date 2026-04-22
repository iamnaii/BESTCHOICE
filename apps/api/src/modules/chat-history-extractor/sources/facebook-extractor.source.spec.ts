import { Test } from '@nestjs/testing';
import { FacebookExtractorSource } from './facebook-extractor.source';
import { IntegrationConfigService } from '../../integrations/integration-config.service';

describe('FacebookExtractorSource', () => {
  let source: FacebookExtractorSource;
  let fetchMock: jest.SpyInstance;
  let integrationConfig: { getConfig: jest.Mock };

  beforeEach(async () => {
    integrationConfig = {
      getConfig: jest.fn().mockResolvedValue({ pageAccessToken: 'tok', pageId: 'page123' }),
    };
    const mod = await Test.createTestingModule({
      providers: [
        FacebookExtractorSource,
        { provide: IntegrationConfigService, useValue: integrationConfig },
      ],
    }).compile();
    source = mod.get(FacebookExtractorSource);
    fetchMock = jest.spyOn(global, 'fetch');
  });

  afterEach(() => fetchMock.mockRestore());

  it('extracts messages from paginated conversations using Integration Hub credentials', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [
          {
            id: 'conv1',
            participants: { data: [{ id: 'user1', name: 'A' }, { id: 'page123', name: 'Page' }] },
            messages: {
              data: [
                { id: 'm1', message: 'Hi', from: { id: 'user1' }, created_time: '2026-02-01T00:00:00+0000' },
                { id: 'm2', message: 'Hello!', from: { id: 'page123' }, created_time: '2026-02-01T00:01:00+0000' },
              ],
            },
          },
        ],
        paging: {},
      }),
    } as any);
    const result = await source.extract({ since: new Date('2025-04-22') });
    expect(integrationConfig.getConfig).toHaveBeenCalledWith('facebook');
    expect(result).toHaveLength(2);
    expect(result[0].role).toBe('CUSTOMER');
    expect(result[1].role).toBe('STAFF');
    expect(result[0].roomId).toBe('fb:conv1');
  });

  it('skips gracefully when credentials are missing in Integration Hub', async () => {
    integrationConfig.getConfig.mockResolvedValue({});
    const result = await source.extract({ since: new Date('2025-04-22') });
    expect(result).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
