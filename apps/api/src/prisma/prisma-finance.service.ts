import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client-finance';

@Injectable()
export class PrismaFinanceService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaFinanceService.name);
  /**
   * SP7.1 hotfix — bc_finance DB is optional until provisioned.
   * `false` when DATABASE_URL_FINANCE is unset; consumers should check before
   * making queries. HealthController reports a 'skipped' status, app boots
   * normally so Cloud Run revision can become healthy.
   */
  public readonly isEnabled: boolean;

  constructor() {
    // Same pool-config strategy as PrismaService — append connection_limit + pool_timeout
    // to DATABASE_URL_FINANCE if not already set.
    const dbUrl = process.env.DATABASE_URL_FINANCE || '';
    const hasPoolConfig = dbUrl.includes('connection_limit');
    if (!hasPoolConfig && dbUrl) {
      const connectionLimit = process.env.DATABASE_FINANCE_CONNECTION_LIMIT || '10';
      const poolTimeout = process.env.DATABASE_FINANCE_POOL_TIMEOUT || '15';
      const separator = dbUrl.includes('?') ? '&' : '?';
      process.env.DATABASE_URL_FINANCE = `${dbUrl}${separator}connection_limit=${connectionLimit}&pool_timeout=${poolTimeout}`;
    }

    super({
      log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
    });

    this.isEnabled = !!dbUrl;
  }

  async onModuleInit() {
    if (!this.isEnabled) {
      this.logger.warn(
        'DATABASE_URL_FINANCE not set — PrismaFinanceService is disabled. ' +
          'SP7.7 migration scripts + cross-entity flows will no-op until bc_finance Cloud SQL provisioned.',
      );
      return;
    }
    await this.$connect();
    this.logger.log('Finance database connected');
  }

  async onModuleDestroy() {
    if (!this.isEnabled) return;
    await this.$disconnect();
    this.logger.log('Finance database disconnected');
  }
}
