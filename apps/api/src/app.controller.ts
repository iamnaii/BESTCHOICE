import { Controller, Get, UseGuards, Inject, Optional } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from './prisma/prisma.service';
import { OcrService } from './modules/ocr/ocr.service';
import { NotificationQueueService } from './modules/notifications/notification-queue.service';
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from './modules/auth/guards/roles.guard';
import { Roles } from './modules/auth/decorators/roles.decorator';

@SkipThrottle()
@Controller()
export class AppController {
  constructor(
    private prisma: PrismaService,
    private ocrService: OcrService,
    private configService: ConfigService,
    @Inject(CACHE_MANAGER) private cache: Cache,
    @Optional() @Inject(NotificationQueueService) private notificationQueue?: NotificationQueueService,
  ) {}

  @Get()
  healthCheck() {
    return {
      status: 'ok',
      service: 'installment-api',
      version: process.env.npm_package_version || '1.0.0',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    };
  }

  @Get('system-status')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER')
  async systemStatus() {
    // Database check
    let database = { connected: false, latencyMs: 0, error: undefined as string | undefined };
    try {
      const start = Date.now();
      await this.prisma.$queryRaw`SELECT 1`;
      database = { connected: true, latencyMs: Date.now() - start, error: undefined };
    } catch (err) {
      database = { connected: false, latencyMs: 0, error: (err as Error).message };
    }

    // AI check
    const ai = await this.ocrService.checkAiStatus();

    // Redis/Cache check
    let redis = { connected: false, type: 'in-memory' as string, error: undefined as string | undefined };
    try {
      await this.cache.set('_health_check', 'ok', 5);
      const val = await this.cache.get('_health_check');
      const isRedis = !!this.configService.get('REDIS_HOST');
      redis = { connected: val === 'ok', type: isRedis ? 'redis' : 'in-memory', error: undefined };
    } catch (err) {
      redis = { connected: false, type: 'error', error: (err as Error).message };
    }

    // S3 Storage check
    const s3 = {
      configured: !!(this.configService.get('S3_ACCESS_KEY') && this.configService.get('S3_SECRET_KEY')),
      endpoint: this.configService.get('S3_ENDPOINT') || 'not configured',
      bucket: this.configService.get('S3_BUCKET') || 'not configured',
    };

    // LINE OA check
    const line = {
      configured: !!(this.configService.get('LINE_CHANNEL_ACCESS_TOKEN') && this.configService.get('LINE_CHANNEL_SECRET')),
      liffId: this.configService.get('VITE_LIFF_ID') || 'not configured',
    };

    // SMS check
    const sms = {
      configured: !!(this.configService.get('SMS_API_KEY') && this.configService.get('SMS_API_SECRET')),
      provider: 'ThaiBulkSMS',
    };

    // Payment Gateway check
    const payment = {
      configured: !!(this.configService.get('PAYSOLUTIONS_SECRET_KEY')),
      provider: 'Pay Solutions',
      merchantId: this.configService.get('PAYSOLUTIONS_MERCHANT_ID') ? '****' + this.configService.get('PAYSOLUTIONS_MERCHANT_ID')!.slice(-4) : 'not configured',
    };

    // Email/SMTP check
    const email = {
      configured: !!(this.configService.get('SMTP_HOST') && this.configService.get('SMTP_PASS')),
      host: this.configService.get('SMTP_HOST') || 'not configured',
    };

    // Sentry check
    const sentry = {
      configured: !!this.configService.get('SENTRY_DSN'),
    };

    // Notification Queue check
    const queue = this.notificationQueue
      ? await this.notificationQueue.getQueueStats()
      : { available: false };

    // Memory
    const memUsage = process.memoryUsage();

    return {
      api: {
        status: 'ok',
        version: process.env.npm_package_version || '1.0.0',
        uptime: process.uptime(),
        nodeVersion: process.version,
        environment: process.env.NODE_ENV || 'development',
      },
      database,
      ai,
      redis,
      services: { s3, line, sms, payment, email, sentry, queue },
      memory: {
        heapUsedMB: Math.round(memUsage.heapUsed / 1024 / 1024),
        heapTotalMB: Math.round(memUsage.heapTotal / 1024 / 1024),
        rssMB: Math.round(memUsage.rss / 1024 / 1024),
      },
      timestamp: new Date().toISOString(),
    };
  }
}
