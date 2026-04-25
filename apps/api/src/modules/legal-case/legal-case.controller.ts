import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { LegalCaseService } from './legal-case.service';
import { CreateLegalCaseDto } from './dto/create-legal-case.dto';
import { UpdateLegalCaseDto } from './dto/update-legal-case.dto';
import {
  PresignLegalDocumentDto,
  RegisterLegalDocumentDto,
} from './dto/upload-document.dto';

/**
 * LegalCase endpoints (P2 Task 7).
 *
 * **Role gate**: OWNER + FINANCE_MANAGER only — court filings carry
 * legal/financial liability so we lock the surface tightly.
 *
 * Routing scheme: all routes are scoped by contract because each contract
 * has at most one active LegalCase (`contractId` is unique on the model).
 */
@ApiTags('LegalCase')
@ApiBearerAuth('JWT')
@Controller('legal-cases')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'FINANCE_MANAGER')
export class LegalCaseController {
  constructor(private readonly service: LegalCaseService) {}

  @Get(':contractId')
  findByContract(@Param('contractId') contractId: string) {
    return this.service.findByContract(contractId);
  }

  @Post(':contractId')
  create(
    @Param('contractId') contractId: string,
    @Body() dto: CreateLegalCaseDto,
  ) {
    return this.service.create(contractId, dto);
  }

  @Patch(':contractId')
  update(
    @Param('contractId') contractId: string,
    @Body() dto: UpdateLegalCaseDto,
  ) {
    return this.service.update(contractId, dto);
  }

  @Delete(':contractId')
  softDelete(@Param('contractId') contractId: string) {
    return this.service.softDelete(contractId);
  }

  @Post(':contractId/documents/presign')
  presign(
    @Param('contractId') contractId: string,
    @Body() dto: PresignLegalDocumentDto,
  ) {
    return this.service.presignDocumentUpload(contractId, dto);
  }

  @Post(':contractId/documents')
  register(
    @Param('contractId') contractId: string,
    @Body() dto: RegisterLegalDocumentDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.service.registerDocument(contractId, user.id, dto);
  }
}
