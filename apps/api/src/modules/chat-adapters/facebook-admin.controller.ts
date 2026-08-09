import { Controller, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { FacebookBackfillService } from './facebook-backfill.service';
import { FacebookPersistentMenuService } from '../facebook-domain/facebook-persistent-menu.service';

/**
 * OWNER-only admin actions for the Facebook integration.
 * Separate from the (public) FacebookWebhookController so it can be guarded.
 */
@Controller('admin/facebook')
@UseGuards(JwtAuthGuard, RolesGuard)
export class FacebookAdminController {
  constructor(
    private readonly backfill: FacebookBackfillService,
    private readonly persistentMenu: FacebookPersistentMenuService,
  ) {}

  /**
   * Re-fetch display name + avatar for existing FB rooms (one-shot backfill).
   * Call repeatedly (onlyMissing defaults true) until `updatedPicture` is 0.
   */
  @Post('backfill-profiles')
  @Roles('OWNER')
  async backfillProfiles(
    @Query('onlyMissing') onlyMissing?: string,
    @Query('limit') limit?: string,
  ) {
    const parsedLimit = limit ? parseInt(limit, 10) : undefined;
    return this.backfill.backfillProfiles({
      onlyMissingPicture: onlyMissing !== 'false',
      limit: Number.isFinite(parsedLimit) ? parsedLimit : undefined,
    });
  }

  /**
   * ตั้งปุ่ม Get Started + ข้อความทักทาย + persistent menu ของเพจ (idempotent)
   * ต้องกด 1 ครั้งหลัง deploy B4 ไม่งั้นลิงก์ m.me?ref= จากหน้าสินค้าจะไม่ส่ง ref
   * มาให้ webhook สำหรับลูกค้าใหม่
   */
  @Post('setup-messenger-profile')
  @Roles('OWNER')
  async setupMessengerProfile() {
    const getStarted = await this.persistentMenu.setupGetStarted();
    const menu = await this.persistentMenu.setupMenu();
    return { getStarted, menu };
  }
}
