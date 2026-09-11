import { Controller, Get, Post, Delete, Param, Body, Query, UseGuards, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { ContractDocumentsService } from './contract-documents.service';
import { UploadContractDocumentDto } from './dto/contract-document.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ContractFileAccessGuard } from './contract-file-access.guard';
import { pipeDocumentStream } from './services/document-stream';
import { PaginationDto } from '../../common/dto/pagination.dto';

@ApiTags('Documents')
@ApiBearerAuth('JWT')
@Controller('contracts/:contractId/documents')
@UseGuards(JwtAuthGuard, RolesGuard, ContractFileAccessGuard)
export class ContractDocumentsController {
  constructor(private service: ContractDocumentsService) {}

  @Get()
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  findByContract(@Param('contractId') contractId: string, @Query() pagination: PaginationDto) {
    return this.service.findByContract(contractId, pagination.page, pagination.limit);
  }

  @Get('checklist')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  getDocumentChecklist(@Param('contractId') contractId: string) {
    return this.service.getDocumentChecklist(contractId);
  }

  @Get('audit-trail')
  @Roles('OWNER', 'BRANCH_MANAGER')
  getDocumentAuditTrail(@Param('contractId') contractId: string) {
    return this.service.getDocumentAuditTrail(contractId);
  }

  @Post()
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  upload(
    @Param('contractId') contractId: string,
    @Body() dto: UploadContractDocumentDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.service.upload(contractId, dto, user.id);
  }

  @Post(':docId/view')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  recordView(
    @Param('contractId') contractId: string,
    @Param('docId') docId: string,
    @CurrentUser() user: { id: string },
    @Req() req: Request,
  ) {
    return this.service.recordView(contractId, docId, user.id, {
      ip: req.ip,
      userAgent: req.headers?.['user-agent'],
    });
  }

  @Get(':docId/content')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  async content(@Param('contractId') contractId: string, @Param('docId') docId: string, @Res() res: Response,
    @CurrentUser() user: { id: string }, @Req() req: Request) {
    await this.service.recordView(contractId, docId, user.id, { ip: req.ip, userAgent: req.headers['user-agent'] });
    const file = await this.service.getContent(contractId, docId);
    pipeDocumentStream(res, file);
  }

  @Post(':docId/download')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  recordDownload(
    @Param('contractId') contractId: string,
    @Param('docId') docId: string,
    @CurrentUser() user: { id: string },
    @Req() req: Request,
  ) {
    return this.service.recordDownload(contractId, docId, user.id, {
      ip: req.ip,
      userAgent: req.headers?.['user-agent'],
    });
  }

  @Delete(':docId')
  @Roles('OWNER', 'BRANCH_MANAGER')
  remove(
    @Param('contractId') contractId: string,
    @Param('docId') docId: string,
    @CurrentUser() user: { id: string; role: string },
  ) {
    return this.service.remove(contractId, docId, user.id, user.role);
  }
}
