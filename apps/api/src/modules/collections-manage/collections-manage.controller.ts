import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CollectionsManageService } from './collections-manage.service';
import { AssignDto } from './dto/assign.dto';
import { TransferDto } from './dto/transfer.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('collections/manage')
export class CollectionsManageController {
  constructor(private manage: CollectionsManageService) {}

  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER')
  @Get('board')
  board(@CurrentUser() user: any) {
    const scope = user.role === 'BRANCH_MANAGER' && user.branchId ? [user.branchId] : undefined;
    return this.manage.getBoard(scope);
  }

  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER')
  @Post('assign')
  assign(@Body() dto: AssignDto) {
    return this.manage.assignContract(dto.assignmentId, dto.toCollectorId ?? null);
  }

  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER')
  @Post('lock')
  lock() {
    return this.manage.lock();
  }

  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER')
  @Post('transfer')
  transfer(@Body() dto: TransferDto) {
    return this.manage.transfer(dto);
  }

  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER')
  @Post('close-session/:collectorId')
  close(@Param('collectorId') collectorId: string) {
    return this.manage.closeSession(collectorId);
  }

  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER')
  @Post('auto-balance')
  autoBalance() {
    return this.manage.autoBalance();
  }
}
