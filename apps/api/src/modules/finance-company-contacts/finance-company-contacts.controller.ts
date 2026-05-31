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
import { FinanceCompanyContactsService } from './finance-company-contacts.service';
import {
  CreateFinanceCompanyContactDto,
  UpdateFinanceCompanyContactDto,
} from './dto/finance-company-contact.dto';

@ApiTags('Finance Contacts')
@ApiBearerAuth('JWT')
@Controller('external-finance/companies/:companyId/contacts')
@UseGuards(JwtAuthGuard, RolesGuard)
export class FinanceCompanyContactsController {
  constructor(private readonly service: FinanceCompanyContactsService) {}

  @Get()
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  list(@Param('companyId') companyId: string) {
    return this.service.list(companyId);
  }

  @Post()
  @Roles('OWNER', 'FINANCE_MANAGER')
  create(
    @Param('companyId') companyId: string,
    @Body() dto: CreateFinanceCompanyContactDto,
  ) {
    return this.service.create(companyId, dto);
  }

  @Patch(':contactId')
  @Roles('OWNER', 'FINANCE_MANAGER')
  update(
    @Param('companyId') companyId: string,
    @Param('contactId') contactId: string,
    @Body() dto: UpdateFinanceCompanyContactDto,
  ) {
    return this.service.update(companyId, contactId, dto);
  }

  @Post(':contactId/set-primary')
  @Roles('OWNER', 'FINANCE_MANAGER')
  setPrimary(
    @Param('companyId') companyId: string,
    @Param('contactId') contactId: string,
  ) {
    return this.service.setPrimary(companyId, contactId);
  }

  @Delete(':contactId')
  @Roles('OWNER', 'FINANCE_MANAGER')
  remove(
    @Param('companyId') companyId: string,
    @Param('contactId') contactId: string,
  ) {
    return this.service.softDelete(companyId, contactId);
  }
}
