import { FACEBOOK_PAGE_SUBSCRIBED_FIELDS_CSV } from '@installment/shared';
import { IntegrationConfigService } from '../integrations/integration-config.service';
import { FacebookCommentGraphTransport } from './facebook-comment-graph.transport';
import { FacebookCommentClient } from './facebook-comment-client';

describe('Live Graph comment adapter (mock HTTP; no Meta calls)', () => {
  const credentials = {
    pageId: '123',
    appId: '456',
    pageAccessToken: 'synthetic-page-token',
    appSecret: 'synthetic-secret',
    verifyToken: 'synthetic-verify',
  };
  const config = { getConfig: jest.fn() };
  let transport: FacebookCommentGraphTransport;
  let fetchMock: jest.SpyInstance;
  let token: Record<string, unknown>;
  let apps: unknown[];
  let postAuthor: string;
  let comment: Record<string, unknown>;
  let sendStatus: number;
  let sendBody: unknown;
  let sendThrows: boolean;
  let pages: number;
  // Task 35: a GET answered with this instead of the fixture (status+JSON / socket error / HTML 5xx).
  let graphFail: Record<string, { status: number; body: unknown } | 'network' | 'html'>;
  const reply = { pageId: '123', commentId: '123_789', text: 'คำตอบสาธารณะ' };
  beforeEach(() => {
    config.getConfig.mockResolvedValue({ ...credentials });
    token = {
      is_valid: true,
      app_id: '456',
      type: 'PAGE',
      profile_id: '123',
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      data_access_expires_at: 0,
      scopes: [
        'pages_read_engagement',
        'pages_read_user_content',
        'pages_manage_engagement',
        'pages_manage_metadata',
      ],
    };
    apps = [{ id: '456', subscribed_fields: ['feed', 'messages', 'leadgen'] }];
    comment = {
      id: '123_789',
      object: { id: '123_900' },
      message: 'คำถาม',
      from: { id: '789' },
      parent: { id: '123_100' },
      created_time: '2026-10-06T01:00:00+0000',
      can_comment: true,
    };
    postAuthor = '123';
    sendStatus = 200;
    sendBody = { id: '123_888' };
    sendThrows = false;
    pages = 0;
    graphFail = {};
    fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = new URL(String(input));
      expect(url.origin).toBe('https://graph.facebook.com');
      expect(init?.redirect).toBe('error');
      expect(init?.signal).toBeDefined();
      const fail = init?.method === 'POST' ? undefined : graphFail[url.pathname];
      if (fail === 'network') throw new Error('socket hang up');
      if (fail === 'html') return new Response('<html>502 Bad Gateway</html>', { status: 502 });
      if (fail) return new Response(JSON.stringify(fail.body), { status: fail.status });
      let data: unknown;
      let status = 200;
      if (url.pathname === '/v25.0/debug_token') data = { data: token };
      else if (url.pathname === '/v25.0/me') data = { id: '123' };
      else if (url.pathname === '/v25.0/123/subscribed_apps') {
        pages++;
        data = init?.method === 'POST' ? { success: true } : { data: apps };
      } else if (url.pathname === '/v25.0/123_900')
        data = { id: '123_900', from: { id: postAuthor } };
      else if (url.pathname.endsWith('/comments')) {
        if (sendThrows) throw new Error('timeout contains synthetic-secret');
        status = sendStatus;
        data = sendBody;
      } else data = comment;
      return new Response(JSON.stringify(data), { status });
    });
    transport = new FacebookCommentGraphTransport(config as unknown as IntegrationConfigService);
  });
  afterEach(() => jest.restoreAllMocks());
  const posts = () => fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST');
  const client = () =>
    new FacebookCommentClient(config as unknown as IntegrationConfigService, transport);

  it('requires Page identity, current app subscription and each permission; private replies remain off', async () => {
    expect(await transport.evidence('123')).toMatchObject({
      verified: true,
      receive: true,
      publicReply: true,
      privateReply: false,
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await transport.evidence('123');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await transport.evidence('123', true);
    expect(fetchMock).toHaveBeenCalledTimes(6);
    const [url, options] = fetchMock.mock.calls.find(([input]) => String(input).includes('/me?'))!;
    expect(String(url)).not.toContain(credentials.pageAccessToken);
    expect(String(url)).toContain('appsecret_proof=');
    expect(options?.headers).toMatchObject({
      Authorization: `Bearer ${credentials.pageAccessToken}`,
    });
    expect(posts()).toHaveLength(0);
  });
  it.each([
    ['is_valid', false],
    ['app_id', '999'],
    ['type', 'USER'],
    ['profile_id', '999'],
    ['expires_at', 1],
    ['data_access_expires_at', 1],
    ['expires_at', undefined],
  ])('fails closed on invalid token field %s', async (key, value) => {
    token[key as string] = value;
    expect(await transport.evidence('123')).toMatchObject({ receive: false, publicReply: false });
  });
  it('cannot borrow a permission scoped to another Page', async () => {
    token.granular_scopes = [{ scope: 'pages_manage_engagement', target_ids: ['999'] }];
    expect(await transport.evidence('123')).toMatchObject({ receive: true, publicReply: false });
  });
  it('requires customer-content read permission independently from reply permission', async () => {
    token.scopes = ['pages_read_engagement', 'pages_manage_engagement', 'pages_manage_metadata'];
    expect(await transport.evidence('123')).toMatchObject({ receive: false, publicReply: false });
  });
  it('does not count another app subscribed to feed as this app', async () => {
    apps = [{ id: '999', subscribed_fields: ['feed'] }];
    expect(await transport.evidence('123')).toMatchObject({
      verified: true,
      receive: false,
      publicReply: false,
    });
  });
  it('does not make HTTP requests for wrong Page or incomplete configuration', async () => {
    expect(await transport.evidence('999')).toMatchObject({ verified: false });
    config.getConfig.mockResolvedValue({ ...credentials, appId: '' });
    expect(await transport.evidence('123')).toMatchObject({ verified: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  // Task 35 (owner 2026-10-31): the Verify Token only answers Meta's GET handshake
  // (FacebookWebhookController.verifyWebhook). No Graph request reads it, so clearing it in the
  // Integration Hub must not switch off comment receive / reply / feed subscription.
  it.each([
    ['cleared', { verifyToken: undefined }],
    ['empty', { verifyToken: '' }],
  ])('comment features do not need the webhook Verify Token (%s)', async (_label, override) => {
    config.getConfig.mockResolvedValue({ ...credentials, ...override });
    expect(await transport.evidence('123')).toMatchObject({
      verified: true,
      receive: true,
      publicReply: true,
    });
    expect(await client().getCapabilities('123')).toMatchObject({
      receive: true,
      publicReply: true,
    });
    expect(await transport.readComment('123', '123_789')).toMatchObject({
      commentId: '123_789',
      exists: true,
    });
    expect(await client().replyPublic(reply)).toEqual({
      status: 'CONFIRMED',
      externalId: '123_888',
    });
    await transport.subscribeFeed('123');
    expect(posts()).toHaveLength(2);
  });
  it('names only the fields the comment transport reads when configuration is incomplete', async () => {
    config.getConfig.mockResolvedValue({ ...credentials, appSecret: '' });
    const { reason } = await transport.evidence('123');
    expect(reason).toBe('ตั้งค่า Page ID, App ID, Page Access Token และ App Secret ให้ครบ');
    expect(reason).not.toContain('Verify Token');
  });
  // Task 35 (option 4): `notReady` = proof that receiving cannot work until someone changes the
  // configuration or Meta permissions. Without proof (outage, rate limit, unknown) it stays absent
  // so the webhook keeps Meta's redelivery.
  describe('notReady — proof that receiving is impossible', () => {
    const evidence = () => transport.evidence('123', true);
    it('ready Page carries no notReady', async () => {
      expect(await evidence()).toMatchObject({ receive: true });
      expect((await evidence()).notReady).toBeUndefined();
    });
    it.each([
      ['App Secret cleared', { appSecret: '' }],
      ['Page Access Token cleared', { pageAccessToken: '' }],
      ['App ID missing', { appId: '' }],
      ['configured for another Page', { pageId: '999' }],
    ])('configuration (%s) → CONFIG without any Graph request', async (_l, patch) => {
      config.getConfig.mockResolvedValue({ ...credentials, ...patch });
      expect(await evidence()).toMatchObject({ verified: false, notReady: 'CONFIG' });
      expect(fetchMock).not.toHaveBeenCalled();
    });
    it.each([
      ['token reported invalid', () => (token.is_valid = false)],
      ['token expired', () => (token.expires_at = 1)],
      ['customer-content permission missing', () => (token.scopes = ['pages_read_engagement'])],
      [
        'app not subscribed to feed',
        () => (apps = [{ id: '456', subscribed_fields: ['messages'] }]),
      ],
      [
        'Page token rejected (OAuth 190)',
        () => (graphFail['/v25.0/me'] = { status: 400, body: { error: { code: 190 } } }),
      ],
      [
        'subscriptions refused (permission 200)',
        () =>
          (graphFail['/v25.0/123/subscribed_apps'] = {
            status: 403,
            body: { error: { code: 200 } },
          }),
      ],
      [
        'app token rejected on debug_token (OAuth 190)',
        () => (graphFail['/v25.0/debug_token'] = { status: 400, body: { error: { code: 190 } } }),
      ],
    ])('Meta answered every request: %s → META_PERMISSION', async (_l, arrange) => {
      arrange();
      expect(await evidence()).toMatchObject({ receive: false, notReady: 'META_PERMISSION' });
    });
    it.each([
      [
        'Graph 500 on me',
        () => (graphFail['/v25.0/me'] = { status: 500, body: { error: { code: 2 } } }),
      ],
      [
        'OAuth error flagged transient',
        () =>
          (graphFail['/v25.0/me'] = {
            status: 400,
            body: { error: { code: 190, is_transient: true } },
          }),
      ],
      [
        'rate limited (code 4)',
        () => (graphFail['/v25.0/debug_token'] = { status: 400, body: { error: { code: 4 } } }),
      ],
      [
        'unknown 4xx code (100)',
        () => (graphFail['/v25.0/me'] = { status: 400, body: { error: { code: 100 } } }),
      ],
      [
        'subscriptions 503',
        () => (graphFail['/v25.0/123/subscribed_apps'] = { status: 503, body: {} }),
      ],
      ['subscriptions HTML 502', () => (graphFail['/v25.0/123/subscribed_apps'] = 'html')],
      ['network failure on me', () => (graphFail['/v25.0/me'] = 'network')],
      ['HTML 502 on debug_token', () => (graphFail['/v25.0/debug_token'] = 'html')],
    ])('no proof: %s → receive false, notReady absent (retryable)', async (_l, arrange) => {
      arrange();
      const result = await evidence();
      expect(result.receive).not.toBe(true);
      expect(result.notReady).toBeUndefined();
    });
    it('client passes the proof through and adds CONFIG for its own configuration gates', async () => {
      token.scopes = ['pages_read_engagement'];
      expect(await client().getCapabilities('123', true)).toMatchObject({
        receive: false,
        notReady: 'META_PERMISSION',
      });
      config.getConfig.mockResolvedValue({ ...credentials, pageAccessToken: '' });
      expect(await client().getCapabilities('123')).toMatchObject({
        receive: false,
        notReady: 'CONFIG',
      });
      expect(
        await new FacebookCommentClient(
          config as unknown as IntegrationConfigService,
        ).getCapabilities('123'),
      ).toMatchObject({ receive: false, notReady: 'CONFIG' });
    });
    it('client: configuration read failure is not proof (retryable)', async () => {
      config.getConfig.mockRejectedValue(new Error('database unavailable'));
      const capabilities = await client().getCapabilities('123');
      expect(capabilities.receive).toBe(false);
      expect(capabilities).not.toHaveProperty('notReady');
    });
  });
  it('invalidates cached evidence when credentials change', async () => {
    await transport.evidence('123');
    config.getConfig.mockResolvedValue({
      ...credentials,
      pageAccessToken: 'changed-synthetic-token',
    });
    token.is_valid = false;
    expect(await transport.evidence('123')).toMatchObject({ receive: false });
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });
  it('returns an authoritative snapshot without treating created_time as a revision', async () => {
    expect(await transport.readComment('123', '123_789')).toMatchObject({
      commentId: '123_789',
      exists: true,
      text: 'คำถาม',
      revision: null,
    });
  });
  it('refuses foreign Page posts even if the token can read them', async () => {
    postAuthor = '999';
    expect(await transport.readComment('123', '123_789')).toBeNull();
    expect(await transport.replyPublic(reply)).toMatchObject({ definitelyNotSent: true });
    expect(posts()).toHaveLength(0);
  });
  it('never converts missing/permission errors into a deletion', async () => {
    comment = { error: { code: 100, message: 'inaccessible' } };
    expect(await transport.readComment('123', '123_789')).toBeNull();
  });
  it('rejects path injection and disabled comment replies before dispatch', async () => {
    expect(await transport.replyPublic({ ...reply, commentId: '../123/messages' })).toMatchObject({
      definitelyNotSent: true,
    });
    comment.can_comment = false;
    expect(await transport.replyPublic(reply)).toMatchObject({ definitelyNotSent: true });
    expect(posts()).toHaveLength(0);
  });
  it('posts one public reply and confirms only its acknowledged ID', async () => {
    expect(await client().replyPublic(reply)).toEqual({
      status: 'CONFIRMED',
      externalId: '123_888',
    });
    expect(posts()).toHaveLength(1);
    expect(String(posts()[0][0])).toContain('/v25.0/123_789/comments?');
    expect(new URLSearchParams(String(posts()[0][1]?.body)).get('message')).toBe(reply.text);
  });
  it.each([190, 10, 200, 4, 613])(
    'recognizes explicit rejection %s without retry',
    async (code) => {
      sendStatus = 400;
      sendBody = { error: { code } };
      expect(await client().replyPublic(reply)).toMatchObject({ status: 'FAILED' });
      expect(posts()).toHaveLength(1);
    },
  );
  it.each([
    [500, { error: { code: 190 } }],
    [400, { error: { code: 190, is_transient: true } }],
    [400, { error: { code: 100 } }],
    [200, {}],
    [200, { id: '' }],
  ])('keeps ambiguous response %s UNKNOWN without retry', async (status, body) => {
    sendStatus = status as number;
    sendBody = body;
    expect(await client().replyPublic(reply)).toMatchObject({ status: 'UNKNOWN' });
    expect(posts()).toHaveLength(1);
  });
  it('keeps timeout after POST UNKNOWN and does not expose provider errors', async () => {
    sendThrows = true;
    expect(await client().replyPublic(reply)).toEqual({
      status: 'UNKNOWN',
      errorCode: 'TRANSPORT_UNCERTAIN',
    });
    expect(posts()).toHaveLength(1);
  });
  it('reconciliation requires the reply author, parent, date and Page post', async () => {
    comment.from = { id: '123' };
    comment.message = reply.text;
    expect(await transport.readReply('123', '123_789')).toMatchObject({
      parentCommentId: '123_100',
      authorId: '123',
      text: reply.text,
    });
    comment.from = { id: '999' };
    expect(await transport.readReply('123', '123_789')).toBeNull();
    comment.from = { id: '123' };
    comment.created_time = 'bad-date';
    expect(await transport.readReply('123', '123_789')).toBeNull();
  });
  it('subscribes only explicitly and preserves existing plus mandatory Messenger fields', async () => {
    apps = [{ id: '456', subscribed_fields: ['leadgen', 'ratings'] }];
    await transport.evidence('123');
    expect(posts()).toHaveLength(0);
    await transport.subscribeFeed('123');
    expect(posts()).toHaveLength(1);
    const fields = new URLSearchParams(String(posts()[0][1]?.body))
      .get('subscribed_fields')!
      .split(',');
    expect(fields).toEqual(
      expect.arrayContaining([
        'feed',
        'leadgen',
        'ratings',
        ...FACEBOOK_PAGE_SUBSCRIBED_FIELDS_CSV.split(','),
      ]),
    );
  });
  it('refuses subscription writes with incomplete fields or missing metadata permission', async () => {
    apps = [{ id: '456' }];
    await expect(transport.subscribeFeed('123')).rejects.toThrow('ยังยืนยันการสมัคร');
    token.scopes = ['pages_read_engagement'];
    await expect(transport.subscribeFeed('123')).rejects.toThrow('ยังยืนยันการสมัคร');
    expect(posts()).toHaveLength(0);
  });
  it('follows opaque cursors on the fixed origin, never provider next URLs', async () => {
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/subscribed_apps') && !url.searchParams.has('after'))
        return Response.json({
          data: [{ id: '999', subscribed_fields: ['feed'] }],
          paging: { next: 'https://evil.invalid/steal', cursors: { after: 'safe-cursor' } },
        });
      return original(input, init);
    });
    expect(await transport.evidence('123')).toMatchObject({ receive: true });
    expect(pages).toBe(1);
    expect(fetchMock.mock.calls.some(([url]) => String(url).startsWith('https://evil'))).toBe(
      false,
    );
  });
});
