import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { FinanceApplicationService } from './services/finance-application.service';
import { FinanceApplicationFilesService } from './services/finance-application-files.service';
import { OcrFromMessageDto } from './dto/finance-application-files.dto';
import { FinanceActor, FINANCE_APP_ROLES } from './constants';

@Controller('staff-chat/rooms/:roomId/finance-applications')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...FINANCE_APP_ROLES)
export class RoomFinanceApplicationsController {
  constructor(
    private applications: FinanceApplicationService,
    private files: FinanceApplicationFilesService,
  ) {}

  @Get()
  @Roles(...FINANCE_APP_ROLES)
  list(@Param('roomId', ParseUUIDPipe) roomId: string, @Req() req: { user: FinanceActor }) {
    return this.applications.listForRoom(roomId, req.user);
  }

  @Post()
  @Roles(...FINANCE_APP_ROLES)
  create(@Param('roomId', ParseUUIDPipe) roomId: string, @Req() req: { user: FinanceActor }) {
    return this.applications.createDraft(roomId, req.user);
  }

  @Post('ocr-id-card')
  @Roles(...FINANCE_APP_ROLES)
  @Throttle({ short: { limit: 10, ttl: 60_000 } })
  ocrIdCard(@Param('roomId', ParseUUIDPipe) roomId: string, @Body() dto: OcrFromMessageDto, @Req() req: { user: FinanceActor }) {
    return this.files.ocrIdCardFromMessage(roomId, dto.messageId, req.user);
  }
}
