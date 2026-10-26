import { ContractSignaturesAccessService } from './services/contract-signatures-access.service';
import { SIGNATURE_OPERATIONS, signatureHandlers } from '../employee-access/access-signatures-boundaries';
import { GeneratedDocumentsService } from './services/generated-documents.service';
import { GENERATED_DOCUMENT_OPERATIONS, generatedDocumentHandlers } from '../employee-access/access-generated-documents-context';
import { sendGeneratedDocument } from './services/send-generated-document';
import { AccessDocumentTemplateBoundaries } from '../employee-access/access-document-template-boundaries';
import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { DocumentsService } from './documents.service';
import { ContractFileAccess } from './contract-file-access.guard';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { CreateTemplateDto, UpdateTemplateDto, SignContractDto, GenerateDocumentDto } from './dto/document.dto';
import { OcrGenerateTemplateDto } from '../ocr/dto/ocr.dto';
import { OcrService } from '../ocr/ocr.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@ApiTags('Documents')
@ApiBearerAuth('JWT')
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class DocumentsController {
  constructor(
    private documentsService: DocumentsService,
    private ocrService: OcrService,
    private templateAccess: AccessDocumentTemplateBoundaries,
    private generated: GeneratedDocumentsService,
    private signatures: ContractSignaturesAccessService,
  ) {}

  // ─── Contract Templates ──────────────────────────────
  @Get('contract-templates')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  findAllTemplates(
    @Req() req: Request,
    @Query('type') type?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const parsedPage = page ? parseInt(page, 10) : undefined;
    const parsedLimit = limit ? Math.min(parseInt(limit, 10), 200) : undefined;
    return this.templateAccess.enter('findAllTemplates', req, () => this.documentsService.findAllTemplates(
      type,
      parsedPage && !isNaN(parsedPage) ? parsedPage : undefined,
      parsedLimit && !isNaN(parsedLimit) ? parsedLimit : undefined,
    ));
  }

  @Post('contract-templates/generate-from-file')
  @Roles('OWNER')
  @Throttle({ short: { limit: 3, ttl: 60000 } })
  generateTemplateFromFile(@Body() dto: OcrGenerateTemplateDto, @CurrentUser() user: { id: string }, @Req() req: Request) {
    return this.templateAccess.enter('generateTemplateFromFile', req, () => this.ocrService.generateTemplateHtml(dto.fileBase64, user.id));
  }

  @Get('contract-templates/:id')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  findOneTemplate(@Param('id') id: string, @Req() req: Request) {
    return this.templateAccess.enter('findOneTemplate', req, () => this.documentsService.findOneTemplate(id));
  }

  @Post('contract-templates')
  @Roles('OWNER')
  createTemplate(@Body() dto: CreateTemplateDto, @Req() req: Request) {
    return this.templateAccess.enter('createTemplate', req, () => this.documentsService.createTemplate(dto));
  }

  @Patch('contract-templates/:id')
  @Roles('OWNER')
  updateTemplate(@Param('id') id: string, @Body() dto: UpdateTemplateDto, @Req() req: Request) {
    return this.templateAccess.enter('updateTemplate', req, () => this.documentsService.updateTemplate(id, dto));
  }

  @Delete('contract-templates/:id')
  @Roles('OWNER')
  deleteTemplate(@Param('id') id: string, @Req() req: Request) {
    return this.templateAccess.enter('deleteTemplate', req, () => this.documentsService.deleteTemplate(id));
  }

  // ─── E-Signature (พ.ร.บ.ธุรกรรมทางอิเล็กทรอนิกส์ พ.ศ. 2544) ──
  @Post('contracts/:id/sign')
  @ContractFileAccess()
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  @Throttle({ short: { limit: 10, ttl: 60000 } })
  signContract(
    @Param('id') id: string,
    @Body() dto: SignContractDto,
    @Req() req: Request,
  ) {
    return this.signatures.capture(req, dto);
  }

  @Delete('contracts/:id/signatures/:signerType')
  @ContractFileAccess()
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  deleteSignature(@Req() req: Request) {
    return this.signatures.remove(req);
  }

  @Get('contracts/:id/signatures')
  @ContractFileAccess()
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  getSignatures(@Req() req: Request) {
    return this.signatures.list(req);
  }

  // ─── Generated documents: staged source/effects/final commit ───
  @Post('contracts/:id/generate-document')
  @ContractFileAccess()
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  generateDocument(@Body() _dto: GenerateDocumentDto, @Req() req: Request) {
    return this.generated.execute('generateDocument', req);
  }
  @Get('contracts/:id/download-pdf')
  @ContractFileAccess()
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  async downloadPdf(@Req() req: Request, @Res() res: Response) {
    sendGeneratedDocument(res, await this.generated.execute('downloadPdf', req));
  }
  @Post('contracts/:id/generate-signed-documents')
  @ContractFileAccess()
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  generateSignedDocuments(@Body() _dto: GenerateDocumentDto, @Req() req: Request) {
    return this.generated.execute('generateSignedDocuments', req);
  }
  @Post('contracts/admin/regenerate-signed-pdfs')
  @ContractFileAccess()
  @Roles('OWNER')
  regenerateSignedContractPdfs(@Body() _dto: GenerateDocumentDto, @Req() req: Request) {
    return this.generated.execute('regenerateSignedContractPdfs', req);
  }
  @Post('contracts/:id/generate-pdpa-document')
  @ContractFileAccess()
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  generatePdpaDocument(@Body() _dto: GenerateDocumentDto, @Req() req: Request) {
    return this.generated.execute('generatePdpaDocument', req);
  }
  @Get('contracts/:id/e-documents')
  @ContractFileAccess()
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  getDocuments(@Req() req: Request, @Query() _pagination: PaginationDto) {
    return this.generated.execute('getDocuments', req);
  }
  @Get('contracts/:id/preview')
  @ContractFileAccess()
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  previewContract(@Req() req: Request) { return this.generated.execute('previewContract', req); }
  @Get('documents/:id')
  @ContractFileAccess('generated')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  getDocument(@Req() req: Request) { return this.generated.execute('getDocument', req); }
  @Get('documents/:id/download')
  @ContractFileAccess('generated')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  async downloadDocument(@Req() req: Request, @Res() res: Response) {
    sendGeneratedDocument(res, await this.generated.execute('downloadDocument', req));
  }
  @Get('documents/:id/signed-url')
  @ContractFileAccess('generated')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  getSignedUrl(@Req() req: Request) { return this.generated.execute('getSignedUrl', req); }
}
generatedDocumentHandlers.set(DocumentsController, new Map(GENERATED_DOCUMENT_OPERATIONS.map(operation => [DocumentsController.prototype[operation], operation])));

signatureHandlers.set(DocumentsController, new Map(SIGNATURE_OPERATIONS.map(operation => [DocumentsController.prototype[operation], operation])));
