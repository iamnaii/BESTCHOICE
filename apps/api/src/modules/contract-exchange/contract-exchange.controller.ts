import { Body, Controller, Get, Post, Param, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ContractExchangeService } from './contract-exchange.service';
import { ExchangeCancelService } from './contract-exchange-cancel.service';
import { SubmitExchangeRequestDto } from './dto/submit-exchange-request.dto';
import { RejectExchangeRequestDto } from './dto/reject-exchange-request.dto';
import { ApproveExchangeRequestDto } from './dto/approve-exchange-request.dto';
import { CancelExchangeRequestDto } from './dto/cancel-exchange-request.dto';

@Controller('insurance/exchange-requests')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ContractExchangeController {
  constructor(
    private readonly svc: ContractExchangeService,
    private readonly cancelSvc: ExchangeCancelService,
  ) {}

  @Post()
  @Roles('SALES', 'BRANCH_MANAGER', 'OWNER')
  submit(@Body() dto: SubmitExchangeRequestDto, @Req() req: any) {
    // Pass the full user object — the service does an in-service branch check
    // (issue #1086 item 2) and needs role + branchId, not just the id.
    return this.svc.submit(dto, req.user);
  }

  @Get('preview')
  @Roles('SALES', 'BRANCH_MANAGER', 'OWNER')
  preview(
    @Req() req: any,
    @Query('oldContractId') oldContractId: string,
    @Query('newProductId') newProductId?: string,
    @Query('buybackPrice') buybackPrice?: string,
    @Query('deviceCondition') deviceCondition?: string,
    @Query('newTotalMonths') newTotalMonths?: string,
    @Query('newInterestRate') newInterestRate?: string,
  ) {
    // Pass the user — buildPreview branch-scopes in-service (Task 8 carry-over
    // from Task 7 review: SALES must not read other branches' NCV/GL by UUID).
    return this.svc.buildPreview(
      {
        oldContractId,
        newProductId,
        buybackPrice,
        deviceCondition,
        newTotalMonths: newTotalMonths ? parseInt(newTotalMonths, 10) : undefined,
        newInterestRate,
      },
      req.user,
    );
  }

  @Get('pending')
  @Roles('OWNER', 'BRANCH_MANAGER')
  listPending(@Req() req: any) {
    // I7: BM sees only their own branch's queue (scoped in-service).
    return this.svc.listPending(req.user);
  }

  @Get('recent')
  @Roles('OWNER', 'BRANCH_MANAGER')
  listRecent(@Req() req: any) {
    // I7: BM sees only their own branch's recent approvals (scoped in-service).
    return this.svc.listRecent(req.user);
  }

  @Post(':id/approve')
  @Roles('OWNER', 'BRANCH_MANAGER')
  approve(
    @Param('id') id: string,
    @Body() dto: ApproveExchangeRequestDto,
    @Req() req: any,
  ) {
    // Tier enforcement (ESCALATE → OWNER only) + branch scoping (I7) live in
    // the service, which re-reads mode/approvalTier from the DB — never trusts
    // the client.
    return this.svc.approve(id, req.user, dto ?? {});
  }

  @Post(':id/cancel')
  @Roles('OWNER', 'BRANCH_MANAGER')
  cancel(@Param('id') id: string, @Body() dto: CancelExchangeRequestDto, @Req() req: any) {
    return this.cancelSvc.cancel(id, dto.reason, req.user);
  }

  @Post(':id/reject')
  @Roles('OWNER')
  reject(
    @Param('id') id: string,
    @Body() dto: RejectExchangeRequestDto,
    @Req() req: any,
  ) {
    return this.svc.reject(id, dto.reason, req.user.id);
  }
}
