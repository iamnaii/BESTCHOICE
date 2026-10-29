import { Injectable, OnModuleInit, OnApplicationShutdown, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    // Append connection pool settings to DATABASE_URL if not already set
    // Default connection_limit=10 is safe for Cloud Run auto-scale:
    // 10 instances × 10 connections = 100 = Cloud SQL Basic tier limit
    const dbUrl = process.env.DATABASE_URL || '';
    const hasPoolConfig = dbUrl.includes('connection_limit');
    if (!hasPoolConfig && dbUrl) {
      const connectionLimit = process.env.DATABASE_CONNECTION_LIMIT || '10';
      const poolTimeout = process.env.DATABASE_POOL_TIMEOUT || '15';
      const separator = dbUrl.includes('?') ? '&' : '?';
      process.env.DATABASE_URL = `${dbUrl}${separator}connection_limit=${connectionLimit}&pool_timeout=${poolTimeout}`;
    }

    super({
      log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
    });
  }

  async onModuleInit() {
    await this.$connect();
    this.logger.log('Database connected');
  }

  /**
   * ตัด DB ใน onApplicationShutdown (เฟสสุดท้าย) ไม่ใช่ onModuleDestroy —
   * เพื่อให้ CronLifecycleService.beforeApplicationShutdown หยุด cron และรองานค้าง
   * ให้จบก่อน (เดิม DB ถูกตัดก่อน cron หยุด → error ตอน instance ปิด)
   */
  async onApplicationShutdown() {
    await this.$disconnect();
    this.logger.log('Database disconnected');
  }
}
