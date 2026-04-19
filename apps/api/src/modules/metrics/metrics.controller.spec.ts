import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { HttpException, HttpStatus, Logger } from '@nestjs/common';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';

/**
 * T7-C9: Metrics endpoint supports dual tokens for zero-downtime rotation.
 *   - Accepts METRICS_SCRAPE_TOKEN (current) and METRICS_SCRAPE_TOKEN_PREVIOUS (last rotated-out).
 *   - Comparison is timing-safe.
 *   - Matching PREVIOUS emits a Logger.warn so ops can see the old caller.
 */
describe('MetricsController (T7-C9 token rotation)', () => {
  let controller: MetricsController;
  let metrics: { collect: jest.Mock };
  let config: { get: jest.Mock };

  beforeEach(async () => {
    metrics = { collect: jest.fn().mockResolvedValue('# HELP fake_metric\nfake_metric 1\n') };
    config = { get: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [MetricsController],
      providers: [
        { provide: MetricsService, useValue: metrics },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();

    controller = module.get(MetricsController);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function configure(current?: string, previous?: string) {
    config.get.mockImplementation((key: string) => {
      if (key === 'METRICS_SCRAPE_TOKEN') return current;
      if (key === 'METRICS_SCRAPE_TOKEN_PREVIOUS') return previous;
      return undefined;
    });
  }

  it('accepts the current token (no warning)', async () => {
    configure('new-token-abc', 'old-token-xyz');
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    const out = await controller.scrape('new-token-abc');

    expect(out).toContain('fake_metric');
    expect(metrics.collect).toHaveBeenCalledTimes(1);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('accepts the previous token and emits a rotation warning', async () => {
    configure('new-token-abc', 'old-token-xyz');
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    const out = await controller.scrape('old-token-xyz');

    expect(out).toContain('fake_metric');
    expect(metrics.collect).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const msg = warnSpy.mock.calls[0][0] as string;
    expect(msg).toMatch(/METRICS_SCRAPE_TOKEN_PREVIOUS/);
    expect(msg).toMatch(/rotate/i);
  });

  it('rejects 403 when token matches neither current nor previous', async () => {
    configure('new-token-abc', 'old-token-xyz');

    await expect(controller.scrape('attacker-token')).rejects.toMatchObject({
      status: HttpStatus.FORBIDDEN,
    });
    expect(metrics.collect).not.toHaveBeenCalled();
  });

  it('rejects 403 when no token is sent', async () => {
    configure('new-token-abc');
    await expect(controller.scrape(undefined)).rejects.toMatchObject({
      status: HttpStatus.FORBIDDEN,
    });
  });

  it('rejects 503 when METRICS_SCRAPE_TOKEN is not configured', async () => {
    configure(undefined, 'old-token-xyz');
    await expect(controller.scrape('any-token')).rejects.toBeInstanceOf(HttpException);
    await expect(controller.scrape('any-token')).rejects.toMatchObject({
      status: HttpStatus.SERVICE_UNAVAILABLE,
    });
  });

  it('does not leak comparison timing on mismatched lengths (smoke)', async () => {
    configure('length-32-aaaaaaaaaaaaaaaaaaaaaaa', 'length-16-bbbbbbb');
    // Short token: mismatched length against both — should cleanly 403.
    await expect(controller.scrape('x')).rejects.toMatchObject({
      status: HttpStatus.FORBIDDEN,
    });
    // Exact length as current but wrong content — timingSafeEqual path, still 403.
    await expect(controller.scrape('length-32-bbbbbbbbbbbbbbbbbbbbbbb')).rejects.toMatchObject({
      status: HttpStatus.FORBIDDEN,
    });
  });
});
