import { Controller, Get, Post, Param, UseGuards } from '@nestjs/common';
import { CustomerAccessService } from './customer-access.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Public } from '../auth/decorators/public.decorator';

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class CustomerAccessController {
  constructor(private customerAccessService: CustomerAccessService) {}

  // Staff generates a link for customer (requires auth)
  @Post('contracts/:id/customer-link')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  generateAccessToken(@Param('id') contractId: string) {
    return this.customerAccessService.generateAccessToken(contractId);
  }

  // Customer accesses documents via token (NO auth required - public endpoint)
  @Get('customer-access/:token')
  @Public()
  accessDocuments(@Param('token') token: string) {
    return this.customerAccessService.accessDocuments(token);
  }
}
