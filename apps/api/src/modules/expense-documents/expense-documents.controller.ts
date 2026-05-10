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
    @Query('branchId') branchId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Req() req?: { user: { id: string; branchId?: string; role: string } },
  ) {
    // Branch scoping mirror: if user lacks cross-branch role, override with their branch
    const effective =
      req?.user.role && ['OWNER', 'FINANCE_MANAGER'].includes(req.user.role)
        ? branchId
        : req?.user.branchId ?? branchId;
    return this.service.getSummary({ branchId: effective, startDate, endDate });
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
