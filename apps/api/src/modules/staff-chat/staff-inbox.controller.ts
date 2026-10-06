import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ChatWorkActor } from '@installment/shared';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { StaffInboxService } from './services/staff-inbox.service';
import { ChatWorkAccessService, WORK_ROLES } from './services/chat-work-access.service';
import { StaffInboxQueryDto } from './dto/staff-inbox.dto';

@Controller('staff-chat')
@UseGuards(JwtAuthGuard, RolesGuard)
export class StaffInboxController {
  constructor(
    private readonly inbox: StaffInboxService,
    private readonly access: ChatWorkAccessService,
  ) {}
  @Get('work-notifications')
  @Roles(...WORK_ROLES)
  list(@Req() req: { user: ChatWorkActor }, @Query() query: StaffInboxQueryDto) {
    return this.inbox.list(req.user, query, query.page, query.limit);
  }
  @Patch('work-notifications/:id/read')
  @Roles(...WORK_ROLES)
  read(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: { user: ChatWorkActor },
    @Query() query: StaffInboxQueryDto,
  ) {
    return this.inbox.markRead(id, req.user, query);
  }
  @Get('rooms/:id/eligible-staff')
  @Roles(...WORK_ROLES)
  staff(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: { user: ChatWorkActor },
    @Query() query: StaffInboxQueryDto,
  ) {
    return this.access.eligibleStaff(id, req.user, query);
  }
}
