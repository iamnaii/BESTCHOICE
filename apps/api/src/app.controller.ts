import { Controller, Get, HttpCode, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { PrismaService } from './prisma/prisma.service';
import { OcrService } from './modules/ocr/ocr.service';
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from './modules/auth/guards/roles.guard';
import { Roles } from './modules/auth/decorators/roles.decorator';

@SkipThrottle()
@Controller()
export class AppController {
  constructor(
    private prisma: PrismaService,
    private ocrService: OcrService,
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

  @Get('health')
  @HttpCode(200)
  async deepHealthCheck() {
    const checks: Record<string, string> = {};

    try {
      await this.prisma.$queryRaw`SELECT 1`;
      checks.database = 'ok';
    } catch {
      checks.database = 'error';
    }

    const memUsage = process.memoryUsage();
    const memMB = Math.round(memUsage.heapUsed / 1024 / 1024);
    checks.memory = `${memMB}MB`;

    const allOk = checks.database === 'ok';

    return {
      status: allOk ? 'ok' : 'degraded',
      service: 'installment-api',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      checks,
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

    // Memory
    const memUsage = process.memoryUsage();

    return {
      api: {
        status: 'ok',
        version: process.env.npm_package_version || '1.0.0',
        uptime: process.uptime(),
        nodeVersion: process.version,
      },
      database,
      ai,
      memory: {
        heapUsedMB: Math.round(memUsage.heapUsed / 1024 / 1024),
        heapTotalMB: Math.round(memUsage.heapTotal / 1024 / 1024),
        rssMB: Math.round(memUsage.rss / 1024 / 1024),
      },
      timestamp: new Date().toISOString(),
    };
  }
}
