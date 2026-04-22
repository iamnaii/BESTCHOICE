import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { FacebookExtractorSource } from './facebook-extractor.source';

describe('FacebookExtractorSource', () => {
  let source: FacebookExtractorSource;
  let fetchMock: jest.SpyInstance;

  beforeEach(async () => {
    const mod = await Test.createTestingModule({
      providers: [
        FacebookExtractorSource,
        {
          provide: ConfigService,
          useValue: {
            get: (k: string) =>
              ({ FACEBOOK_PAGE_ACCESS_TOKEN: 'tok', FACEBOOK_PAGE_ID: 'page123' }[k]),
          },
        },
      ],
    }).compile();
    source = mod.get(FacebookExtractorSource);
    fetchMock = jest.spyOn(global, 'fetch');
  });

  afterEach(() => fetchMock.mockRestore());

  it('extracts messages from paginated conversations', async () => {
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
    expect(result).toHaveLength(2);
    expect(result[0].role).toBe('CUSTOMER');
    expect(result[1].role).toBe('STAFF');
    expect(result[0].roomId).toBe('fb:conv1');
  });
});
