import Anthropic, { APIConnectionTimeoutError } from '@anthropic-ai/sdk';
import { Logger } from '@nestjs/common';
import { AiTextService } from './ai-text.service';

jest.mock('@anthropic-ai/sdk', () => ({
  ...jest.requireActual('@anthropic-ai/sdk'),
  __esModule: true,
  default: jest.fn(),
}));

const request = {
  model: 'claude-haiku-4-5-20251001',
  max_tokens: 300,
  messages: [{ role: 'user' as const, content: 'สรุปบทสนทนา' }],
};
const context = { service: 'ai-assistant', method: 'summarizeConversation', userId: 'staff-1' };

function makeService(apiKey: string | undefined = 'test-key') {
  const create = jest.fn().mockResolvedValue({
    content: [{ type: 'text', text: 'ข้อความสรุป' }],
    usage: { input_tokens: 40, output_tokens: 12 },
  });
  (Anthropic as unknown as jest.Mock).mockImplementation(() => ({ messages: { create } }));
  const record = jest.fn().mockResolvedValue(undefined);
  const service = new AiTextService(
    { get: jest.fn().mockReturnValue(apiKey) } as any,
    { record } as any,
  );
  return { service, create, record };
}

describe('AiTextService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => jest.restoreAllMocks());

  it('shares a configured client with a 30-second timeout and no hidden retries', async () => {
    const { service, create, record } = makeService();
    expect(service.isAvailable).toBe(true);
    expect(Anthropic).toHaveBeenCalledWith({ apiKey: 'test-key', timeout: 30_000, maxRetries: 0 });
    await expect(service.generate(request, context)).resolves.toBe('ข้อความสรุป');
    expect(create).toHaveBeenCalledWith(request);
    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith({
      ...context,
      model: request.model,
      inputTokens: 40,
      outputTokens: 12,
      status: 'success',
    });
    await service.generate(request, context);
    expect(Anthropic).toHaveBeenCalledTimes(1);
  });

  it('waits for the usage record before returning the result', async () => {
    const { service, record } = makeService();
    let finishRecord!: () => void;
    record.mockReturnValue(
      new Promise<void>((resolve) => {
        finishRecord = resolve;
      }),
    );
    let finished = false;
    const pending = service.generate(request, context).then((text) => {
      finished = true;
      return text;
    });
    await Promise.resolve();
    expect(record).toHaveBeenCalledTimes(1);
    expect(finished).toBe(false);
    finishRecord();
    await expect(pending).resolves.toBe('ข้อความสรุป');
  });

  it('returns unavailable without calling or billing when the key is absent', async () => {
    const { service, create, record } = makeService('');
    expect(service.isAvailable).toBe(false);
    await expect(service.generate(request, context)).resolves.toBeNull();
    expect(Anthropic).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });

  it.each([
    [new Error('sensitive provider details'), 'provider_error'],
    [new APIConnectionTimeoutError(), 'timeout'],
  ])(
    'records one sanitized error and propagates the original failure',
    async (error, errorKind) => {
      const { service, create, record } = makeService();
      create.mockRejectedValue(error);
      await expect(service.generate(request, context)).rejects.toBe(error);
      expect(record).toHaveBeenCalledTimes(1);
      expect(record).toHaveBeenCalledWith({
        ...context,
        model: request.model,
        inputTokens: 0,
        outputTokens: 0,
        status: 'error',
        errorKind,
      });
    },
  );

  it('preserves successful text when telemetry persistence unexpectedly rejects', async () => {
    const { service, record } = makeService();
    record.mockRejectedValue(new Error('database unavailable'));
    await expect(service.generate(request, context)).resolves.toBe('ข้อความสรุป');
    expect(record).toHaveBeenCalledTimes(1);
    expect(record.mock.calls[0][0].status).toBe('success');
  });

  it('preserves the original provider failure when telemetry also rejects', async () => {
    const { service, create, record } = makeService();
    const providerError = new Error('provider unavailable');
    create.mockRejectedValue(providerError);
    record.mockRejectedValue(new Error('database unavailable'));
    await expect(service.generate(request, context)).rejects.toBe(providerError);
    expect(record).toHaveBeenCalledTimes(1);
  });

  it.each([
    { content: [] },
    {
      content: [
        { type: 'thinking', thinking: 'hidden' },
        { type: 'text', text: 'later' },
      ],
    },
  ])('leaves empty/non-text first responses to the caller fallback', async ({ content }) => {
    const { service, create, record } = makeService();
    create.mockResolvedValue({ content });
    await expect(service.generate(request, context)).resolves.toBeNull();
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'success',
        inputTokens: 0,
        outputTokens: 0,
      }),
    );
  });
});
