import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { AccountingService } from './accounting.service';
import { CreateExpenseDto, UpdateExpenseDto, RejectExpenseDto } from './dto/expense.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ExpenseAccountType, ExpenseCategory, ExpenseStatus } from '@prisma/client';

@ApiTags('Expenses')
@ApiBearerAuth('JWT')
@Controller('expenses')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AccountingController {
  constructor(private service: AccountingService) {}

  @Post()
  @Roles('OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT')
  create(
    @Body() dto: CreateExpenseDto,
    @Request() req: { user: { id: string } },
  ) {
    return this.service.createExpense(dto, req.user.id);
  }

  @Get()
  @Roles('OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT')
  findAll(
    @Query('branchId') branchId?: string,
    @Query('accountType') accountType?: ExpenseAccountType,
    @Query('category') category?: ExpenseCategory,
    @Query('status') status?: ExpenseStatus,
    @Query('search') search?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Request() req?: { user: { role: string; branchId?: string } },
  ) {
    const effectiveBranchId =
      req?.user?.role === 'OWNER' || req?.user?.role === 'ACCOUNTANT'
        ? branchId
        : req?.user?.branchId || branchId;

    return this.service.findAllExpenses({
      branchId: effectiveBranchId,
      accountType,
      category,
      status,
      search,
      startDate,
      endDate,
      page: page ? parseInt(page) : 1,
      limit: limit ? parseInt(limit) : 20,
    });
  }

  @Get('summary')
  @Roles('OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT')
  getSummary(
    @Query('branchId') branchId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Request() req?: { user: { role: string; branchId?: string } },
  ) {
    const effectiveBranchId =
      req?.user?.role === 'OWNER' || req?.user?.role === 'ACCOUNTANT'
        ? branchId
        : req?.user?.branchId || branchId;

    return this.service.getExpenseSummary({ branchId: effectiveBranchId, startDate, endDate });
  }

  @Get('category-breakdown')
  @Roles('OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT')
  getCategoryBreakdown(
    @Query('branchId') branchId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Request() req?: { user: { role: string; branchId?: string } },
  ) {
    const effectiveBranchId =
      req?.user?.role === 'OWNER' || req?.user?.role === 'ACCOUNTANT'
        ? branchId
        : req?.user?.branchId || branchId;

    return this.service.getExpenseCategoryBreakdown({ branchId: effectiveBranchId, startDate, endDate });
  }

  @Get(':id')
  @Roles('OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT')
  findOne(@Param('id') id: string) {
    return this.service.findOneExpense(id);
  }

  @Patch(':id')
  @Roles('OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT')
  update(@Param('id') id: string, @Body() dto: UpdateExpenseDto) {
    return this.service.updateExpense(id, dto);
  }

  @Post(':id/submit')
  @Roles('OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT')
  submitForApproval(@Param('id') id: string) {
    return this.service.submitExpenseForApproval(id);
  }

  @Post(':id/approve')
  @Roles('OWNER')
  approve(
    @Param('id') id: string,
    @Request() req: { user: { id: string } },
  ) {
    return this.service.approveExpense(id, req.user.id);
  }

  @Post(':id/reject')
  @Roles('OWNER')
  reject(
    @Param('id') id: string,
    @Body() dto: RejectExpenseDto,
    @Request() req: { user: { id: string } },
  ) {
    return this.service.rejectExpense(id, req.user.id, dto.reason);
  }

  @Post(':id/pay')
  @Roles('OWNER', 'ACCOUNTANT')
  markPaid(
    @Param('id') id: string,
    @Body('paymentDate') paymentDate?: string,
  ) {
    return this.service.markExpensePaid(id, paymentDate);
  }

  @Post(':id/void')
  @Roles('OWNER')
  void(@Param('id') id: string) {
    return this.service.voidExpense(id);
  }
}
