import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards, Req } from '@nestjs/common';
import { DocumentsService } from './documents.service';
import { CreateTemplateDto, UpdateTemplateDto, SignContractDto, GenerateDocumentDto } from './dto/document.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class DocumentsController {
  constructor(private documentsService: DocumentsService) {}

  // ─── Contract Templates ──────────────────────────────
  @Get('contract-templates')
  findAllTemplates(@Query('type') type?: string) {
    return this.documentsService.findAllTemplates(type);
  }

  @Get('contract-templates/:id')
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

  // ─── E-Signature ──────────────────────────────────────
  @Post('contracts/:id/sign')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  signContract(@Param('id') id: string, @Body() dto: SignContractDto, @Req() req: any) {
    return this.documentsService.signContract(id, dto.signatureImage, dto.signerType, {
      ip: req.ip,
      userAgent: req.headers?.['user-agent'],
    });
  }

  @Get('contracts/:id/signatures')
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

  @Get('contracts/:id/documents')
  getDocuments(@Param('id') id: string) {
    return this.documentsService.getDocuments(id);
  }

  @Get('contracts/:id/preview')
  previewContract(@Param('id') id: string, @Query('templateId') templateId?: string) {
    return this.documentsService.previewContract(id, templateId);
  }

  @Get('documents/:id')
  getDocument(@Param('id') id: string) {
    return this.documentsService.getDocument(id);
  }
}
