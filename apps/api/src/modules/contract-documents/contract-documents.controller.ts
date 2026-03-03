import { Controller, Get, Post, Delete, Param, Body, UseGuards } from '@nestjs/common';
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

  @Post()
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  upload(
    @Param('contractId') contractId: string,
    @Body() dto: UploadContractDocumentDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.service.upload(contractId, dto, user.id);
  }

  @Delete(':docId')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  remove(
    @Param('contractId') contractId: string,
    @Param('docId') docId: string,
  ) {
    return this.service.remove(contractId, docId);
  }
}
