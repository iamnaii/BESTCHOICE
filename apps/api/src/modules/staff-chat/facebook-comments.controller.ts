import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { ChatWorkActor } from '@installment/shared';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { WORK_ROLES } from './services/chat-work-access.service';
import { FacebookCommentWorkService } from './services/facebook-comment-work.service';
import {
  AssignFacebookCommentDto,
  FacebookCommentQueryDto,
  LinkFacebookCommentDto,
  StatusFacebookCommentDto,
} from './dto/facebook-comment.dto';
import { StaffInboxQueryDto } from './dto/staff-inbox.dto';
@Controller('staff-chat/facebook-comments')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...WORK_ROLES)
export class FacebookCommentsController {
  constructor(private readonly work: FacebookCommentWorkService) {}
  @Get() list(@Req() req: { user: ChatWorkActor }, @Query() query: FacebookCommentQueryDto) {
    return this.work.list(req.user, query);
  }
  @Get(':id') get(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: { user: ChatWorkActor },
    @Query() query: StaffInboxQueryDto,
  ) {
    return this.work.get(id, req.user, query, query.page);
  }
  @Get(':id/eligible-staff') eligible(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: { user: ChatWorkActor },
    @Query() query: StaffInboxQueryDto,
  ) {
    return this.work.eligible(id, req.user, query);
  }
  @Patch(':id/assign') assign(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: AssignFacebookCommentDto,
    @Req() req: { user: ChatWorkActor },
    @Query() query: StaffInboxQueryDto,
  ) {
    return this.work.assign(id, input, req.user, query);
  }
  @Patch(':id/status') status(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: StatusFacebookCommentDto,
    @Req() req: { user: ChatWorkActor },
    @Query() query: StaffInboxQueryDto,
  ) {
    return this.work.status(id, input, req.user, query);
  }
  @Patch(':id/link') link(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: LinkFacebookCommentDto,
    @Req() req: { user: ChatWorkActor },
    @Query() query: StaffInboxQueryDto,
  ) {
    return this.work.link(id, input, req.user, query);
  }
}
