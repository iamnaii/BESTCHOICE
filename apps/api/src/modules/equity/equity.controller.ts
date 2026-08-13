import {
  Body,
  Controller,
  Delete,
  FileTypeValidator,
  Get,
  HttpCode,
  MaxFileSizeValidator,
  Param,
  ParseFilePipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { EquityService } from './equity.service';
import { EquityAttachmentService } from './services/equity-attachment.service';
import { CreateEquityDocumentDto } from './dto/create-equity-document.dto';
import { UpdateEquityDocumentDto } from './dto/update-equity-document.dto';
import { ReverseEquityDocumentDto } from './dto/reverse-equity-document.dto';
import { JournalPreviewDto } from './dto/journal-preview.dto';
import { CreateShareholderDto, UpdateShareholderDto } from './dto/shareholder.dto';
import { ListEquityDto } from './dto/list-equity.dto';

@Controller('equity')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
@UsePipes(new ValidationPipe({ whitelist: true }))
export class EquityController {
  constructor(
    private readonly service: EquityService,
    private readonly attachments: EquityAttachmentService,
  ) {}

  // ─── Shareholders (literal — ต้องมาก่อน documents/:id) ─────────────────
  @Get('shareholders')
  listShareholders() {
    return this.service.listShareholders();
  }

  @Post('shareholders')
  createShareholder(@Body() dto: CreateShareholderDto) {
    return this.service.createShareholder(dto);
  }

  @Patch('shareholders/:id')
  updateShareholder(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateShareholderDto,
  ) {
    return this.service.updateShareholder(id, dto);
  }

  // ─── Preview ────────────────────────────────────────────────────────────
  @Post('journal-preview')
  @HttpCode(200)
  journalPreview(@Body() dto: JournalPreviewDto) {
    return this.service.journalPreview(dto);
  }

  // ─── Documents ──────────────────────────────────────────────────────────
  @Get('documents')
  list(@Query() query: ListEquityDto) {
    return this.service.list(query);
  }

  @Get('documents/:id')
  findOne(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.findOne(id);
  }

  @Post('documents')
  create(@Body() dto: CreateEquityDocumentDto, @CurrentUser('id') userId: string) {
    return this.service.create(dto, userId);
  }

  @Patch('documents/:id')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateEquityDocumentDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.service.update(id, dto, userId);
  }

  @Delete('documents/:id')
  remove(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser('id') userId: string) {
    return this.service.softDelete(id, userId);
  }

  @Get('maker-checker-enabled')
  makerCheckerEnabled() {
    return this.service.isMakerCheckerEnabled();
  }

  @Post('documents/:id/submit')
  @HttpCode(200)
  submit(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser('id') userId: string) {
    return this.service.submit(id, userId);
  }

  @Post('documents/:id/withdraw')
  @HttpCode(200)
  withdraw(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser('id') userId: string) {
    return this.service.withdraw(id, userId);
  }

  @Post('documents/:id/post')
  @Roles('OWNER', 'FINANCE_MANAGER')
  @HttpCode(200)
  post(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser('id') userId: string) {
    return this.service.post(id, userId);
  }

  @Post('documents/:id/reverse')
  @Roles('OWNER', 'FINANCE_MANAGER')
  @HttpCode(200)
  reverse(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ReverseEquityDocumentDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.service.reverse(id, dto, userId);
  }

  @Post('documents/:id/attachments')
  @UseInterceptors(FileInterceptor('file'))
  uploadAttachment(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser('id') userId: string,
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 5 * 1024 * 1024, message: 'ไฟล์มีขนาดเกิน 5MB' }),
          new FileTypeValidator({ fileType: /^(application\/pdf|image\/(jpeg|png|webp))$/ }),
        ],
        fileIsRequired: true,
        errorHttpStatusCode: 400,
      }),
    )
    file: Express.Multer.File,
  ) {
    return this.attachments.upload(id, file, userId);
  }

  @Get('attachments/:attId/signed-url')
  attachmentSignedUrl(@Param('attId', new ParseUUIDPipe()) attId: string) {
    return this.attachments.getSignedUrl(attId);
  }

  @Delete('documents/:id/attachments/:attId')
  removeAttachment(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('attId', new ParseUUIDPipe()) attId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.attachments.remove(id, attId, userId);
  }

  // Task 8 เพิ่ม: dividend-register
}
