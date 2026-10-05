import { JourneyManualEntryService } from '../customer-journey/journey-manual-entry.service';
import { ChatSalesDispositionDto } from './dto/chat-sales-disposition.dto';
import {
  Body,
  Controller,
  Get,
  Post,
  Param,
  ParseUUIDPipe,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { ChatWorkActor } from '@installment/shared';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { WORK_ROLES } from './services/chat-work-access.service';
import { StaffInboxQueryDto } from './dto/staff-inbox.dto';
import { ChatSalesContextService } from './services/chat-sales-context.service';
@Controller('staff-chat/rooms/:id')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...WORK_ROLES)
export class ChatSalesContextController {
  constructor(
    private readonly context: ChatSalesContextService,
    private readonly manual: JourneyManualEntryService,
  ) {}
  @Get('sales-context/credit/:analysisId') credit(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('analysisId', ParseUUIDPipe) analysisId: string,
    @Req() req: { user: ChatWorkActor },
    @Query() query: StaffInboxQueryDto,
  ) {
    return this.context.creditEvidence(id, analysisId, req.user, query);
  }
  @Post('sales-disposition') disposition(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChatSalesDispositionDto,
    @Req() req: { user: ChatWorkActor },
    @Query() query: StaffInboxQueryDto,
  ) {
    return this.manual.record({ ...dto, roomId: id }, req.user, query);
  }
  @Get('sales-context') get(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: { user: ChatWorkActor },
    @Query() query: StaffInboxQueryDto,
  ) {
    return this.context.get(id, req.user, query);
  }
}
