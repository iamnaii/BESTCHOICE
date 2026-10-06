import { FacebookCommentReplyService } from '../chat-adapters/facebook-comment-reply.service';
import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
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
import { FacebookCommentRefreshService } from './services/facebook-comment-refresh.service';
import {
  AssignFacebookCommentDto,
  ConfigureFacebookCommentPageDto,
  FacebookCommentLinkOptionsDto,
  ReplyFacebookCommentDto,
  ReconcileFacebookCommentReplyDto,
  FacebookCommentQueryDto,
  LinkFacebookCommentDto,
  StatusFacebookCommentDto,
} from './dto/facebook-comment.dto';
import { StaffInboxQueryDto } from './dto/staff-inbox.dto';
@Controller('staff-chat/facebook-comments')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...WORK_ROLES)
export class FacebookCommentsController {
  constructor(
    private readonly work: FacebookCommentWorkService,
    private readonly replies: FacebookCommentReplyService,
    private readonly refreshService: FacebookCommentRefreshService,
  ) {}
  @Get() list(@Req() req: { user: ChatWorkActor }, @Query() query: FacebookCommentQueryDto) {
    return this.work.list(req.user, query);
  }
  @Get('page-config')
  @Roles('OWNER')
  pageConfig(@Req() req: { user: ChatWorkActor }, @Query() query: StaffInboxQueryDto) {
    return this.work.pageConfig(req.user, query);
  }
  @Post('page-config/subscribe-feed')
  @Roles('OWNER')
  subscribeFeed(@Req() req: { user: ChatWorkActor }, @Query() query: StaffInboxQueryDto) {
    return this.work.subscribePage(req.user, query);
  }
  @Patch('page-config')
  @Roles('OWNER')
  configurePage(
    @Body() input: ConfigureFacebookCommentPageDto,
    @Req() req: { user: ChatWorkActor },
    @Query() query: StaffInboxQueryDto,
  ) {
    return this.work.configurePage(input, req.user, query);
  }
  @Get(':id/link-options') linkOptions(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: { user: ChatWorkActor },
    @Query() query: FacebookCommentLinkOptionsDto,
  ) {
    return this.work.linkOptions(id, query.search, req.user, query);
  }
  @Post(':id/replies') reply(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: ReplyFacebookCommentDto,
    @Req() req: { user: ChatWorkActor },
    @Query() query: StaffInboxQueryDto,
  ) {
    return this.replies.reply(id, input, req.user, query);
  }
  @Post(':id/records/:recordId/refresh')
  refreshRecord(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('recordId', ParseUUIDPipe) recordId: string,
    @Req() req: { user: ChatWorkActor },
    @Query() query: StaffInboxQueryDto,
  ) {
    return this.refreshService.refresh(id, recordId, req.user, query);
  }
  @Post(':id/refresh-root')
  refreshRoot(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: { user: ChatWorkActor },
    @Query() query: StaffInboxQueryDto,
  ) {
    return this.refreshService.refreshRoot(id, req.user, query);
  }
  @Post('replies/:replyId/reconcile') reconcile(
    @Param('replyId', ParseUUIDPipe) id: string,
    @Body() input: ReconcileFacebookCommentReplyDto,
    @Req() req: { user: ChatWorkActor },
    @Query() query: StaffInboxQueryDto,
  ) {
    return this.replies.reconcile(id, input, req.user, query);
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
