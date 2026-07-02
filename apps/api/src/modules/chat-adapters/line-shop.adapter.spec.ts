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
