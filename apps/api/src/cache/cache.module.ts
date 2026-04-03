import { Module, Global } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { ConfigService } from '@nestjs/config';

/**
 * Global cache module with Redis backend (if configured) or in-memory fallback.
 *
 * Usage in any service:
 *   @Inject(CACHE_MANAGER) private cache: Cache
 *   await this.cache.get('key')
 *   await this.cache.set('key', value, ttl)
 */
@Global()
@Module({
  imports: [
    CacheModule.registerAsync({
      useFactory: async (config: ConfigService) => {
        const redisHost = config.get<string>('REDIS_HOST');
        const redisPort = config.get<number>('REDIS_PORT', 6379);

        if (redisHost) {
          // Redis backend for production
          const { redisStore } = await import('cache-manager-ioredis-yet');
          return {
            store: redisStore,
            host: redisHost,
            port: redisPort,
            ttl: 300, // default 5 minutes
            max: 1000,
          };
        }

        // In-memory fallback for development
        return {
          ttl: 300,
          max: 500,
        };
      },
      inject: [ConfigService],
    }),
  ],
  exports: [CacheModule],
})
export class AppCacheModule {}
