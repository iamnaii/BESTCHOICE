import { Controller, Post, Get, Body, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { YeastarService } from './yeastar.service';

@Controller('yeastar')
@UseGuards(JwtAuthGuard, RolesGuard)
export class YeastarController {
  constructor(private readonly yeastar: YeastarService) {}

  @Post('call/originate')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  async originateCall(
    @Body() body: { customerId: string; contractId: string },
    @CurrentUser() user: { id: string },
  ) {
    return this.yeastar.originateForUser(user.id, body.customerId);
  }

  @Get('extensions')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  async listExtensions() {
    return this.yeastar.getExtensions();
  }

  @Get('ping')
  @Roles('OWNER')
  async ping() {
    return this.yeastar.ping();
  }
}
