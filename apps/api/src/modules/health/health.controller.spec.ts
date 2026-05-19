import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { HttpException, HttpStatus } from '@nestjs/common';
import { HealthController } from './health.controller';
import { PrismaService } from '../../prisma/prisma.service';
import { PrismaFinanceService } from '../../prisma/prisma-finance.service';

jest.mock('@sentry/nestjs', () => ({
  captureException: jest.fn(),
  captureMessage: jest.fn(),
}));

describe('HealthController', () => {
  let controller: HealthController;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let configGet: jest.Mock<any, any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prismaShop: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prismaFin: any;

  beforeEach(async () => {
    configGet = jest.fn((key: string) => {
      // Simulate storage misconfiguration: all S3_* env vars missing
      const missing = ['S3_ENDPOINT', 'S3_ACCESS_KEY', 'S3_SECRET_KEY', 'S3_BUCKET'];
      if (missing.includes(key)) return undefined;
      return 'configured';
    });

    // Simulate both DBs unreachable so that both DB checks exercise the error branch.
    const dbError = new Error('password authentication failed for user "postgres"');
    prismaShop = { $queryRaw: jest.fn().mockRejectedValue(dbError) };
    prismaFin = { $queryRaw: jest.fn().mockRejectedValue(dbError) };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: PrismaService, useValue: prismaShop },
        { provide: PrismaFinanceService, useValue: prismaFin },
        { provide: ConfigService, useValue: { get: configGet } },
      ],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  describe('GET /health (public liveness probe)', () => {
    it('returns ok without hitting any dependency', () => {
      const result = controller.check();
      expect(result.status).toBe('ok');
      expect(typeof result.timestamp).toBe('string');
    });
  });

  describe('GET /health/detailed (T7-C3: no env var leak)', () => {
    // Regex of env-var prefixes commonly used across integrations. If any
    // appears in the 503 body we have leaked integration topology.
    const ENV_VAR_LEAK_REGEX = /\b(S3_|DB_|REDIS_|AI_|SMS_|LINE_|PAY_|SENTRY_|JWT_)/;

    it('returns 503 with generic messages — no env var names in body', async () => {
      let caught: HttpException | null = null;
      try {
        await controller.checkDetailed();
      } catch (err) {
        caught = err as HttpException;
      }

      expect(caught).toBeInstanceOf(HttpException);
      expect(caught!.getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);

      const body = caught!.getResponse();
      const serialized = JSON.stringify(body);

      // Must NOT contain any env var names — `S3_ACCESS_KEY`, `DB_HOST`, etc.
      expect(serialized).not.toMatch(ENV_VAR_LEAK_REGEX);

      // Must also not surface the raw DB driver error ("password authentication…")
      expect(serialized).not.toMatch(/password authentication failed/i);
      expect(serialized).not.toMatch(/postgres/i);

      // Sanity: generic messages still present for ops to recognize the failure
      expect(serialized.toLowerCase()).toContain('storage misconfigured');
      expect(serialized.toLowerCase()).toContain('database unavailable');
    });
  });

  // ─── SP7.8 — Dual-DB probe tests ─────────────────────────────────────────

  describe('SP7.8 — dual-DB health probes', () => {
    it('returns ok with latency_ms for both DBs when both respond', async () => {
      prismaShop.$queryRaw.mockResolvedValueOnce([{ '?column?': 1 }]);
      prismaFin.$queryRaw.mockResolvedValueOnce([{ '?column?': 1 }]);
      // All S3 vars must be present so storage check also passes
      configGet.mockImplementation(() => 'configured');

      const result = await controller.checkDetailed();
      expect(result.status).toBe('ok');
      expect(result.checks.databases).toHaveLength(2);

      const shop = result.checks.databases.find((d) => d.db === 'shop');
      const fin = result.checks.databases.find((d) => d.db === 'finance');
      expect(shop?.status).toBe('ok');
      expect(fin?.status).toBe('ok');
      expect(typeof shop?.latency_ms).toBe('number');
      expect(typeof fin?.latency_ms).toBe('number');
    });

    it('returns degraded (503) when only finance DB errors', async () => {
      // shop OK, storage OK, finance ERROR
      prismaShop.$queryRaw.mockResolvedValueOnce([{ '?column?': 1 }]);
      prismaFin.$queryRaw.mockRejectedValueOnce(new Error('connection refused'));
      configGet.mockImplementation(() => 'configured'); // all S3 vars present

      let caught: HttpException | null = null;
      try {
        await controller.checkDetailed();
      } catch (err) {
        caught = err as HttpException;
      }

      expect(caught).toBeInstanceOf(HttpException);
      expect(caught!.getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);

      const body = caught!.getResponse() as {
        status: string;
        checks: { databases: Array<{ db: string; status: string }> };
      };
      expect(body.status).toBe('error');
      const fin = body.checks.databases.find((d) => d.db === 'finance');
      expect(fin?.status).toBe('error');
      // Raw error message must not surface
      const serialized = JSON.stringify(body);
      expect(serialized).not.toMatch(/connection refused/i);
    });

    it('returns degraded (503) when only shop DB errors', async () => {
      prismaShop.$queryRaw.mockRejectedValueOnce(new Error('timeout'));
      prismaFin.$queryRaw.mockResolvedValueOnce([{ '?column?': 1 }]);
      configGet.mockImplementation(() => 'configured');

      let caught: HttpException | null = null;
      try {
        await controller.checkDetailed();
      } catch (err) {
        caught = err as HttpException;
      }

      expect(caught).toBeInstanceOf(HttpException);
      const body = caught!.getResponse() as {
        checks: { databases: Array<{ db: string; status: string }> };
      };
      const shop = body.checks.databases.find((d) => d.db === 'shop');
      const fin = body.checks.databases.find((d) => d.db === 'finance');
      expect(shop?.status).toBe('error');
      expect(fin?.status).toBe('ok');
    });
  });
});
