import { Controller, Get, Post, Param, Body, Query, UseGuards, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { BranchReceivingService } from './branch-receiving.service';
import { CreateBranchReceivingDto } from './dto/branch-receiving.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { BranchGuard } from '../auth/guards/branch.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@ApiTags('Products')
@ApiBearerAuth('JWT')
@Controller('branch-receiving')
@UseGuards(JwtAuthGuard, RolesGuard, BranchGuard)
export class BranchReceivingController {
  constructor(private service: BranchReceivingService) {}

  @Get()
  @Roles('OWNER', 'BRANCH_MANAGER')
  findAll(
    @Query('branchId') branchId?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.findAll({
      branchId,
      status,
      page: page ? parseInt(page) : undefined,
      limit: limit ? parseInt(limit) : undefined,
    });
  }

  @Get('pending-deliveries')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  getPendingDeliveries(@Query('branchId') branchId: string) {
    if (!branchId) {
      throw new BadRequestException('กรุณาระบุ branchId');
    }
    return this.service.getPendingDeliveries(branchId);
  }

  @Get(':id')
  @Roles('OWNER', 'BRANCH_MANAGER')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @Roles('OWNER', 'BRANCH_MANAGER')
  receive(
    @Body() dto: CreateBranchReceivingDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.service.receive(dto, user.id);
  }
}
