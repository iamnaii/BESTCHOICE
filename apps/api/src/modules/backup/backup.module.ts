import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module';
import { OffsiteBackupService } from './offsite-backup.service';
import { OffsiteBackupCron } from './offsite-backup.cron';
import { BackupController } from './backup.controller';

/**
 * Phase 3 SP2 — Backup module.
 *
 * Provides the off-site replication service + cron + admin controller.
 * AuthModule is imported so JwtAuthGuard can resolve its strategy
 * dependencies for the controller.
 */
@Module({
  imports: [ConfigModule, AuthModule],
  controllers: [BackupController],
  providers: [OffsiteBackupService, OffsiteBackupCron],
  exports: [OffsiteBackupService],
})
export class BackupModule {}
