import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
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
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CreditRoomActor, RoomCreditService } from '../credit-check/services/room-credit.service';
import { AttachCreditMessageDto } from './dto/room-credit.dto';

@Controller('staff-chat/rooms/:roomId/credit-check')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
export class RoomCreditController {
  constructor(private credit: RoomCreditService) {}

  @Get()
  get(@Param('roomId', ParseUUIDPipe) roomId: string, @Req() req: { user: CreditRoomActor }) {
    return this.credit.get(roomId, req.user);
  }

  @Post('messages')
  @Throttle({ short: { limit: 20, ttl: 60000 } })
  attach(
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @Body() dto: AttachCreditMessageDto,
    @Req() req: { user: CreditRoomActor },
  ) {
    return this.credit.attachMessage(roomId, dto.messageId, req.user);
  }

  @Post('files')
  @Throttle({ short: { limit: 20, ttl: 60000 } })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024, files: 1 } }))
  upload(
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @UploadedFile() file: Express.Multer.File,
    @Req() req: { user: CreditRoomActor },
  ) {
    return this.credit.upload(roomId, file, req.user);
  }

  @Delete('files/:fileId')
  remove(
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @Param('fileId', ParseUUIDPipe) fileId: string,
    @Req() req: { user: CreditRoomActor },
  ) {
    return this.credit.remove(roomId, fileId, req.user);
  }

  @Get('files/:fileId')
  async download(
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @Param('fileId', ParseUUIDPipe) fileId: string,
    @Req() req: { user: CreditRoomActor },
    @Res() res: Response,
  ) {
    const { file, stream } = await this.credit.download(roomId, fileId, req.user);
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${file.name}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    await pipeline(stream, res);
  }
}
