import { ChatLibraryDeliveryService } from './services/chat-library-delivery.service';
import { LibraryItemDto, SendLibraryFilesDto } from './dto/chat-library.dto';
import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { Response } from 'express';
import { pipeline } from 'stream/promises';
import type { ChatWorkActor } from '@installment/shared';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { WORK_ROLES } from './services/chat-work-access.service';
import { ChatLibraryService } from './services/chat-library.service';
import {
  CreateLibraryFolderDto,
  LibraryQueryDto,
  UploadLibraryFileDto,
} from './dto/chat-library.dto';
import { StaffInboxQueryDto } from './dto/staff-inbox.dto';
@Controller('staff-chat/library')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...WORK_ROLES)
export class ChatLibraryController {
  constructor(
    private readonly library: ChatLibraryService,
    private readonly delivery: ChatLibraryDeliveryService,
  ) {}
  @Post('rooms/:roomId/send') send(
    @Req() req: { user: ChatWorkActor },
    @Query() query: StaffInboxQueryDto,
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @Body() dto: SendLibraryFilesDto,
  ) {
    return this.delivery.send(req.user, query, roomId, dto);
  }
  @Post('rooms/:roomId/credit') credit(
    @Req() req: { user: ChatWorkActor },
    @Query() query: StaffInboxQueryDto,
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @Body() dto: LibraryItemDto,
  ) {
    return this.delivery.credit(req.user, query, roomId, dto);
  }
  @Get('folders') folders(@Req() req: { user: ChatWorkActor }, @Query() query: LibraryQueryDto) {
    return this.library.folders(req.user, query);
  }
  @Post('folders') folder(
    @Req() req: { user: ChatWorkActor },
    @Query() query: StaffInboxQueryDto,
    @Body() dto: CreateLibraryFolderDto,
  ) {
    return this.library.createFolder(req.user, query, dto);
  }
  @Get('files') files(@Req() req: { user: ChatWorkActor }, @Query() query: LibraryQueryDto) {
    return this.library.files(req.user, query);
  }
  @Post('files')
  @Throttle({ short: { limit: 20, ttl: 60000 } })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024, files: 1 } }))
  upload(
    @Req() req: { user: ChatWorkActor },
    @Query() query: StaffInboxQueryDto,
    @Body() dto: UploadLibraryFileDto,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.library.upload(req.user, query, dto, file);
  }
  @Get('files/:id/content')
  async content(
    @Req() req: { user: ChatWorkActor },
    @Query() query: StaffInboxQueryDto,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ) {
    const { file, stream } = await this.library.content(req.user, query, id);
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader(
      'Content-Disposition',
      `inline; filename*=UTF-8''${encodeURIComponent(file.name)}`,
    );
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    await pipeline(stream, res);
  }
}
