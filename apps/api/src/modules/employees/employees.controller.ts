import {
  Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { EmployeesService } from './employees.service';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { ListEmployeesDto } from './dto/list-employees.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

type AuthRequest = Request & { user?: { id: string; role: string } };
const actorOf = (req: AuthRequest) => ({
  userId: req.user?.id,
  ipAddress: req.ip,
  userAgent: req.headers['user-agent'] as string | undefined,
});

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('employees')
export class EmployeesController {
  constructor(private readonly employees: EmployeesService) {}

  @Get()
  @Roles('OWNER', 'ACCOUNTANT')
  list(@Query() dto: ListEmployeesDto) {
    return this.employees.list(dto);
  }

  @Get('pickable')
  @Roles('OWNER', 'ACCOUNTANT', 'FINANCE_MANAGER')
  pickable(@Query('search') search?: string) {
    return this.employees.pickable(search);
  }

  @Get(':id')
  @Roles('OWNER', 'ACCOUNTANT')
  findOne(@Param('id') id: string) {
    return this.employees.findOne(id);
  }

  @Post()
  @Roles('OWNER', 'ACCOUNTANT')
  provision(@Body() dto: CreateEmployeeDto, @Req() req: AuthRequest) {
    return this.employees.provision(dto, actorOf(req));
  }

  @Patch(':id')
  @Roles('OWNER', 'ACCOUNTANT')
  update(@Param('id') id: string, @Body() dto: UpdateEmployeeDto, @Req() req: AuthRequest) {
    return this.employees.update(id, dto, actorOf(req));
  }

  @Delete(':id')
  @Roles('OWNER', 'ACCOUNTANT')
  remove(@Param('id') id: string, @Req() req: AuthRequest) {
    return this.employees.remove(id, actorOf(req));
  }
}
