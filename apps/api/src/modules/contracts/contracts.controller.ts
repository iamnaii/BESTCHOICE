import { Controller, Get, Post, Param, Body, Query, UseGuards } from '@nestjs/common';
import { ContractsService } from './contracts.service';
import { CreateContractDto, EarlyPayoffDto } from './dto/contract.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('contracts')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ContractsController {
  constructor(private contractsService: ContractsService) {}

  @Get()
  findAll(
    @Query('status') status?: string,
    @Query('branchId') branchId?: string,
    @Query('customerId') customerId?: string,
    @Query('search') search?: string,
  ) {
    return this.contractsService.findAll({ status, branchId, customerId, search });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.contractsService.findOne(id);
  }

  @Get(':id/schedule')
  getSchedule(@Param('id') id: string) {
    return this.contractsService.getSchedule(id);
  }

  @Get(':id/early-payoff-quote')
  getEarlyPayoffQuote(@Param('id') id: string) {
    return this.contractsService.getEarlyPayoffQuote(id);
  }

  @Post()
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  create(@Body() dto: CreateContractDto, @CurrentUser() user: { id: string }) {
    return this.contractsService.create(dto, user.id);
  }

  @Post(':id/activate')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  activate(@Param('id') id: string) {
    return this.contractsService.activate(id);
  }

  @Post(':id/early-payoff')
  @Roles('OWNER', 'BRANCH_MANAGER')
  earlyPayoff(@Param('id') id: string, @Body() dto: EarlyPayoffDto, @CurrentUser() user: { id: string }) {
    return this.contractsService.earlyPayoff(id, user.id, dto.paymentMethod);
  }
}
