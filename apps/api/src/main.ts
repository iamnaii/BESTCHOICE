import { installRuntimeGlobals } from './app.setup';

// Timezone + BigInt serialization must be in place before any module loads Prisma.
installRuntimeGlobals();

// Sentry: only import if DSN is configured (avoids startup overhead without DSN)
// eslint-disable-next-line @typescript-eslint/no-require-imports
if (process.env.SENTRY_DSN) require('./sentry');

import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { validateEnv } from './utils/env-validation';
import { GcpJsonLogger } from './common/logger/gcp-json.logger';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  // Validate required environment variables before starting
  validateEnv();

  // LOG_FORMAT=json (Cloud Run) → JSON + severity ให้ Cloud Logging จัดระดับได้จริง
  const app = await NestFactory.create(
    AppModule,
    GcpJsonLogger.enabled() ? { logger: new GcpJsonLogger() } : {},
  );

  // Middleware, CORS, validation, prefix, filters, interceptors, Swagger — shared
  // with the documents integration harness so both run the identical pipeline.
  configureApp(app, { logger });

  const port = process.env.PORT || 3000;
  await app.listen(port);
  logger.log(`API server running on http://localhost:${port}`);
}
bootstrap().catch((err) => {
  // A failed bootstrap must crash loudly with a non-zero exit so the
  // orchestrator (Cloud Run) restarts the instance instead of leaving a
  // half-initialised process running. (Was a floating promise — the new
  // no-floating-promises guardrail flags it.)
  console.error('Fatal: API bootstrap failed', err);
  process.exit(1);
});
