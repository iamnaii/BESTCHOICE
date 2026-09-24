import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
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
import { FinanceApplicationService } from './services/finance-application.service';
import { FinanceApplicationFilesService } from './services/finance-application-files.service';
import { SendFinanceApplicationDto, StaffResultDto, UpdateFinanceApplicationDto } from './dto/finance-application.dto';
import { FileFromMessageDto, FileUploadFieldsDto } from './dto/finance-application-files.dto';
import { FinanceActor, FINANCE_APP_ROLES } from './constants';

@Controller('finance-applications')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...FINANCE_APP_ROLES)
export class FinanceApplicationsController {
  constructor(
    private applications: FinanceApplicationService,
    private files: FinanceApplicationFilesService,
  ) {}

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string, @Req() req: { user: FinanceActor }) {
    return this.applications.get(id, req.user);
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateFinanceApplicationDto, @Req() req: { user: FinanceActor }) {
    return this.applications.update(id, dto, req.user);
  }

  @Get(':id/message-preview')
  preview(@Param('id', ParseUUIDPipe) id: string, @Req() req: { user: FinanceActor }) {
    return this.applications.preview(id, req.user);
  }

  @Post(':id/send')
  @Throttle({ short: { limit: 10, ttl: 60000 } })
  send(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SendFinanceApplicationDto, @Req() req: { user: FinanceActor }) {
    return this.applications.send(id, dto, req.user);
  }

  @Post(':id/resend')
  @Throttle({ short: { limit: 10, ttl: 60000 } })
  resend(@Param('id', ParseUUIDPipe) id: string, @Req() req: { user: FinanceActor }) {
    return this.applications.resend(id, req.user);
  }

  @Get(':id/share-link')
  shareLink(@Param('id', ParseUUIDPipe) id: string, @Req() req: { user: FinanceActor }) {
    return this.applications.getShareLink(id, req.user);
  }

  @Post(':id/share/extend')
  extend(@Param('id', ParseUUIDPipe) id: string, @Req() req: { user: FinanceActor }) {
    return this.applications.extendShare(id, req.user);
  }

  @Post(':id/share/revoke')
  revoke(@Param('id', ParseUUIDPipe) id: string, @Req() req: { user: FinanceActor }) {
    return this.applications.revokeShare(id, req.user);
  }

  @Post(':id/result')
  result(@Param('id', ParseUUIDPipe) id: string, @Body() dto: StaffResultDto, @Req() req: { user: FinanceActor }) {
    return this.applications.staffResult(id, dto, req.user);
  }

  @Post(':id/cancel')
  cancel(@Param('id', ParseUUIDPipe) id: string, @Req() req: { user: FinanceActor }) {
    return this.applications.cancel(id, req.user);
  }

  @Post(':id/files/from-message')
  @Throttle({ short: { limit: 30, ttl: 60000 } })
  fromMessage(@Param('id', ParseUUIDPipe) id: string, @Body() dto: FileFromMessageDto, @Req() req: { user: FinanceActor }) {
    return this.files.fromMessage(id, dto, req.user);
  }

  @Post(':id/files')
  @Throttle({ short: { limit: 30, ttl: 60000 } })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024, files: 1 } }))
  upload(@Param('id', ParseUUIDPipe) id: string, @Body() fields: FileUploadFieldsDto, @UploadedFile() file: Express.Multer.File, @Req() req: { user: FinanceActor }) {
    return this.files.upload(id, fields.slot, file, req.user);
  }

  @Post(':id/files/from-product')
  fromProduct(@Param('id', ParseUUIDPipe) id: string, @Req() req: { user: FinanceActor }) {
    return this.files.fromProduct(id, req.user);
  }

  @Delete(':id/files/:fileId')
  remove(@Param('id', ParseUUIDPipe) id: string, @Param('fileId', ParseUUIDPipe) fileId: string, @Req() req: { user: FinanceActor }) {
    return this.files.remove(id, fileId, req.user);
  }

  @Get(':id/files/:fileId')
  async download(@Param('id', ParseUUIDPipe) id: string, @Param('fileId', ParseUUIDPipe) fileId: string, @Req() req: { user: FinanceActor }, @Res() res: Response) {
    const { file, stream } = await this.files.download(id, fileId, req.user);
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(file.originalName ?? `${file.slot}.${file.mimeType.split('/')[1]}`)}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    await pipeline(stream, res);
  }
}
