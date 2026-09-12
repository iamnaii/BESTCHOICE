import { INestApplication, Logger, ValidationPipe, VersioningType } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { json, urlencoded } from 'express';
import { IncomingMessage } from 'http';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { RawBodyRequest } from './common/types/raw-body-request';
import { SentryExceptionFilter } from './filters/sentry-exception.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { AdminPrefixMiddleware } from './common/middleware/admin-prefix.middleware';
import { trustedProxyHops } from './utils/client-ip.util';

/**
 * Process-wide runtime settings that every entry point (HTTP server, CLI,
 * integration harness) must share before the first Prisma or Date call.
 */
export function installRuntimeGlobals(): void {
  // Set timezone to Asia/Bangkok (UTC+7) for all Date operations
  process.env.TZ = 'Asia/Bangkok';

  // Serialize BigInt as a JSON string everywhere. Prisma maps Postgres `bigint`
  // columns (e.g. AuditLog.sequenceNumber — the Merkle-chain sequence) to JS BigInt,
  // which JSON.stringify cannot serialize → "Do not know how to serialize a BigInt"
  // → 500 on any endpoint returning such a row (e.g. GET /audit/logs, /audit/stats).
  (BigInt.prototype as unknown as { toJSON(): string }).toJSON = function () {
    return this.toString();
  };
}

export interface ConfigureAppOptions {
  /** Build the Swagger document (non-production only). The harness skips it. */
  swagger?: boolean;
  logger?: Logger;
}

/**
 * Everything main.ts does between NestFactory.create() and app.listen().
 *
 * The documents integration harness (apps/api/e2e/documents) boots AppModule and
 * calls this same function, so middleware order, CORS, validation, the global
 * prefix, exception filter and response envelope are identical to production —
 * a second copy of this list would silently drift.
 */
export function configureApp(app: INestApplication, options: ConfigureAppOptions = {}): void {
  const logger = options.logger ?? new Logger('Bootstrap');

  // trust proxy — ตั้งเฉพาะเมื่อรู้จำนวน hop จริงเท่านั้น
  //
  // ไม่ตั้งค่า = Express คืน socket peer ซึ่งบน Cloud Run คือ proxy ของ Google
  // (วัดจริง 2026-08-30: request ผ่าน Firebase rewrite เห็น remoteIp = 66.249.x)
  // การเปิด trust proxy แบบ `true` ลอย ๆ จะเชื่อ X-Forwarded-For ทั้งสายซึ่ง client
  // ปลอมได้ฟรี — แย่กว่าเดิม จึงเปิดต่อเมื่อ TRUSTED_PROXY_HOPS ถูกตั้งไว้แล้ว
  // (Express นับ socket peer เป็น hop ที่ 1 จึงเป็น hops + 1) ดู utils/client-ip.util.ts
  const proxyHops = trustedProxyHops();
  if (proxyHops !== null) {
    app.getHttpAdapter().getInstance().set('trust proxy', proxyHops + 1);
    logger.log(`trust proxy = ${proxyHops + 1} (TRUSTED_PROXY_HOPS=${proxyHops})`);
  }

  // AdminPrefixMiddleware MUST run at Express level (not via MiddlewareConsumer)
  // so it executes before NestJS routing layer. Rewrites /api/admin/* → /api/*
  // so existing controllers (mounted at /api/X via setGlobalPrefix) handle the
  // request transparently. NestJS module-level middleware via forRoutes('*')
  // is unreliable here because path-to-regexp matching can interact poorly
  // with the global prefix; raw app.use() guarantees execution on every request.
  const adminPrefix = new AdminPrefixMiddleware();
  app.use((req, res, next) => adminPrefix.use(req, res, next));

  // No-cache headers for all /api/* responses. Chrome's heuristic cache will
  // store 404 / non-2xx responses without explicit Cache-Control headers,
  // which caused production users to see stale 404 from disk-cache even after
  // a route was fixed (observed on /api/admin/assets/journal after PR #845
  // deploy). Setting Cache-Control: no-store + Pragma: no-cache on every API
  // response forces the browser to revalidate. Cheap (one header), safe for
  // JSON APIs (clients should always re-fetch dashboard data anyway).
  app.use((req, res, next) => {
    if (req.url.startsWith('/api/')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
    next();
  });

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
  // Online Shop custom domain (launch 2026-07) — defensive: flow ปกติใช้
  // same-origin rewrite ผ่าน Firebase Hosting แต่กัน direct-call ไว้ด้วย
  if (!allowedOrigins.includes('https://www.bestchoicephone.com')) {
    allowedOrigins.push('https://www.bestchoicephone.com');
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
  if (options.swagger !== false && process.env.NODE_ENV !== 'production') {
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

  // P2-SP5 — e-Tax submission mode boot notice. Disabled by default; the
  // module still exposes XML generation so accounting can inspect outputs.
  const etaxMode = process.env.ETAX_SUBMIT_MODE ?? 'disabled';
  if (etaxMode === 'disabled') {
    logger.warn(
      '[e-Tax] submission disabled (ETAX_SUBMIT_MODE=disabled) — only XML generation available. Set to "enabled" + configure cert/RD creds to send to สรรพากร.',
    );
  } else {
    logger.log('[e-Tax] submission ENABLED — cert + RD creds expected via /settings/e-tax-config');
  }
}
