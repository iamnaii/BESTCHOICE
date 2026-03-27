import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { DocumentsService } from './documents.service';
import { CreateTemplateDto, UpdateTemplateDto, SignContractDto, GenerateDocumentDto } from './dto/document.dto';
import { OcrGenerateTemplateDto } from '../ocr/dto/ocr.dto';
import { OcrService } from '../ocr/ocr.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class DocumentsController {
  constructor(
    private documentsService: DocumentsService,
    private ocrService: OcrService,
  ) {}

  // ─── Contract Templates ──────────────────────────────
  @Get('contract-templates')
  @Roles('OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT', 'SALES')
  findAllTemplates(@Query('type') type?: string) {
    return this.documentsService.findAllTemplates(type);
  }

  @Post('contract-templates/generate-from-file')
  @Roles('OWNER')
  @Throttle({ short: { limit: 3, ttl: 60000 } })
  generateTemplateFromFile(@Body() dto: OcrGenerateTemplateDto) {
    return this.ocrService.generateTemplateHtml(dto.fileBase64);
  }

  @Get('contract-templates/:id')
  @Roles('OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT', 'SALES')
  findOneTemplate(@Param('id') id: string) {
    return this.documentsService.findOneTemplate(id);
  }

  @Post('contract-templates')
  @Roles('OWNER')
  createTemplate(@Body() dto: CreateTemplateDto) {
    return this.documentsService.createTemplate(dto);
  }

  @Patch('contract-templates/:id')
  @Roles('OWNER')
  updateTemplate(@Param('id') id: string, @Body() dto: UpdateTemplateDto) {
    return this.documentsService.updateTemplate(id, dto);
  }

  @Delete('contract-templates/:id')
  @Roles('OWNER')
  deleteTemplate(@Param('id') id: string) {
    return this.documentsService.deleteTemplate(id);
  }

  // ─── E-Signature (พ.ร.บ.ธุรกรรมทางอิเล็กทรอนิกส์ พ.ศ. 2544) ──
  @Post('contracts/:id/sign')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  @Throttle({ short: { limit: 10, ttl: 60000 } })
  signContract(
    @Param('id') id: string,
    @Body() dto: SignContractDto,
    @Req() req: any,
    @CurrentUser() user: { id: string },
  ) {
    return this.documentsService.signContract(id, dto.signatureImage, dto.signerType, {
      ip: req.ip,
      userAgent: req.headers?.['user-agent'],
    }, {
      signatureSvg: dto.signatureSvg,
      signerName: dto.signerName,
      screenSize: dto.screenSize,
      gpsLatitude: dto.gpsLatitude,
      gpsLongitude: dto.gpsLongitude,
      staffUserId: user.id,
    });
  }

  @Delete('contracts/:id/signatures/:signerType')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  deleteSignature(@Param('id') id: string, @Param('signerType') signerType: string) {
    return this.documentsService.deleteSignature(id, signerType);
  }

  @Get('contracts/:id/signatures')
  @Roles('OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT', 'SALES')
  getSignatures(@Param('id') id: string) {
    return this.documentsService.getSignatures(id);
  }

  // ─── E-Document ───────────────────────────────────────
  @Post('contracts/:id/generate-document')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  generateDocument(
    @Param('id') id: string,
    @Body() dto: GenerateDocumentDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.documentsService.generateDocument(id, user.id, dto.documentType || 'CONTRACT', dto.templateId);
  }

  @Post('contracts/:id/generate-signed-documents')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  generateSignedDocuments(
    @Param('id') id: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.documentsService.generateSignedDocuments(id, user.id);
  }

  @Post('contracts/:id/generate-pdpa-document')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  generatePdpaDocument(
    @Param('id') id: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.documentsService.generatePdpaDocument(id, user.id);
  }

  @Get('contracts/:id/documents')
  @Roles('OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT', 'SALES')
  getDocuments(@Param('id') id: string) {
    return this.documentsService.getDocuments(id);
  }

  @Get('contracts/:id/preview')
  @Roles('OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT', 'SALES')
  previewContract(@Param('id') id: string, @Query('templateId') templateId?: string) {
    return this.documentsService.previewContract(id, templateId);
  }

  @Get('documents/:id')
  @Roles('OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT', 'SALES')
  getDocument(@Param('id') id: string) {
    return this.documentsService.getDocument(id);
  }

  // ─── Document Download ───────────────────────────────
  @Get('documents/:id/download')
  @Roles('OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT', 'SALES')
  async downloadDocument(@Param('id') id: string, @Res() res: any) {
    const { stream, filename, contentType } = await this.documentsService.getDocumentStream(id);
    res.set({
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
    });
    stream.pipe(res);
  }

  @Get('documents/:id/signed-url')
  @Roles('OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT', 'SALES')
  getSignedUrl(@Param('id') id: string) {
    return this.documentsService.getDocumentSignedUrl(id);
  }
}
