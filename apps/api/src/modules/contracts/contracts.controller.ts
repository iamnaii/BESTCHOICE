import { Controller, Get, Post, Patch, Param, Body, Query, UseGuards } from '@nestjs/common';
import { ContractsService } from './contracts.service';
import { CreateContractDto, UpdateContractDto, EarlyPayoffDto, ReviewContractDto, RejectContractDto } from './dto/contract.dto';
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
    @Query('workflowStatus') workflowStatus?: string,
    @Query('branchId') branchId?: string,
    @Query('customerId') customerId?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('salespersonId') salespersonId?: string,
  ) {
    const parsedPage = page ? parseInt(page, 10) : undefined;
    const parsedLimit = limit ? Math.min(parseInt(limit, 10), 200) : undefined;
    return this.contractsService.findAll({
      status, workflowStatus, branchId, customerId, search, salespersonId,
      page: parsedPage && !isNaN(parsedPage) ? parsedPage : undefined,
      limit: parsedLimit && !isNaN(parsedLimit) ? parsedLimit : undefined,
    });
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

  @Patch(':id')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateContractDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.contractsService.update(id, dto, user.id);
  }

  // === WORKFLOW ENDPOINTS ===

  @Post(':id/submit-review')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  submitForReview(@Param('id') id: string, @CurrentUser() user: { id: string }) {
    return this.contractsService.submitForReview(id, user.id);
  }

  @Post(':id/approve')
  @Roles('OWNER', 'BRANCH_MANAGER')
  approve(
    @Param('id') id: string,
    @Body() dto: ReviewContractDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.contractsService.approveContract(id, user.id, dto.reviewNotes);
  }

  @Post(':id/reject')
  @Roles('OWNER', 'BRANCH_MANAGER')
  reject(
    @Param('id') id: string,
    @Body() dto: RejectContractDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.contractsService.rejectContract(id, user.id, dto.reviewNotes);
  }

  @Post(':id/activate')
  @Roles('OWNER', 'BRANCH_MANAGER')
  activate(@Param('id') id: string) {
    return this.contractsService.activate(id);
  }

  @Post(':id/early-payoff')
  @Roles('OWNER', 'BRANCH_MANAGER')
  earlyPayoff(@Param('id') id: string, @Body() dto: EarlyPayoffDto, @CurrentUser() user: { id: string }) {
    return this.contractsService.earlyPayoff(id, user.id, dto.paymentMethod);
  }
}
