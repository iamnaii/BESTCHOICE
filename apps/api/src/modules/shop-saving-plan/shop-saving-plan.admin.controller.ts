import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { SavingPlanStatus } from '@prisma/client';

@Controller('admin/saving-plans')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
export class ShopSavingPlanAdminController {
  constructor(private prisma: PrismaService) {}

  @Get()
  list(@Query('status') status?: string) {
    return this.prisma.savingPlan.findMany({
      where: {
        deletedAt: null,
        ...(status ? { status: status as SavingPlanStatus } : {}),
      },
      include: {
        customer: { select: { id: true, name: true, phone: true } },
        payments: { orderBy: { paidAt: 'desc' }, take: 1 },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }
}
