import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ExpenseCategory } from '@prisma/client';
import { ExpensesService } from './expenses.service';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { UpdateExpenseDto } from './dto/update-expense.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@ApiTags('Expenses')
@ApiBearerAuth()
@Controller('expenses')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ExpensesController {
  constructor(private service: ExpensesService) {}

  @Get()
  @ApiOperation({ summary: 'ดึงรายการค่าใช้จ่าย' })
  @Roles('OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT')
  findAll(
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('branchId') branchId?: string,
    @Query('category') category?: ExpenseCategory,
    @Query('month') month?: string,
    @Query('year') year?: string,
  ) {
    return this.service.findAll(
      search,
      page ? parseInt(page) : 1,
      limit ? parseInt(limit) : 50,
      branchId,
      category,
      month ? parseInt(month) : undefined,
      year ? parseInt(year) : undefined,
    );
  }

  @Get('summary')
  @ApiOperation({ summary: 'สรุปค่าใช้จ่ายรายเดือน' })
  @Roles('OWNER', 'ACCOUNTANT')
  getSummary(
    @Query('month') month?: string,
    @Query('year') year?: string,
    @Query('branchId') branchId?: string,
  ) {
    return this.service.getSummary(
      month ? parseInt(month) : undefined,
      year ? parseInt(year) : undefined,
      branchId,
    );
  }

  @Get('monthly-comparison')
  @ApiOperation({ summary: 'เปรียบเทียบค่าใช้จ่ายรายเดือน (6 เดือน)' })
  @Roles('OWNER', 'ACCOUNTANT')
  getMonthlyComparison(@Query('branchId') branchId?: string) {
    return this.service.getMonthlyComparison(branchId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'ดึงรายละเอียดค่าใช้จ่าย' })
  @Roles('OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @ApiOperation({ summary: 'บันทึกค่าใช้จ่าย' })
  @Roles('OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT')
  create(@Body() dto: CreateExpenseDto, @Request() req: { user: { id: string } }) {
    return this.service.create(dto, req.user.id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'แก้ไขค่าใช้จ่าย' })
  @Roles('OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT')
  update(@Param('id') id: string, @Body() dto: UpdateExpenseDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'ลบค่าใช้จ่าย (soft delete)' })
  @Roles('OWNER')
  delete(@Param('id') id: string) {
    return this.service.delete(id);
  }
}
