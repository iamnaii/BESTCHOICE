import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { MigrationService } from './migration.service';
import { BulkImportDto, ImportCustomerDto, ImportContractDto } from './dto/import.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('migration')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER')
export class MigrationController {
  constructor(private migrationService: MigrationService) {}

  @Get('status')
  getStatus() {
    return this.migrationService.getMigrationStatus();
  }

  @Post('import/customers')
  importCustomers(@Body() customers: ImportCustomerDto[]) {
    return this.migrationService.importCustomers(customers);
  }

  @Post('import/contracts')
  importContracts(@Body() contracts: ImportContractDto[]) {
    return this.migrationService.importContracts(contracts);
  }

  @Post('import/bulk')
  bulkImport(@Body() dto: BulkImportDto) {
    return this.migrationService.bulkImport(dto);
  }
}
