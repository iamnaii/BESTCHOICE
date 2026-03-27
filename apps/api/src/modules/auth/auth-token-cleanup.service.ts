import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AuthService } from './auth.service';

@Injectable()
export class AuthTokenCleanupService {
  private readonly logger = new Logger(AuthTokenCleanupService.name);

  constructor(private authService: AuthService) {}

  /**
   * Run daily at 3:00 AM to clean up:
   * - Expired refresh tokens
   * - Revoked tokens older than 7 days (kept for audit trail)
   */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async handleTokenCleanup() {
    try {
      const deletedCount = await this.authService.cleanupExpiredTokens();
      if (deletedCount > 0) {
        this.logger.log(`ลบ refresh token ที่หมดอายุ/ถูก revoke จำนวน ${deletedCount} รายการ`);
      }
    } catch (error) {
      this.logger.error('ล้มเหลวในการลบ refresh token ที่หมดอายุ', error);
    }
  }
}
