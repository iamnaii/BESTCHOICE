import { LineShopAdapter } from './line-shop.adapter';

describe('LineShopAdapter.sendMessage', () => {
  const make = () => {
    const lineOa = {
      replyMessage: jest.fn().mockResolvedValue(undefined),
      pushMessage: jest.fn().mockResolvedValue(undefined),
    };
    return { adapter: new LineShopAdapter(lineOa as any), lineOa };
  };
  const base = {
    externalUserId: 'U1',
    channel: 'LINE_SHOP' as any,
    type: 'TEXT' as any,
    text: 'สวัสดีค่ะ',
  };

  it('uses the reply API when replyToken is present', async () => {
    const { adapter, lineOa } = make();
    const res = await adapter.sendMessage({ ...base, replyToken: 'rt-1' });
    expect(lineOa.replyMessage).toHaveBeenCalledWith('rt-1', expect.any(Array), 'line-shop');
    expect(lineOa.pushMessage).not.toHaveBeenCalled();
    expect(res.success).toBe(true);
  });

  it('falls back to push when the reply call fails (token used/expired)', async () => {
    const { adapter, lineOa } = make();
    lineOa.replyMessage.mockRejectedValue(new Error('Invalid reply token'));
    const res = await adapter.sendMessage({ ...base, replyToken: 'rt-expired' });
    expect(lineOa.pushMessage).toHaveBeenCalledWith('U1', expect.any(Array), 'line-shop');
    expect(res.success).toBe(true);
  });

  it('pushes directly when no replyToken', async () => {
    const { adapter, lineOa } = make();
    await adapter.sendMessage(base);
    expect(lineOa.replyMessage).not.toHaveBeenCalled();
    expect(lineOa.pushMessage).toHaveBeenCalled();
  });
});

describe('LineShopAdapter delivery certainty through the actual API client', () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; });
  async function setup(token = 'test-only') {
    const { LineApiClientService } = await import('../line-oa/services/line-api-client.service');
    const client = new LineApiClientService({} as any, { getValue: jest.fn().mockResolvedValue(token) } as any);
    return new LineShopAdapter({ pushMessage: client.pushMessage.bind(client) } as any);
  }
  const message = { externalUserId: 'synthetic', channel: 'LINE_SHOP' as any, type: 'TEXT' as any, text: 'test', automated: true };
  it('classifies missing credentials before network access as safely retryable', async () => {
    global.fetch = jest.fn();
    expect((await (await setup('')).sendMessage(message)).definitelyNotSent).toBe(true);
    expect(global.fetch).not.toHaveBeenCalled();
  });
  it.each([400, 401, 429])('classifies explicit HTTP %s rejection as safely retryable', async (status) => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status, headers: { get: () => null }, text: async () => 'rejected' });
    expect((await (await setup()).sendMessage(message)).definitelyNotSent).toBe(true);
  });
  it('preserves uncertainty on network failure and HTTP 5xx', async () => {
    global.fetch = jest.fn().mockRejectedValueOnce(new Error('connection lost')).mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'error' });
    const adapter = await setup();
    expect((await adapter.sendMessage(message)).definitelyNotSent).toBe(false);
    expect((await adapter.sendMessage(message)).definitelyNotSent).toBe(false);
  });
});
