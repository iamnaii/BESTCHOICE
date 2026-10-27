import { Logger } from '@nestjs/common';
import { redactShareToken, scrubShareTokensDeep } from '../../utils/redact-share-token.util';
import { SentryExceptionFilter } from '../../filters/sentry-exception.filter';
import type { ArgumentsHost } from '@nestjs/common';
jest.mock('@sentry/nestjs', () => ({
  captureException: jest.fn(),
  init: jest.fn(),
  nativeNodeFetchIntegration: jest.fn(),
}));
const secret = 'd'.repeat(64);
const urls = [`/api/customer-access/${secret}`, `/api/contracts/id/verify?hash=${secret}`];
it.each(urls)('redacts actual delegated URL plus encoded error/APM fields: %s', (url) => {
  const event = {
    request: { url },
    exception: {
      values: [
        {
          value: `failed ${secret}`,
          stacktrace: { frames: [{ filename: encodeURIComponent(url) }] },
        },
      ],
    },
    transaction: encodeURIComponent(encodeURIComponent(url)),
    breadcrumbs: [{ data: { url } }],
  };
  expect(JSON.stringify(scrubShareTokensDeep(event))).not.toContain(secret);
  expect(redactShareToken(url)).toContain('[redacted]');
  expect(redactShareToken(encodeURIComponent(url))).not.toContain(secret);
});
it('scrubs actual exception logger stack and URL while keeping public error generic', () => {
  const logger = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
  const response = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  const host = {
    switchToHttp: () => ({
      getRequest: () => ({ url: urls[0], method: 'GET' }),
      getResponse: () => response,
    }),
  } as unknown as ArgumentsHost;
  const old = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    new SentryExceptionFilter().catch(new Error(`failure ${secret}`), host);
    expect(JSON.stringify(logger.mock.calls)).not.toContain(secret);
    expect(JSON.stringify(response.json.mock.calls)).not.toContain(secret);
  } finally {
    logger.mockRestore();
    process.env.NODE_ENV = old;
  }
});
it('preserves existing GFIN scrub and catches arbitrary multibyte QR query hashes', () => {
  expect(redactShareToken('/api/g/' + 'A'.repeat(43))).toBe('/api/g/[redacted]');
  expect(redactShareToken('/api/contracts/id/verify?hash=กกก')).toBe(
    '/api/contracts/id/verify?hash=[redacted]',
  );
});
