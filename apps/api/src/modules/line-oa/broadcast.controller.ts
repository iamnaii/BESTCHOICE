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
      type: string;
      content: any;
      audience?: string; // ALL | EXISTING | OVERDUE | NEW, default ALL
    },
    @CurrentUser('id') userId: string,
  ) {
    return this.broadcastService.sendBroadcast({
      type: body.type,
      content: body.content,
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
      type: string;
      content: any;
      audience?: string;
      scheduledAt: string; // ISO date string
    },
    @CurrentUser('id') userId: string,
  ) {
    return this.broadcastService.sendBroadcast({
      type: body.type,
      content: body.content,
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
  async uploadImage(@UploadedFile() file: Express.Multer.File) {
    return this.broadcastService.uploadImage(file.buffer, file.originalname);
  }

  /** Cancel a scheduled broadcast */
  @Delete(':id')
  @Roles('OWNER')
  async cancelScheduled(@Param('id') id: string) {
    return this.broadcastService.cancelScheduled(id);
  }
}
