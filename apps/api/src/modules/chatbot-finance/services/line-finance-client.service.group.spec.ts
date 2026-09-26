// apps/api/src/modules/chatbot-finance/services/line-finance-client.service.group.spec.ts
import { LineFinanceClientService, LineFinanceNotConfiguredError } from './line-finance-client.service';

const jsonRes = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  ({ ok: status >= 200 && status < 300, status, headers: { get: (k: string) => headers[k.toLowerCase()] ?? null }, json: async () => body, text: async () => JSON.stringify(body) }) as unknown as Response;

describe('LineFinanceClientService — group + strict push (GFIN PR 2)', () => {
  const fetchMock = jest.fn<Promise<Response>, [string, RequestInit?]>();
  let token: string | undefined = 'tok-1';
  const service = new LineFinanceClientService({ getValue: jest.fn(async () => token) } as never);
  beforeEach(() => { fetchMock.mockReset(); token = 'tok-1'; global.fetch = fetchMock as unknown as typeof fetch; });

  it('pushMessageStrict posts to /message/push with the finance token and returns x-line-request-id', async () => {
    fetchMock.mockResolvedValue(jsonRes(200, {}, { 'x-line-request-id': 'req-9' }));
    const r = await service.pushMessageStrict('Cgroup1', [{ type: 'text', text: 'hi' }]);
    expect(r).toEqual({ requestId: 'req-9' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.line.me/v2/bot/message/push');
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer tok-1');
    expect(JSON.parse(init?.body as string)).toEqual({ to: 'Cgroup1', messages: [{ type: 'text', text: 'hi' }] });
  });
  it('pushMessageStrict throws LineFinanceNotConfiguredError (never silently skips) when the token is missing', async () => {
    token = '';
    await expect(service.pushMessageStrict('C1', [{ type: 'text', text: 'x' }])).rejects.toBeInstanceOf(LineFinanceNotConfiguredError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('pushMessageStrict rethrows LINE API errors with the status (caller maps to 502)', async () => {
    fetchMock.mockResolvedValue(jsonRes(429, { message: 'rate' }));
    await expect(service.pushMessageStrict('C1', [{ type: 'text', text: 'x' }])).rejects.toThrow(/LINE API 429/);
  });
  it('pushMessage (legacy, lenient) still skips silently without a token — existing callers unchanged', async () => {
    token = '';
    await expect(service.pushMessage('U1', [{ type: 'text', text: 'x' }])).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('getGroupSummary GETs /group/{id}/summary and returns the body; null on non-2xx or missing token', async () => {
    fetchMock.mockResolvedValue(jsonRes(200, { groupId: 'C1', groupName: 'GFIN : BESTCHOICE', pictureUrl: 'https://p' }));
    await expect(service.getGroupSummary('C1')).resolves.toEqual({ groupId: 'C1', groupName: 'GFIN : BESTCHOICE', pictureUrl: 'https://p' });
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.line.me/v2/bot/group/C1/summary');
    fetchMock.mockResolvedValue(jsonRes(404, {}));
    await expect(service.getGroupSummary('C1')).resolves.toBeNull();
    token = '';
    await expect(service.getGroupSummary('C1')).resolves.toBeNull();
  });
  it('getGroupMemberCount returns count, null on failure', async () => {
    fetchMock.mockResolvedValue(jsonRes(200, { count: 7 }));
    await expect(service.getGroupMemberCount('C1')).resolves.toBe(7);
    fetchMock.mockRejectedValue(new Error('net'));
    await expect(service.getGroupMemberCount('C1')).resolves.toBeNull();
  });
});
