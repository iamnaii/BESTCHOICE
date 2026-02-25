import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards } from '@nestjs/common';
import { RepossessionsService } from './repossessions.service';
import { CreateRepossessionDto, UpdateRepossessionDto } from './dto/create-repossession.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('repossessions')
@UseGuards(JwtAuthGuard, RolesGuard)
export class RepossessionsController {
  constructor(private repossessionsService: RepossessionsService) {}

  @Get()
  findAll(
    @Query('status') status?: string,
    @Query('branchId') branchId?: string,
  ) {
    return this.repossessionsService.findAll({ status, branchId });
  }

  @Get('profit-loss')
  @Roles('OWNER', 'ACCOUNTANT')
  getProfitLoss() {
    return this.repossessionsService.getProfitLossSummary();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.repossessionsService.findOne(id);
  }

  @Post()
  @Roles('OWNER')
  create(
    @Body() dto: CreateRepossessionDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.repossessionsService.create(dto, user.id);
  }

  @Patch(':id')
  @Roles('OWNER', 'BRANCH_MANAGER')
  update(@Param('id') id: string, @Body() dto: UpdateRepossessionDto) {
    return this.repossessionsService.update(id, dto);
  }

  @Post(':id/ready-for-sale')
  @Roles('OWNER', 'BRANCH_MANAGER')
  markReadyForSale(
    @Param('id') id: string,
    @Body('resellPrice') resellPrice: number,
  ) {
    return this.repossessionsService.markReadyForSale(id, resellPrice);
  }
}
