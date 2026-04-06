import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { RepossessionsService } from './repossessions.service';
import { CreateRepossessionDto, UpdateRepossessionDto } from './dto/create-repossession.dto';
import { ReadyForSaleDto } from './dto/ready-for-sale.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@ApiTags('Repossessions')
@ApiBearerAuth('JWT')
@Controller('repossessions')
@UseGuards(JwtAuthGuard, RolesGuard)
export class RepossessionsController {
  constructor(private repossessionsService: RepossessionsService) {}

  @Get()
  @Roles('OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT')
  findAll(
    @Query('status') status?: string,
    @Query('branchId') branchId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.repossessionsService.findAll({
      status,
      branchId,
      page: page ? parseInt(page) : undefined,
      limit: limit ? parseInt(limit) : undefined,
    });
  }

  @Get('profit-loss')
  @Roles('OWNER', 'ACCOUNTANT')
  getProfitLoss(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const parsedPage = page ? parseInt(page, 10) : undefined;
    const parsedLimit = limit ? Math.min(parseInt(limit, 10), 200) : undefined;
    return this.repossessionsService.getProfitLossSummary(
      parsedPage && !isNaN(parsedPage) ? parsedPage : undefined,
      parsedLimit && !isNaN(parsedLimit) ? parsedLimit : undefined,
    );
  }

  @Get(':id')
  @Roles('OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT')
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
    @Body() dto: ReadyForSaleDto,
  ) {
    return this.repossessionsService.markReadyForSale(id, dto.resellPrice);
  }
}
