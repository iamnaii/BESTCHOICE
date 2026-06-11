import { Controller, Get, Post, Param, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { CustomerAccessService } from './customer-access.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Public } from '../auth/decorators/public.decorator';

@ApiTags('Customers')
@ApiBearerAuth('JWT')
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

  // Customer accesses documents via token (NO auth required - public endpoint).
  // Per-IP throttle: the 256-bit token makes guessing infeasible, but the rate
  // limit blocks a single IP from grinding token attempts / hammering the endpoint.
  @Get('customer-access/:token')
  @Public()
  @Throttle({ short: { limit: 20, ttl: 60_000 } })
  accessDocuments(@Param('token') token: string) {
    return this.customerAccessService.accessDocuments(token);
  }
}
