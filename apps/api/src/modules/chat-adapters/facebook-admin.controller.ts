import { Controller, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { FacebookBackfillService } from './facebook-backfill.service';

/**
 * OWNER-only admin actions for the Facebook integration.
 * Separate from the (public) FacebookWebhookController so it can be guarded.
 */
@Controller('admin/facebook')
@UseGuards(JwtAuthGuard, RolesGuard)
export class FacebookAdminController {
  constructor(private readonly backfill: FacebookBackfillService) {}

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
}
