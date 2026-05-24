import { Body, Controller, Get, Post, Param, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ContractExchangeService } from './contract-exchange.service';
import { SubmitExchangeRequestDto } from './dto/submit-exchange-request.dto';
import { RejectExchangeRequestDto } from './dto/reject-exchange-request.dto';

@Controller('insurance/exchange-requests')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ContractExchangeController {
  constructor(private readonly svc: ContractExchangeService) {}

  @Post()
  @Roles('SALES', 'BRANCH_MANAGER', 'OWNER')
  submit(@Body() dto: SubmitExchangeRequestDto, @Req() req: any) {
    return this.svc.submit(dto, req.user.id);
  }

  @Get('pending')
  @Roles('OWNER')
  listPending() {
    return this.svc.listPending();
  }

  @Post(':id/approve')
  @Roles('OWNER')
  approve(@Param('id') id: string, @Req() req: any) {
    return this.svc.approve(id, req.user.id);
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
