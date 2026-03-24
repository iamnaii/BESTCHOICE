import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    // Append connection pool settings to DATABASE_URL if not already set
    const dbUrl = process.env.DATABASE_URL || '';
    const hasPoolConfig = dbUrl.includes('connection_limit');
    if (!hasPoolConfig && dbUrl) {
      const separator = dbUrl.includes('?') ? '&' : '?';
      process.env.DATABASE_URL = `${dbUrl}${separator}connection_limit=25&pool_timeout=15`;
    }

    super({
      log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
    });

    // Soft-delete middleware: auto-filter deleted records for Customer, Contract, Product
    const softDeleteModels = ['Customer', 'Contract', 'Product'];

    this.$use(async (params, next) => {
      if (!params.model || !softDeleteModels.includes(params.model)) {
        return next(params);
      }

      // Auto-inject deletedAt: null for read operations
      const readActions = ['findMany', 'findFirst', 'findUnique', 'findFirstOrThrow', 'findUniqueOrThrow', 'count', 'aggregate', 'groupBy'];

      if (readActions.includes(params.action)) {
        if (!params.args) params.args = {};
        if (!params.args.where) params.args.where = {};
        // Only add if not explicitly set (allows querying deleted records by setting deletedAt explicitly)
        if (params.args.where.deletedAt === undefined) {
          params.args.where.deletedAt = null;
        }
      }

      // Convert delete to soft-delete
      if (params.action === 'delete') {
        params.action = 'update';
        params.args.data = { deletedAt: new Date() };
      }
      if (params.action === 'deleteMany') {
        params.action = 'updateMany';
        if (!params.args) params.args = {};
        if (!params.args.data) params.args.data = {};
        params.args.data.deletedAt = new Date();
      }

      return next(params);
    });
  }

  async onModuleInit() {
    await this.$connect();
    this.logger.log('Database connected');
  }

  async onModuleDestroy() {
    await this.$disconnect();
    this.logger.log('Database disconnected');
  }
}
