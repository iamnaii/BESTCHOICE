import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { BankAccountsService } from './bank-accounts.service';
import { CreateBankAccountDto } from './dto/create-bank-account.dto';
import { UpdateBankAccountDto } from './dto/update-bank-account.dto';

/**
 * SP6 — `/bank-accounts`
 *
 * Read: OWNER / FINANCE_MANAGER / ACCOUNTANT
 * Write: OWNER only (matches the spec — bank-account changes affect downstream
 * Trial Balance presentation and should funnel through the owner).
 *
 * No BranchGuard — bank/cash accounts are FINANCE-level global entities, not
 * branch-scoped. This differs from Quote/Sale (which use BranchGuard per
 * Hardening v1, PR #430) but matches the IntercompanyController pattern. Per
 * `.claude/rules/accounting.md`: in Phase A.4 only FINANCE has a chart of
 * accounts, and there is no branch-scoped cash dimension yet.
 */
@Controller('bank-accounts')
@UseGuards(JwtAuthGuard, RolesGuard)
export class BankAccountsController {
  constructor(private readonly service: BankAccountsService) {}

  @Get()
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  findAll(@Query('active') active?: string) {
    const activeOnly = active === 'true' ? true : active === 'false' ? false : undefined;
    return this.service.findAll({ activeOnly });
  }

  @Get(':code')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  findByCode(@Param('code') code: string) {
    return this.service.findByCode(code);
  }

  @Get(':code/transactions')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  getTransactions(
    @Param('code') code: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.getTransactions(code, Number(page) || 1, Number(limit) || 50);
  }

  @Post()
  @Roles('OWNER')
  create(@Body() dto: CreateBankAccountDto, @CurrentUser('id') userId: string) {
    return this.service.create(dto, userId);
  }

  @Patch(':code')
  @Roles('OWNER')
  update(
    @Param('code') code: string,
    @Body() dto: UpdateBankAccountDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.service.update(code, dto, userId);
  }

  @Patch(':code/disable')
  @Roles('OWNER')
  disable(@Param('code') code: string, @CurrentUser('id') userId: string) {
    return this.service.disable(code, userId);
  }
}
