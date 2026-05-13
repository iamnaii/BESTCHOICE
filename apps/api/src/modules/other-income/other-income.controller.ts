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
  Put,
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
import { TemplateService } from './services/template.service';
import { CreateOtherIncomeDto } from './dto/create-other-income.dto';
import { UpdateOtherIncomeDto } from './dto/update-other-income.dto';
import { PostOtherIncomeDto } from './dto/post-other-income.dto';
import { ReverseOtherIncomeDto } from './dto/reverse-other-income.dto';
import { RequestApprovalDto } from './dto/request-approval.dto';
import { ApproveOtherIncomeDto } from './dto/approve-other-income.dto';
import { RejectOtherIncomeDto } from './dto/reject-other-income.dto';
import { ListOtherIncomeQueryDto } from './dto/list-other-income-query.dto';
import { DailySheetQueryDto } from './dto/daily-sheet-query.dto';
import { CreateTemplateDto, CreateTemplateFromDocDto } from './dto/create-template.dto';
import { UpdateTemplateDto } from './dto/update-template.dto';
import { ToggleMakerCheckerDto } from './dto/toggle-maker-checker.dto';

@Controller('other-income')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
export class OtherIncomeController {
  constructor(
    private readonly service: OtherIncomeService,
    private readonly templateService: TemplateService,
  ) {}

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

  // CRITICAL: must stay before any :id route so the literal string
  // 'maker-checker-enabled' is not captured as a UUID param.
  @Get('maker-checker-enabled')
  @Roles('OWNER', 'ACCOUNTANT', 'SALES', 'BRANCH_MANAGER', 'FINANCE_MANAGER')
  async getMakerCheckerEnabled() {
    const enabled = await this.service.isMakerCheckerEnabled();
    return { enabled };
  }

  // CRITICAL: literal routes must stay before any :id route.

  /** OWNER: toggle Maker-Checker flow on/off. */
  @Put('maker-checker')
  @Roles('OWNER')
  toggleMakerChecker(
    @Body() dto: ToggleMakerCheckerDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.service.setMakerCheckerEnabled(dto.enabled, userId);
  }

  /** OWNER: count docs pending approval (status=READY). */
  @Get('maker-checker/pending-ready-count')
  @Roles('OWNER')
  pendingReadyCount() {
    return this.service.pendingReadyCount();
  }

  @Get()
  list(@Query() query: ListOtherIncomeQueryDto) {
    return this.service.list(query);
  }

  // ─── Templates (PR-3) ───────────────────────────────────────────────────
  // CRITICAL: these routes MUST be declared BEFORE any /:id route to avoid
  // "templates" being captured as an OtherIncome doc id by Nest's matcher.

  @Get('templates')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  listTemplates(@Query('q') q?: string, @Query('favoritesOnly') favoritesOnly?: string) {
    return this.templateService.list({ q, favoritesOnly: favoritesOnly === 'true' });
  }

  @Post('templates')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  createTemplate(@Body() dto: CreateTemplateDto, @CurrentUser('id') userId: string) {
    return this.templateService.create(
      {
        name: dto.name,
        priceType: dto.priceType,
        itemsJson: dto.items.map((it, i) => ({
          lineNo: i + 1,
          accountCode: it.accountCode,
          description: it.description ?? null,
          quantity: it.quantity,
          unitAmount: it.unitAmount,
          discountAmount: it.discountAmount,
          vatPct: it.vatPct,
          whtPct: it.whtPct,
        })),
      },
      userId,
    );
  }

  @Post('from-doc/:id/save-template')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  saveAsTemplate(
    @Param('id') id: string,
    @Body() dto: CreateTemplateFromDocDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.templateService.createFromDoc(id, dto.name, userId);
  }

  @Patch('templates/:id')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  updateTemplate(@Param('id') id: string, @Body() dto: UpdateTemplateDto) {
    return this.templateService.update(id, dto);
  }

  @Delete('templates/:id')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  deleteTemplate(@Param('id') id: string) {
    return this.templateService.softDelete(id);
  }

  @Post('templates/:id/use')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  useTemplate(@Param('id') id: string) {
    return this.templateService.use(id);
  }

  // ─── OtherIncome docs (parameterized — must stay AFTER literal routes) ──

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
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
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
