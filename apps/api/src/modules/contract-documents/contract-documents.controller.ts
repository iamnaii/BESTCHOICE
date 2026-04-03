import { Controller, Get, Post, Delete, Param, Body, Query, UseGuards, Req } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { ContractDocumentsService } from './contract-documents.service';
import { UploadContractDocumentDto } from './dto/contract-document.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@ApiTags('Documents')
@ApiBearerAuth('JWT')
@Controller('contracts/:contractId/documents')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ContractDocumentsController {
  constructor(private service: ContractDocumentsService) {}

  @Get()
  @Roles('OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT', 'SALES')
  findByContract(
    @Param('contractId') contractId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const parsedPage = page ? parseInt(page, 10) : undefined;
    const parsedLimit = limit ? Math.min(parseInt(limit, 10), 200) : undefined;
    return this.service.findByContract(
      contractId,
      parsedPage && !isNaN(parsedPage) ? parsedPage : undefined,
      parsedLimit && !isNaN(parsedLimit) ? parsedLimit : undefined,
    );
  }

  @Get('checklist')
  @Roles('OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT', 'SALES')
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
  @Roles('OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT', 'SALES')
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
  @Roles('OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT', 'SALES')
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
