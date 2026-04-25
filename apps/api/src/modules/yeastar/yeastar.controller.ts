import { Controller, Post, Get, Body, UseGuards, BadRequestException } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { YeastarService } from './yeastar.service';
import { PrismaService } from '../../prisma/prisma.service';

@Controller('yeastar')
@UseGuards(JwtAuthGuard, RolesGuard)
export class YeastarController {
  constructor(
    private readonly yeastar: YeastarService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('call/originate')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  async originateCall(
    @Body() body: { customerId: string; contractId: string },
    @CurrentUser() user: { id: string },
  ) {
    const agent = await this.prisma.user.findFirst({
      where: { id: user.id, deletedAt: null },
      select: { yeastarExtension: true },
    });

    if (!agent?.yeastarExtension) {
      throw new BadRequestException('กรุณาตั้ง Extension Yeastar ใน Profile ก่อนโทรออก');
    }

    const customer = await this.prisma.customer.findFirst({
      where: { id: body.customerId, deletedAt: null },
      select: { phone: true },
    });

    if (!customer?.phone) {
      throw new BadRequestException('ไม่พบเบอร์โทรของลูกค้า');
    }

    return this.yeastar.originateCall(agent.yeastarExtension, customer.phone);
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
