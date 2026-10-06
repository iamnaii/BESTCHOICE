import { capabilityFromEvidence } from './facebook-comment-capability';
import { FacebookCommentClient, FacebookCommentTransport } from './facebook-comment-client';
import { IntegrationConfigService } from '../integrations/integration-config.service';
describe('Facebook comment capability and acknowledgement contract', () => {
  const config = {
    getConfig: jest
      .fn()
      .mockResolvedValue({ pageId: 'page-a', pageAccessToken: 'synthetic-not-a-token' }),
  } as unknown as IntegrationConfigService;
  const input = { pageId: 'page-a', commentId: 'comment-a', text: 'ข้อมูลสาธารณะ' };
  const transport = (): FacebookCommentTransport => ({
    evidence: async () => ({
      graphVersion: 'test',
      verified: true,
      receive: true,
      publicReply: true,
    }),
    replyPublic: jest.fn().mockResolvedValue({ externalId: 'ack-123' }),
    readComment: jest.fn().mockResolvedValue(null),
  });
  it('overrides all capabilities when evidence is unverified', () => {
    expect(
      capabilityFromEvidence({
        graphVersion: 'test',
        verified: false,
        receive: true,
        publicReply: true,
        privateReply: true,
      }),
    ).toEqual({
      graphVersion: 'test',
      receive: false,
      publicReply: false,
      privateReply: false,
      reason: 'ยังไม่ยืนยันสิทธิ์การเชื่อมต่อ',
    });
  });
  it('production without a verified transport cannot receive or send', async () => {
    const client = new FacebookCommentClient(config);
    expect(await client.getCapabilities('page-a')).toMatchObject({
      receive: false,
      publicReply: false,
      privateReply: false,
      graphVersion: 'v25.0',
    });
    expect(await client.replyPublic(input)).toEqual({
      status: 'FAILED',
      errorCode: 'CAPABILITY_UNVERIFIED',
    });
  });
  it('cannot send using a token configured for another page', async () => {
    const port = transport();
    const client = new FacebookCommentClient(config, port);
    expect(await client.replyPublic({ ...input, pageId: 'page-b' })).toMatchObject({
      status: 'FAILED',
    });
    expect(port.replyPublic).not.toHaveBeenCalled();
  });
  it('only confirms a nonempty provider acknowledgement', async () => {
    const port = transport();
    const client = new FacebookCommentClient(config, port);
    expect(await client.replyPublic(input)).toEqual({ status: 'CONFIRMED', externalId: 'ack-123' });
    (port.replyPublic as jest.Mock).mockResolvedValue({ externalId: '' });
    expect(await client.replyPublic(input)).toEqual({
      status: 'UNKNOWN',
      errorCode: 'MISSING_ACK',
    });
  });
  it.each(['TOKEN_EXPIRED', 'RATE_LIMIT', 'PERMISSION_DENIED'])(
    'preserves definitely-not-sent %s without pretending success',
    async (code) => {
      const port = transport();
      (port.replyPublic as jest.Mock).mockResolvedValue({
        definitelyNotSent: true,
        errorCode: code,
      });
      expect(await new FacebookCommentClient(config, port).replyPublic(input)).toEqual({
        status: 'FAILED',
        errorCode: code,
      });
    },
  );
  it('treats timeout after dispatch as unknown and never retries internally', async () => {
    const port = transport();
    (port.replyPublic as jest.Mock).mockRejectedValue(
      new Error('timeout; secret must not be returned'),
    );
    expect(await new FacebookCommentClient(config, port).replyPublic(input)).toEqual({
      status: 'UNKNOWN',
      errorCode: 'TRANSPORT_UNCERTAIN',
    });
    expect(port.replyPublic).toHaveBeenCalledTimes(1);
  });
  it('fails closed when capability evidence cannot be refreshed', async () => {
    const port = transport();
    port.evidence = async () => {
      throw new Error('unavailable');
    };
    expect(await new FacebookCommentClient(config, port).getCapabilities('page-a')).toMatchObject({
      receive: false,
      publicReply: false,
      privateReply: false,
    });
    expect(port.replyPublic).not.toHaveBeenCalled();
  });
});
