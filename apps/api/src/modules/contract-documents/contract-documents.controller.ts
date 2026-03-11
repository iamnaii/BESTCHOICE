import { Controller, Get, Post, Delete, Param, Body, UseGuards, Req } from '@nestjs/common';
import { ContractDocumentsService } from './contract-documents.service';
import { UploadContractDocumentDto } from './dto/contract-document.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('contracts/:contractId/documents')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ContractDocumentsController {
  constructor(private service: ContractDocumentsService) {}

  @Get()
  findByContract(@Param('contractId') contractId: string) {
    return this.service.findByContract(contractId);
  }

  @Get('checklist')
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
  recordView(
    @Param('contractId') contractId: string,
    @Param('docId') docId: string,
    @CurrentUser() user: { id: string },
    @Req() req: any,
  ) {
    return this.service.recordView(contractId, docId, user.id, {
      ip: req.ip,
      userAgent: req.headers?.['user-agent'],
    });
  }

  @Post(':docId/download')
  recordDownload(
    @Param('contractId') contractId: string,
    @Param('docId') docId: string,
    @CurrentUser() user: { id: string },
    @Req() req: any,
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
