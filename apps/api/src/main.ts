// Set timezone to Asia/Bangkok (UTC+7) for all Date operations
process.env.TZ = 'Asia/Bangkok';

// Sentry: only import if DSN is configured (avoids startup overhead without DSN)
// eslint-disable-next-line @typescript-eslint/no-require-imports
if (process.env.SENTRY_DSN) require('./sentry');

import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger, VersioningType } from '@nestjs/common';
import { json, urlencoded } from 'express';
import { IncomingMessage } from 'http';
import { RawBodyRequest } from './common/types/raw-body-request';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { HttpAdapterHost } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { SentryExceptionFilter } from './filters/sentry-exception.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { validateEnv } from './utils/env-validation';
import { AdminPrefixMiddleware } from './common/middleware/admin-prefix.middleware';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  // Validate required environment variables before starting
  validateEnv();

  const app = await NestFactory.create(AppModule);

  // AdminPrefixMiddleware MUST run at Express level (not via MiddlewareConsumer)
  // so it executes before NestJS routing layer. Rewrites /api/admin/* → /api/*
  // so existing controllers (mounted at /api/X via setGlobalPrefix) handle the
  // request transparently. NestJS module-level middleware via forRoutes('*')
  // is unreliable here because path-to-regexp matching can interact poorly
  // with the global prefix; raw app.use() guarantees execution on every request.
  const adminPrefix = new AdminPrefixMiddleware();
  app.use((req, res, next) => adminPrefix.use(req, res, next));

  // Increase body size limit for base64 image uploads
  // `verify` callback captures raw body bytes for LINE webhook HMAC verification
  app.use(
    json({
      limit: '20mb',
      verify: (req: IncomingMessage, _res, buf) => {
        if (buf?.length) {
          (req as RawBodyRequest).rawBody = buf;
        }
      },
    }),
  );
  app.use(urlencoded({ extended: true, limit: '20mb' }));
  app.use(cookieParser());

  // (Audit finding P1) Add Helmet to set sane security headers:
  //   X-Content-Type-Options: nosniff
  //   X-Frame-Options: SAMEORIGIN
  //   Strict-Transport-Security
  //   Referrer-Policy: no-referrer
  //
  // Disabled options:
  // - contentSecurityPolicy: API serves no HTML; default CSP would only
  //   break Swagger's inline CSS in dev.
  // - crossOriginEmbedderPolicy: not needed for a JSON API.
  // - crossOriginResourcePolicy: must be 'cross-origin' (not the default
  //   'same-origin') because the web app and the API are on different
  //   origins (admin.bestchoicephone.app ↔ api.bestchoicephone.app, plus
  //   localhost:5173 ↔ localhost:3000 in dev/E2E). NestJS CORS already
  //   handles the credentialed origin allow-list below.
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  // CORS configuration
  const allowedOrigins = (process.env.FRONTEND_URL || 'http://localhost:5173')
    .split(',')
    .map((o) => o.trim());
  // LIFF pages may be served from custom domain (bestchoicephone.app) or Firebase Hosting
  if (!allowedOrigins.includes('https://bestchoicephone.app')) {
    allowedOrigins.push('https://bestchoicephone.app');
  }
  // Online Shop subdomain
  if (!allowedOrigins.includes('https://shop.bestchoicephone.app')) {
    allowedOrigins.push('https://shop.bestchoicephone.app');
  }
  // Online Shop local dev (port 5174) — DEV ONLY.
  // (Audit finding P0-#8) Without this guard, any page served from
  // localhost:5174 in prod can make credentialed cross-origin requests
  // and receive the httpOnly refresh-token cookie.
  if (process.env.NODE_ENV !== 'production') {
    if (!allowedOrigins.includes('http://localhost:5174')) {
      allowedOrigins.push('http://localhost:5174');
    }
  }

  app.enableCors({
    origin: (origin, callback) => {
      // Allow requests with no origin (server-to-server, curl, etc.)
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, origin);
      callback(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-CSRF-Token', 'X-Liff-Id-Token'],
    maxAge: 86400,
  });

  // Global validation pipe with security options
  // NOTE: `forbidNonWhitelisted` is intentionally OFF.
  // เปิดแล้วจะพังกับ controllers ที่ใช้ `@Query() dto: PaginationDto` ร่วมกับ
  // `@Query('search') search?: string` — Nest จะ validate query object ทั้งก้อน
  // กับ PaginationDto แล้ว reject ทุก param ที่ไม่ใช่ page/limit
  // (e.g. /customers?search=... → 400 "property search should not exist")
  // `whitelist: true` ยังเอาฟิลด์ส่วนเกินออกจาก DTO อยู่แล้ว — ปลอดภัยเพียงพอ
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  app.setGlobalPrefix('api');

  // API versioning: enable URI-based versioning (e.g., /api/v1/...)
  // Default version is empty (no /v1/ prefix) for backward compatibility.
  // New endpoints can use @Version('1') to opt into versioning.
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '',
  });

  // Global exception filter: reports 5xx to Sentry, consistent error responses
  const { httpAdapter } = app.get(HttpAdapterHost);
  app.useGlobalFilters(new SentryExceptionFilter(httpAdapter));

  // Global response envelope: wraps all successful responses in { success, data, timestamp }
  app.useGlobalInterceptors(new ResponseInterceptor());

  // Swagger API Documentation (disabled in production for security)
  if (process.env.NODE_ENV !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('BESTCHOICE API')
      .setDescription('ระบบผ่อนชำระ BESTCHOICE — API Documentation')
      .setVersion('1.0')
      .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'JWT')
      .addTag('Auth', 'Authentication & 2FA')
      .addTag('Users', 'จัดการผู้ใช้')
      .addTag('Branches', 'จัดการสาขา')
      .addTag('Customers', 'จัดการลูกค้า')
      .addTag('Contracts', 'สัญญาผ่อนชำระ')
      .addTag('Payments', 'การชำระเงิน')
      .addTag('Receipts', 'ใบเสร็จรับเงิน')
      .addTag('Products', 'คลังสินค้า & สต็อก')
      .addTag('Purchase Orders', 'ใบสั่งซื้อ')
      .addTag('Suppliers', 'จัดการผู้ขาย')
      .addTag('Inspections', 'ตรวจสอบสินค้า')
      .addTag('Sales', 'POS ขายสินค้า')
      .addTag('Dashboard', 'ภาพรวมธุรกิจ')
      .addTag('Reports', 'รายงาน')
      .addTag('Overdue', 'ติดตามหนี้')
      .addTag('Exchange', 'เปลี่ยนเครื่อง')
      .addTag('Repossessions', 'ยึดคืน & ขายต่อ')
      .addTag('Expenses', 'บันทึกรายจ่าย')
      .addTag('Finance', 'เงินรับจากไฟแนนซ์')
      .addTag('Documents', 'เอกสารสัญญา')
      .addTag('Notifications', 'แจ้งเตือน')
      .addTag('Settings', 'ตั้งค่าระบบ')
      .addTag('Audit', 'Audit Logs')
      .addTag('PDPA', 'คุ้มครองข้อมูลส่วนบุคคล')
      .addTag('LINE OA', 'LINE Integration')
      .addTag('OCR', 'AI OCR')
      .addTag('Credit Check', 'ตรวจเครดิต')
      .addTag('Storage', 'File Storage')
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document, {
      customSiteTitle: 'BESTCHOICE API Docs',
    });
    logger.log('Swagger docs available at /api/docs');
  }

  // Graceful shutdown
  app.enableShutdownHooks();

  const port = process.env.PORT || 3000;
  await app.listen(port);
  logger.log(`API server running on http://localhost:${port}`);
}
bootstrap();
