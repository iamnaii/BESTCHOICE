import {
  Body,
  Controller,
  Delete,
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
import { ChatWorkAccessService, WORK_ROLES } from './services/chat-work-access.service';
import { NoteMentionService } from './services/note-mention.service';
import { StaffMessageService } from './services/staff-message.service';
import { CreateRoomNoteDto, RoomNoteScopeDto } from './dto/create-room-note.dto';
/** Existing note URLs, now sharing current room/company scope for all operations. */
@Controller('staff-chat/rooms/:id/notes')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...WORK_ROLES)
export class RoomNotesController {
  constructor(
    private readonly mentions: NoteMentionService,
    private readonly access: ChatWorkAccessService,
    private readonly notes: StaffMessageService,
  ) {}
  @Post() async create(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateRoomNoteDto,
    @Req() req: { user: ChatWorkActor },
    @Query() query: RoomNoteScopeDto,
  ) {
    const { actor, scope } = await this.access.roomContext(id, req.user, query);
    return this.mentions.create(id, dto, actor, scope);
  }
  @Get() async list(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: { user: ChatWorkActor },
    @Query() query: RoomNoteScopeDto,
  ) {
    await this.access.roomContext(id, req.user, query);
    return this.notes.getNotes(id);
  }
  @Delete(':noteId') async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('noteId', ParseUUIDPipe) noteId: string,
    @Req() req: { user: ChatWorkActor },
    @Query() query: RoomNoteScopeDto,
  ) {
    const { actor } = await this.access.roomContext(id, req.user, query);
    await this.notes.deleteNote(id, noteId, actor);
    return { success: true };
  }
  @Patch(':noteId/pin') async pin(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('noteId', ParseUUIDPipe) noteId: string,
    @Req() req: { user: ChatWorkActor },
    @Query() query: RoomNoteScopeDto,
  ) {
    const { actor } = await this.access.roomContext(id, req.user, query);
    return this.notes.pinNote(id, noteId, actor.id);
  }
  @Delete(':noteId/pin') async unpin(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('noteId', ParseUUIDPipe) noteId: string,
    @Req() req: { user: ChatWorkActor },
    @Query() query: RoomNoteScopeDto,
  ) {
    await this.access.roomContext(id, req.user, query);
    await this.notes.unpinNote(id, noteId);
    return { success: true };
  }
}
