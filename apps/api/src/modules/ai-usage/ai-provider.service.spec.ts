import Anthropic, { APIConnectionTimeoutError } from '@anthropic-ai/sdk';
import { Logger } from '@nestjs/common';
import { AiProviderService } from './ai-provider.service';

jest.mock('@anthropic-ai/sdk', () => ({
  ...jest.requireActual('@anthropic-ai/sdk'),
  __esModule: true,
  default: jest.fn(),
}));

describe('AiProviderService', () => {
  const request: Anthropic.MessageCreateParamsNonStreaming = {
    model: 'domain-model',
    max_tokens: 2048,
    temperature: 0,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: 'PDF_PRIVATE' },
          },
          {
            type: 'image',
            source: { type: 'base64', media_type: 'image/png', data: 'IMAGE_PRIVATE' },
          },
          { type: 'text', text: 'domain prompt' },
        ],
      },
    ],
  };
  const context = { service: 'ocr', method: 'analyzeBankStatement', userId: 'server-actor' };
  const record = jest.fn();
  const create = jest.fn();
  const countTokens = jest.fn();
  let service: AiProviderService;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    record.mockResolvedValue(undefined);
    create.mockResolvedValue({
      content: [{ type: 'text', text: 'result' }],
      usage: { input_tokens: 123, output_tokens: 45 },
    });
    countTokens.mockResolvedValue({ input_tokens: 1 });
    (Anthropic as unknown as jest.Mock).mockImplementation(() => ({
      messages: { create, countTokens },
    }));
    service = new AiProviderService({ record } as any);
  });
  afterEach(() => jest.restoreAllMocks());

  it('keeps document, credit and interactive policies independent and rotates changed credentials', () => {
    expect(service.clientFor('', 'document')).toBeNull();
    const doc = service.clientFor('document-key', 'document');
    expect(service.clientFor('document-key', 'document')).toBe(doc);
    service.clientFor('text-key', 'interactive');
    service.clientFor('credit-key', 'credit');
    expect(Anthropic).toHaveBeenNthCalledWith(1, { apiKey: 'document-key', timeout: 120_000 });
    expect(Anthropic).toHaveBeenNthCalledWith(2, {
      apiKey: 'text-key',
      timeout: 30_000,
      maxRetries: 0,
    });
    expect(Anthropic).toHaveBeenNthCalledWith(3, { apiKey: 'credit-key' });
    service.clientFor('rotated-document-key', 'document');
    expect(Anthropic).toHaveBeenCalledTimes(4);
  });

  it('forwards PDF/image blocks unchanged and records one sanitized usage event with the server actor', async () => {
    const client = service.clientFor('key', 'document')!;
    const response = await service.complete(client, request, context);
    expect(create).toHaveBeenCalledWith(request);
    expect(response.content[0]).toEqual({ type: 'text', text: 'result' });
    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith({
      ...context,
      model: 'domain-model',
      inputTokens: 123,
      outputTokens: 45,
      status: 'success',
    });
    expect(JSON.stringify(record.mock.calls)).not.toMatch(
      /PDF_PRIVATE|IMAGE_PRIVATE|domain prompt/,
    );
  });

  it('does not create a billable usage row for count-tokens readiness checks', async () => {
    await service.countTokens(service.clientFor('key', 'document')!, {
      model: 'domain-model',
      messages: [{ role: 'user', content: 'ping' }],
    });
    expect(countTokens).toHaveBeenCalledTimes(1);
    expect(create).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });

  it.each([
    [new Error('PRIVATE provider error'), 'provider_error'],
    [new APIConnectionTimeoutError(), 'timeout'],
  ])('records failures without request/error payloads', async (error, kind) => {
    create.mockRejectedValue(error);
    await expect(
      service.complete(service.clientFor('key', 'document')!, request, context),
    ).rejects.toBe(error);
    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith({
      ...context,
      model: 'domain-model',
      inputTokens: 0,
      outputTokens: 0,
      status: 'error',
      errorKind: kind,
    });
  });

  it('awaits telemetry without replacing successful output or provider errors when persistence rejects', async () => {
    const client = service.clientFor('key', 'document')!;
    let finish!: () => void;
    record.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    let done = false;
    const pending = service.complete(client, request, context).then((result) => {
      done = true;
      return result;
    });
    await Promise.resolve();
    expect(done).toBe(false);
    finish();
    await pending;
    record.mockRejectedValue(new Error('DB down'));
    await expect(service.complete(client, request, context)).resolves.toBeDefined();
    const original = new Error('provider down');
    create.mockRejectedValue(original);
    await expect(service.complete(client, request, context)).rejects.toBe(original);
  });
});
