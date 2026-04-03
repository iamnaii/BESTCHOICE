// Set timezone to Asia/Bangkok (UTC+7) for all Date operations
process.env.TZ = 'Asia/Bangkok';

// Sentry: only import if DSN is configured (avoids startup overhead without DSN)
// eslint-disable-next-line @typescript-eslint/no-require-imports
if (process.env.SENTRY_DSN) require('./sentry');

import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger, VersioningType } from '@nestjs/common';
import { json, urlencoded } from 'express';
import cookieParser from 'cookie-parser';
import { HttpAdapterHost } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
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
