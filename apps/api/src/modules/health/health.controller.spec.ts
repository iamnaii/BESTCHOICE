import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { HttpException, HttpStatus } from '@nestjs/common';
import { HealthController } from './health.controller';
import { PrismaService } from '../../prisma/prisma.service';

jest.mock('@sentry/nestjs', () => ({
  captureException: jest.fn(),
  captureMessage: jest.fn(),
}));

describe('HealthController', () => {
  let controller: HealthController;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let configGet: jest.Mock<any, any>;

  beforeEach(async () => {
    configGet = jest.fn((key: string) => {
      // Simulate storage misconfiguration: all S3_* env vars missing
      const missing = ['S3_ENDPOINT', 'S3_ACCESS_KEY', 'S3_SECRET_KEY', 'S3_BUCKET'];
      if (missing.includes(key)) return undefined;
      return 'configured';
    });

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        {
          provide: PrismaService,
          useValue: {
            // Simulate DB unreachable so that `checkDatabase` also exercises
            // the error branch — both checks should emit generic messages.
            $queryRaw: jest.fn().mockRejectedValue(
              new Error('password authentication failed for user "postgres"'),
            ),
          },
        },
        {
          provide: ConfigService,
          useValue: { get: configGet },
        },
      ],
    }).compile();

    controller = module.get<HealthController>(HealthController);
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
});
