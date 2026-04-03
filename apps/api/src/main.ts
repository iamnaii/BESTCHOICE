// Sentry must be imported before everything else
import './sentry';

import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { json, urlencoded } from 'express';
import cookieParser from 'cookie-parser';
import { HttpAdapterHost } from '@nestjs/core';
import { AppModule } from './app.module';
import { SentryExceptionFilter } from './filters/sentry-exception.filter';
import { validateEnv } from './utils/env-validation';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  // Validate required environment variables before starting
  validateEnv();

  const app = await NestFactory.create(AppModule);

  // Increase body size limit for base64 image uploads
  app.use(json({ limit: '20mb' }));
  app.use(urlencoded({ extended: true, limit: '20mb' }));
  app.use(cookieParser());

  // CORS configuration
  const allowedOrigins = (process.env.FRONTEND_URL || 'http://localhost:5173')
    .split(',')
    .map((o) => o.trim());

  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-CSRF-Token'],
    maxAge: 86400,
  });

  // Global validation pipe with security options
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  app.setGlobalPrefix('api');

  // Global exception filter: reports 5xx to Sentry, consistent error responses
  const { httpAdapter } = app.get(HttpAdapterHost);
  app.useGlobalFilters(new SentryExceptionFilter(httpAdapter));

  // Graceful shutdown
  app.enableShutdownHooks();

  const port = process.env.PORT || 3000;
  await app.listen(port);
  logger.log(`API server running on http://localhost:${port}`);
}
bootstrap();
