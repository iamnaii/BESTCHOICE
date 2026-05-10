import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { BranchGuard } from '../auth/guards/branch.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ExpenseDocumentsService } from './expense-documents.service';
import { CreateExpenseDocumentDto } from './dto/create.dto';
import { UpdateExpenseDocumentDto } from './dto/update.dto';
import { ListExpenseDocumentsQueryDto } from './dto/list-query.dto';
import { CreateCreditNoteDto } from './dto/create-credit-note.dto';
import { CreatePayrollDto } from './dto/create-payroll.dto';
import { CreateSettlementDto } from './dto/create-settlement.dto';
import { hasCrossBranchAccess } from '../auth/branch-access.util';

@Controller('expense-documents')
@UseGuards(JwtAuthGuard, RolesGuard, BranchGuard)
export class ExpenseDocumentsController {
  constructor(private readonly service: ExpenseDocumentsService) {}

  @Post()
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  create(
    @Body() dto: CreateExpenseDocumentDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.service.create(dto, user.id);
  }

  @Post('credit-note')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  createCreditNote(
    @Body() dto: CreateCreditNoteDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.service.createCreditNote(dto, user.id);
  }

  @Post('payroll')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  createPayroll(
    @Body() dto: CreatePayrollDto,
    @CurrentUser() user: { id: string; branchId?: string | null; role?: string | null },
  ) {
    return this.service.createPayroll(dto, user);
  }

  @Post('settlement')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  createSettlement(
    @Body() dto: CreateSettlementDto,
    @CurrentUser() user: { id: string; branchId?: string; role: string },
  ) {
    return this.service.createSettlement(dto, user);
  }

  @Get()
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  list(
    @Query() query: ListExpenseDocumentsQueryDto,
    @Req() req: { user: { id: string; branchId?: string; role: string } },
  ) {
    return this.service.list(query, { branchId: req.user.branchId, role: req.user.role });
  }

  @Get('summary')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  summary(
    @Req() req: { user: { id: string; branchId?: string; role: string } },
    @Query('branchId') branchId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    // Mirror list() scoping: cross-branch roles see all (or filter by ?branchId);
    // others are pinned to their own branch — query param ignored.
    // @Req() is non-optional: JwtAuthGuard guarantees req.user is present.
    const effective = hasCrossBranchAccess(req.user)
      ? branchId
      : req.user.branchId;
    return this.service.getSummary({ branchId: effective, startDate, endDate });
  }

  @Get('daily-summary')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  dailySummary(
    @Query('date') date: string,
    @Query('branchId') branchId: string | undefined,
    @CurrentUser() user: { id: string; branchId?: string | null; role?: string | null },
  ) {
    return this.service.getDailySummary({ date, branchId }, user);
  }

  @Post('preview-je')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  previewJe(@Body() dto: CreateExpenseDocumentDto) {
    return this.service.previewJe(dto);
  }

  @Get(':id/cn-cap')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  cnCap(@Param('id') id: string) {
    return this.service.getCreditNoteCap(id);
  }

  @Get(':id')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Patch(':id')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateExpenseDocumentDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.service.update(id, dto, user.id);
  }

  @Post(':id/post')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  post(@Param('id') id: string, @CurrentUser() user: { id: string }) {
    return this.service.post(id, user.id);
  }

  @Post(':id/void')
  @Roles('OWNER', 'FINANCE_MANAGER')
  void(@Param('id') id: string, @CurrentUser() user: { id: string }) {
    return this.service.voidDocument(id, user.id);
  }

  @Delete(':id')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  delete(@Param('id') id: string, @CurrentUser() user: { id: string }) {
    return this.service.softDelete(id, user.id);
  }
}
