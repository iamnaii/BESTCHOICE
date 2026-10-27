import { Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import * as Sentry from '@sentry/nestjs';
import { inspect } from 'node:util';
import { VisionService } from './vision.service';
import { IntegrationConfigService } from '../../integrations/integration-config.service';
import { AiUsageService } from '../../ai-usage/ai-usage.service';

jest.mock('@anthropic-ai/sdk', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn(), captureMessage: jest.fn() }));

describe('VisionService private slip diagnostics with controlled SDK', () => {
  const create = jest.fn();
  const record = jest.fn().mockResolvedValue(undefined);
  const getValue = jest.fn();
  let service: VisionService;
  let log: jest.SpyInstance, warn: jest.SpyInstance, error: jest.SpyInstance;
  const extraction = {
    isSlip: true,
    amount: 918273.46,
    confidence: 0.87654321,
    refNo: 'PRIVATE-SUCCESS-REF',
    toAccount: 'PRIVATE-ACCOUNT',
  };
  const response = (text?: string) => ({
    content: text === undefined ? [] : [{ type: 'text', text }],
    usage: { input_tokens: 17, output_tokens: 23 },
  });
  const diagnostics = () =>
    inspect(
      [
        log.mock.calls,
        warn.mock.calls,
        error.mock.calls,
        jest.mocked(Sentry.captureException).mock.calls,
        jest.mocked(Sentry.captureMessage).mock.calls,
      ],
      { depth: 10 },
    );

  beforeEach(() => {
    jest.clearAllMocks();
    create.mockReset();
    getValue.mockResolvedValue('synthetic-controlled-sdk-only');
    jest
      .mocked(Anthropic)
      .mockImplementation(() => ({ messages: { create } }) as unknown as Anthropic);
    log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    service = new VisionService(
      { getValue } as unknown as IntegrationConfigService,
      { record } as unknown as AiUsageService,
    );
  });
  afterEach(() => jest.restoreAllMocks());

  it('preserves extracted values, SDK image/model and usage without logging amount or confidence', async () => {
    create.mockResolvedValue(response('```json\n' + JSON.stringify(extraction) + '\n```'));
    const bytes = Buffer.from('synthetic-private-image');
    await expect(service.extractSlip(bytes, 'IMAGE/PNG')).resolves.toEqual(extraction);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 500,
        messages: [
          expect.objectContaining({
            content: [
              {
                type: 'image',
                source: { type: 'base64', media_type: 'image/png', data: bytes.toString('base64') },
              },
              { type: 'text', text: expect.any(String) },
            ],
          }),
        ],
      }),
    );
    expect(record).toHaveBeenCalledWith({
      service: 'vision',
      method: 'extractSlip',
      model: 'claude-haiku-4-5-20251001',
      inputTokens: 17,
      outputTokens: 23,
      status: 'success',
    });
    for (const value of ['918273.46', '0.87654321', 'PRIVATE-SUCCESS-REF', 'PRIVATE-ACCOUNT'])
      expect(diagnostics()).not.toContain(value);
  });

  it('malformed OCR returns null without raw response or parser-error canaries in diagnostics', async () => {
    create.mockResolvedValue(response('PRIVATE-MALFORMED-OCR-CANARY { invalid'));
    await expect(service.extractSlip(Buffer.from('image'))).resolves.toBeNull();
    expect(record).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledTimes(1);
    expect(diagnostics()).not.toContain('PRIVATE-MALFORMED-OCR-CANARY');
  });

  it('provider failure returns null without forwarding original private exception to Logger or Sentry', async () => {
    const failure = Object.assign(new Error('PRIVATE-PROVIDER-MESSAGE-CANARY'), {
      response: { body: 'PRIVATE-PROVIDER-BODY-CANARY' },
    });
    create.mockRejectedValue(failure);
    await expect(service.extractSlip(Buffer.from('image'))).resolves.toBeNull();
    expect(record).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledTimes(1);
    expect(diagnostics()).not.toContain('PRIVATE-PROVIDER-');
    expect(Sentry.captureException).not.toHaveBeenCalled();
    expect(Sentry.captureMessage).toHaveBeenCalledWith('VISION_EXTRACT_UNAVAILABLE', {
      level: 'error',
      tags: { module: 'chatbot-finance', action: 'vision_extract' },
    });
  });

  it('empty text keeps the null outcome and zero-token usage defaults', async () => {
    create.mockResolvedValue({ content: [] });
    await expect(service.extractSlip(Buffer.from('image'))).resolves.toBeNull();
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ inputTokens: 0, outputTokens: 0 }),
    );
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it('missing configured key remains disabled without constructing or calling SDK', async () => {
    getValue.mockResolvedValue(' ');
    await expect(service.extractSlip(Buffer.from('image'))).resolves.toBeNull();
    expect(Anthropic).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
    expect(service.isEnabled).toBe(false);
  });
});
