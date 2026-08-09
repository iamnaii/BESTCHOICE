import { Test, TestingModule } from '@nestjs/testing';
import { FacebookPersistentMenuService } from './facebook-persistent-menu.service';
import { IntegrationConfigService } from '../integrations/integration-config.service';

/**
 * Regression coverage for Task 9 (Fix round 1):
 *
 * Task 9 rewrote this service to read Facebook creds from
 * `IntegrationConfigService.getConfig('facebook')` FRESH on every call
 * (DB → env fallback), replacing the old constructor-cached `ConfigService`
 * read. That exact stale-creds bug — a page configured via Settings-only
 * getting "Facebook not configured" forever because creds were read once at
 * boot — had ZERO test coverage before this file, so a mutation that
 * reintroduced instance-level caching survived the full jest run untouched.
 * These specs exist specifically to kill that mutation class.
 */
describe('FacebookPersistentMenuService', () => {
  let service: FacebookPersistentMenuService;
  let integrationConfig: { getConfig: jest.Mock };
  const originalFetch = global.fetch;

  beforeEach(async () => {
    integrationConfig = { getConfig: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FacebookPersistentMenuService,
        { provide: IntegrationConfigService, useValue: integrationConfig },
      ],
    }).compile();

    service = module.get(FacebookPersistentMenuService);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  describe('guard — Facebook not configured', () => {
    it.each(['setupMenu', 'removeMenu', 'setupGetStarted'] as const)(
      '%s() returns { success:false, error:"Facebook not configured" } and never calls fetch when creds are empty',
      async (methodName) => {
        integrationConfig.getConfig.mockResolvedValue({});
        const fetchMock = jest.fn();
        global.fetch = fetchMock as unknown as typeof fetch;

        const result = await service[methodName]();

        expect(result).toEqual({ success: false, error: 'Facebook not configured' });
        expect(fetchMock).not.toHaveBeenCalled();
      },
    );

    it.each(['setupMenu', 'removeMenu', 'setupGetStarted'] as const)(
      '%s() fails closed when only pageId is present (pageAccessToken missing)',
      async (methodName) => {
        integrationConfig.getConfig.mockResolvedValue({ pageId: 'pid-only' });
        const fetchMock = jest.fn();
        global.fetch = fetchMock as unknown as typeof fetch;

        const result = await service[methodName]();

        expect(result).toEqual({ success: false, error: 'Facebook not configured' });
        expect(fetchMock).not.toHaveBeenCalled();
      },
    );
  });

  describe('creds are re-read per call (regression guard — must fail if creds get cached)', () => {
    it('1st call fails with empty creds, 2nd call succeeds with fresh creds from a NEW getConfig() resolution', async () => {
      integrationConfig.getConfig
        .mockResolvedValueOnce({}) // 1st call: nothing configured yet
        .mockResolvedValueOnce({ pageAccessToken: 'tok2', pageId: 'pid2' }); // 2nd call: now configured

      const fetchMock = jest.fn().mockResolvedValue({ ok: true });
      global.fetch = fetchMock as unknown as typeof fetch;

      const first = await service.setupGetStarted();
      expect(first).toEqual({ success: false, error: 'Facebook not configured' });
      expect(fetchMock).not.toHaveBeenCalled();

      const second = await service.setupGetStarted();
      expect(second).toEqual({ success: true });

      // If creds were cached on the instance after the first (empty) call,
      // getConfig would only ever be called once, and the second call would
      // still return "Facebook not configured" instead of hitting fetch.
      expect(integrationConfig.getConfig).toHaveBeenCalledTimes(2);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith(
        'https://graph.facebook.com/v25.0/pid2/messenger_profile',
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer tok2' }),
        }),
      );
    });

    it('setupMenu() and removeMenu() also re-resolve creds independently per call', async () => {
      integrationConfig.getConfig
        .mockResolvedValueOnce({ pageAccessToken: 'tokA', pageId: 'pidA' })
        .mockResolvedValueOnce({ pageAccessToken: 'tokB', pageId: 'pidB' });

      const fetchMock = jest.fn().mockResolvedValue({ ok: true });
      global.fetch = fetchMock as unknown as typeof fetch;

      await service.setupMenu();
      await service.removeMenu();

      expect(integrationConfig.getConfig).toHaveBeenCalledTimes(2);
      expect(fetchMock).toHaveBeenNthCalledWith(
        1,
        'https://graph.facebook.com/v25.0/pidA/messenger_profile',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ Authorization: 'Bearer tokA' }),
        }),
      );
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        'https://graph.facebook.com/v25.0/pidB/messenger_profile',
        expect.objectContaining({
          method: 'DELETE',
          headers: expect.objectContaining({ Authorization: 'Bearer tokB' }),
        }),
      );
    });
  });

  describe('fetch failure handling — never throws out of the service', () => {
    beforeEach(() => {
      integrationConfig.getConfig.mockResolvedValue({
        pageAccessToken: 'tok',
        pageId: 'pid',
      });
    });

    it.each(['setupMenu', 'removeMenu', 'setupGetStarted'] as const)(
      '%s() returns { success:false, error:<body text> } when fetch resolves ok:false',
      async (methodName) => {
        const fetchMock = jest.fn().mockResolvedValue({
          ok: false,
          status: 400,
          text: () => Promise.resolve('bad request from graph api'),
        });
        global.fetch = fetchMock as unknown as typeof fetch;

        const result = await service[methodName]();

        expect(result).toEqual({ success: false, error: 'bad request from graph api' });
      },
    );

    it.each(['setupMenu', 'removeMenu', 'setupGetStarted'] as const)(
      '%s() returns { success:false, error:<message> } instead of throwing when fetch rejects',
      async (methodName) => {
        const fetchMock = jest.fn().mockRejectedValue(new Error('network down'));
        global.fetch = fetchMock as unknown as typeof fetch;

        await expect(service[methodName]()).resolves.toEqual({
          success: false,
          error: 'network down',
        });
      },
    );
  });

  describe('setupGetStarted() success payload', () => {
    it('POSTs the get_started payload + Thai greeting and returns { success: true }', async () => {
      integrationConfig.getConfig.mockResolvedValue({
        pageAccessToken: 'tok',
        pageId: 'pid',
      });
      const fetchMock = jest.fn().mockResolvedValue({ ok: true });
      global.fetch = fetchMock as unknown as typeof fetch;

      const result = await service.setupGetStarted();

      expect(result).toEqual({ success: true });
      expect(fetchMock).toHaveBeenCalledWith(
        'https://graph.facebook.com/v25.0/pid/messenger_profile',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            Authorization: 'Bearer tok',
          }),
        }),
      );
      const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
      expect(body.get_started).toEqual({ payload: 'GET_STARTED' });
      expect(body.greeting).toEqual([expect.objectContaining({ locale: 'default' })]);
    });
  });
});
