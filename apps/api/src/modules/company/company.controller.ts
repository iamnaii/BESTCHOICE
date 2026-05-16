import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { CompanyService } from './company.service';
import { CreateCompanyDto, UpdateCompanyDto } from './dto/company.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@ApiTags('Companies')
@ApiBearerAuth('JWT')
@Controller('companies')
@UseGuards(JwtAuthGuard, RolesGuard)
@UsePipes(new ValidationPipe({ whitelist: true }))
export class CompanyController {
  constructor(private companyService: CompanyService) {}

  @Get()
  @Roles('OWNER')
  findAll() {
    return this.companyService.findAll();
  }

  /**
   * D1.2.2.* — Public-safe CompanyInfo for voucher headers.
   * Authenticated but allowed for all roles (any user printing a voucher).
   * Excludes director PII, bank credentials, VAT internals.
   */
  @Get('public')
  @Roles('OWNER', 'FINANCE_MANAGER', 'BRANCH_MANAGER', 'ACCOUNTANT', 'SALES')
  findPublic() {
    return this.companyService.findPublic();
  }

  @Get(':id')
  @Roles('OWNER')
  findOne(@Param('id') id: string) {
    return this.companyService.findOne(id);
  }

  @Post()
  @Roles('OWNER')
  create(@Body() dto: CreateCompanyDto) {
    return this.companyService.create(dto);
  }

  @Patch(':id')
  @Roles('OWNER')
  update(@Param('id') id: string, @Body() dto: UpdateCompanyDto) {
    return this.companyService.update(id, dto);
  }

  @Delete(':id')
  @Roles('OWNER')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string) {
    await this.companyService.remove(id);
  }
}
