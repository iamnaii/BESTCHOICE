import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Request,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  ParseFilePipe,
  MaxFileSizeValidator,
  FileTypeValidator,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { OtherIncomeService } from './other-income.service';
import { CreateOtherIncomeDto } from './dto/create-other-income.dto';
import { UpdateOtherIncomeDto } from './dto/update-other-income.dto';
import { PostOtherIncomeDto } from './dto/post-other-income.dto';
import { ReverseOtherIncomeDto } from './dto/reverse-other-income.dto';
import { RequestApprovalDto } from './dto/request-approval.dto';
import { ApproveOtherIncomeDto } from './dto/approve-other-income.dto';
import { RejectOtherIncomeDto } from './dto/reject-other-income.dto';
import { ListOtherIncomeQueryDto } from './dto/list-other-income-query.dto';
import { DailySheetQueryDto } from './dto/daily-sheet-query.dto';

@Controller('other-income')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
export class OtherIncomeController {
  constructor(private readonly service: OtherIncomeService) {}

  // CRITICAL: declare daily-sheet BEFORE :id so the literal string
  // doesn't get parsed as a UUID by ParseUUIDPipe on the :id routes.
  @Get('daily-sheet')
  dailySheet(@Query() q: DailySheetQueryDto) {
    return this.service.dailySheet(q.date);
  }

  @Get('config/attachment-threshold')
  async attachmentThreshold() {
    return { threshold: await this.service.getAttachmentThreshold() };
  }

  @Get()
  list(@Query() query: ListOtherIncomeQueryDto) {
    return this.service.list(query);
  }

  @Get(':id')
  findOne(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.findOneOrFail(id);
  }

  @Get(':id/audit')
  getAuditTrail(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.getAuditTrail(id);
  }

  @Post()
  create(@Body() dto: CreateOtherIncomeDto, @CurrentUser('id') userId: string) {
    return this.service.create(dto, userId);
  }

  @Patch(':id')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateOtherIncomeDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.service.update(id, dto, userId);
  }

  @Delete(':id')
  softDelete(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.service.softDelete(id, userId);
  }

  @Post(':id/post')
  post(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: PostOtherIncomeDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.service.post(id, dto, userId);
  }

  @Post(':id/reverse')
  @Roles('OWNER', 'FINANCE_MANAGER')
  reverse(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ReverseOtherIncomeDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.service.reverse(id, dto, userId);
  }

  @Post(':id/request-approval')
  @Roles('OWNER', 'ACCOUNTANT', 'SALES')
  @HttpCode(200)
  requestApproval(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser('id') userId: string) {
    return this.service.requestApproval(id, userId);
  }

  @Post(':id/approve')
  @Roles('OWNER')
  @HttpCode(200)
  approve(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ApproveOtherIncomeDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.service.approve(id, dto, userId);
  }

  @Post(':id/reject')
  @Roles('OWNER')
  @HttpCode(200)
  reject(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: RejectOtherIncomeDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.service.reject(id, dto, userId);
  }

  @Post(':id/copy')
  copy(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.service.copy(id, userId);
  }

  @Post(':id/attachments')
  @UseInterceptors(FileInterceptor('file'))
  async uploadAttachment(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser('id') userId: string,
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({
            maxSize: 5 * 1024 * 1024,
            message: 'ไฟล์มีขนาดเกิน 5MB',
          }),
          new FileTypeValidator({
            fileType: /^(application\/pdf|image\/(jpeg|png|webp))$/,
          }),
        ],
        fileIsRequired: true,
        errorHttpStatusCode: 400,
      }),
    )
    file: Express.Multer.File,
  ) {
    return this.service.uploadAttachment(id, file, userId);
  }
}
