import { Controller, Get, Post, Patch, Param, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { AssetService } from './asset.service';
import { CreateFixedAssetDto, UpdateFixedAssetDto, DisposeAssetDto } from './dto/asset.dto';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@ApiTags('Assets')
@ApiBearerAuth('JWT')
@Controller('assets')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AssetController {
  constructor(private assetService: AssetService) {}

  @Get()
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  findAll(
    @Query() pagination: PaginationDto,
    @Query('branchId') branchId?: string,
    @Query('category') category?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
  ) {
    return this.assetService.findAll({
      branchId,
      category,
      status,
      search,
      page: pagination.page,
      limit: pagination.limit,
    });
  }

  @Get('summary')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  getDepreciationSummary() {
    return this.assetService.getDepreciationSummary();
  }

  @Get('generate-code')
  @Roles('OWNER', 'BRANCH_MANAGER')
  generateAssetCode() {
    return this.assetService.generateAssetCode();
  }

  @Get(':id')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  findOne(@Param('id') id: string) {
    return this.assetService.findOne(id);
  }

  @Post()
  @Roles('OWNER', 'BRANCH_MANAGER')
  create(@Body() dto: CreateFixedAssetDto, @CurrentUser('id') userId: string) {
    return this.assetService.create(dto, userId);
  }

  @Patch(':id')
  @Roles('OWNER', 'BRANCH_MANAGER')
  update(@Param('id') id: string, @Body() dto: UpdateFixedAssetDto) {
    return this.assetService.update(id, dto);
  }

  @Post(':id/dispose')
  @Roles('OWNER')
  dispose(@Param('id') id: string, @Body() dto: DisposeAssetDto) {
    return this.assetService.dispose(id, dto);
  }

  @Post('run-depreciation')
  @Roles('OWNER', 'FINANCE_MANAGER')
  runDepreciation(@CurrentUser('id') userId: string) {
    return this.assetService.runMonthEndDepreciation(undefined, userId);
  }
}
