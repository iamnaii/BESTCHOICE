import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  ParseIntPipe,
  DefaultValuePipe,
  ParseFilePipe,
  MaxFileSizeValidator,
  FileTypeValidator,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiBearerAuth, ApiConsumes } from '@nestjs/swagger';
import { BroadcastService } from './broadcast.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@ApiTags('LINE OA - Broadcast')
@ApiBearerAuth('JWT')
@Controller('line-oa/broadcast')
@UseGuards(JwtAuthGuard, RolesGuard)
export class BroadcastController {
  constructor(private broadcastService: BroadcastService) {}

  /** Send broadcast immediately */
  @Post()
  @Roles('OWNER')
  async sendBroadcast(
    @Body()
    body: {
      messages: { type: string; content: any }[]; // array up to 5
      audience?: string; // ALL | EXISTING | OVERDUE | NEW, default ALL
    },
    @CurrentUser('id') userId: string,
  ) {
    return this.broadcastService.sendBroadcast({
      messages: body.messages,
      audience: body.audience ?? 'ALL',
      createdById: userId,
    });
  }

  /** Schedule a broadcast for later */
  @Post('schedule')
  @Roles('OWNER')
  async scheduleBroadcast(
    @Body()
    body: {
      messages: { type: string; content: any }[]; // array up to 5
      audience?: string;
      scheduledAt: string; // ISO date string
    },
    @CurrentUser('id') userId: string,
  ) {
    return this.broadcastService.sendBroadcast({
      messages: body.messages,
      audience: body.audience ?? 'ALL',
      scheduledAt: new Date(body.scheduledAt),
      createdById: userId,
    });
  }

  /** Paginated broadcast history */
  @Get('history')
  @Roles('OWNER')
  async getHistory(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    return this.broadcastService.getHistory(page, limit);
  }

  /** Audience count per group */
  @Get('audience-count')
  @Roles('OWNER')
  async getAudienceCount() {
    return this.broadcastService.getAudienceCount();
  }

  /** LINE follower count (legacy stats endpoint) */
  @Get('stats')
  @Roles('OWNER')
  async getStats() {
    const followers = await this.broadcastService.getFollowerCount();
    return { followers };
  }

  /** Upload image for broadcast (returns public URL) */
  @Post('upload-image')
  @Roles('OWNER')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file'))
  async uploadImage(
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 10 * 1024 * 1024, message: 'ไฟล์มีขนาดเกิน 10MB' }),
          new FileTypeValidator({ fileType: /^image\/(jpeg|png|gif|webp)$/ }),
        ],
      }),
    )
    file: Express.Multer.File,
  ) {
    return this.broadcastService.uploadImage(file.buffer, file.originalname);
  }

  /** Cancel a scheduled broadcast */
  @Delete(':id')
  @Roles('OWNER')
  async cancelScheduled(@Param('id') id: string) {
    return this.broadcastService.cancelScheduled(id);
  }

  /**
   * Approve a PENDING_APPROVAL broadcast (P2Q15=A — SoD).
   * FINANCE_MANAGER included so the owner doesn't have to approve every send.
   */
  @Post(':id/approve')
  @Roles('OWNER', 'FINANCE_MANAGER')
  async approveBroadcast(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.broadcastService.approveBroadcast(id, userId);
  }

  @Post(':id/reject')
  @Roles('OWNER', 'FINANCE_MANAGER')
  async rejectBroadcast(
    @Param('id') id: string,
    @Body() body: { reason: string },
    @CurrentUser('id') userId: string,
  ) {
    return this.broadcastService.rejectBroadcast(id, userId, body.reason);
  }
}
