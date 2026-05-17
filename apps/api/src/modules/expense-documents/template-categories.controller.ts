import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { TemplateCategoriesService } from './template-categories.service';

/**
 * D1.2.4.5 — `GET /template-categories` for the Expense Template
 * "บันทึกเป็นรายการโปรด" form's category dropdown. Read-only.
 *
 * Authenticated, all-roles — categories are non-sensitive reference
 * data that any user creating templates needs to see.
 */
@Controller('template-categories')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TemplateCategoriesController {
  constructor(private readonly service: TemplateCategoriesService) {}

  @Get()
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  list() {
    return this.service.list();
  }
}
