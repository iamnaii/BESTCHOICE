import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  HttpCode,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { AssetCategory, AssetStatus } from '@prisma/client';
import { AssetService } from './asset.service';
import { AssetTransferService } from './asset-transfer.service';
import { CreateAssetDto } from './dto/create-asset.dto';
import { UpdateAssetDto } from './dto/update-asset.dto';
import { ReverseAssetDto } from './dto/reverse-asset.dto';
import { TransferAssetDto } from './dto/transfer-asset.dto';
import { DisposeAssetDto } from './dto/dispose-asset.dto';
import { ReverseDisposalDto } from './dto/reverse-disposal.dto';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { BranchGuard } from '../auth/guards/branch.guard';
import { ReversePermissionGuard } from '../auth/guards/reverse-permission.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@ApiTags('Assets')
@ApiBearerAuth('JWT')
@Controller('assets')
@UseGuards(JwtAuthGuard, RolesGuard, BranchGuard)
export class AssetController {
  constructor(
    private readonly assetService: AssetService,
    private readonly transferService: AssetTransferService,
  ) {}

  @Get()
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  findAll(
    @Query() pagination: PaginationDto,
    @Query('branchId') branchId?: string,
    @Query('category') category?: AssetCategory,
    @Query('status') status?: AssetStatus,
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
  getSummary() {
    return this.assetService.getDepreciationSummary();
  }

  @Get('generate-code')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  generateCode(@Query('category') category?: AssetCategory) {
    // No tx — controller is read-only (returns next free code suggestion).
    return this.assetService.generateAssetCode(undefined, category);
  }

  @Get('register')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  getRegister(
    @Query() pagination: PaginationDto,
    @Query('asOfDate') asOfDate?: string,
    @Query('category') category?: AssetCategory,
    @Query('status') status?: AssetStatus,
    @Query('branchId') branchId?: string,
    @Query('search') search?: string,
  ) {
    return this.assetService.getRegister({
      asOfDate,
      category,
      status,
      branchId,
      search,
      page: pagination.page,
      limit: pagination.limit,
    });
  }

  @Get('audit')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT') // BRANCH_MANAGER removed: global view exposes cross-branch audit (CROSS_BRANCH_ROLES policy)
  listGlobalAudit(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('action') action?: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
  ) {
    const parsedPage = page ? parseInt(page, 10) : undefined;
    const parsedLimit = limit ? parseInt(limit, 10) : undefined;
    return this.assetService.listGlobalAudit({
      page: Number.isInteger(parsedPage) && parsedPage! > 0 ? parsedPage : undefined,
      limit: Number.isInteger(parsedLimit) && parsedLimit! > 0 ? parsedLimit : undefined,
      action,
      fromDate,
      toDate,
    });
  }

  @Get(':id')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  findOne(@Param('id') id: string) {
    return this.assetService.findOne(id);
  }

  @Get(':id/audit')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  audit(@Param('id') id: string) {
    return this.assetService.getAuditTrail(id);
  }

  @Get(':id/schedule')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  getSchedule(@Param('id') id: string) {
    return this.assetService.getAssetSchedule(id);
  }

  @Post()
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  create(@Body() dto: CreateAssetDto, @CurrentUser('id') userId: string) {
    return this.assetService.createDraft(dto, userId);
  }

  @Patch(':id')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  update(@Param('id') id: string, @Body() dto: UpdateAssetDto) {
    return this.assetService.update(id, dto);
  }

  @Delete(':id')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  @HttpCode(204)
  delete(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.assetService.delete(id, userId);
  }

  @Post(':id/post')
  @Roles('OWNER', 'FINANCE_MANAGER')
  post(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.assetService.post(id, userId);
  }

  @Post(':id/reverse')
  // Coarse superset — ReversePermissionGuard narrows per the dynamic
  // `reverse_permission` mode (default OWNER+FM mode rejects ACCOUNTANT;
  // the +ACCOUNTANT / CUSTOM modes may allow it).
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  @UseGuards(ReversePermissionGuard)
  reverse(
    @Param('id') id: string,
    @Body() dto: ReverseAssetDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.assetService.reverse(id, userId, dto.reason, {
      reasonLabel: dto.reasonLabel,
      note: dto.note,
    });
  }

  @Post(':id/transfer')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  transfer(
    @Param('id') id: string,
    @Body() dto: TransferAssetDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.transferService.transfer(id, dto, userId);
  }

  @Post(':id/dispose')
  @Roles('OWNER', 'FINANCE_MANAGER')
  dispose(
    @Param('id') id: string,
    @Body() dto: DisposeAssetDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.assetService.dispose(id, dto, userId);
  }

  @Post(':id/reverse-dispose')
  // Coarse superset — ReversePermissionGuard narrows per the dynamic
  // `reverse_permission` mode (default OWNER+FM mode rejects ACCOUNTANT;
  // the +ACCOUNTANT / CUSTOM modes may allow it).
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  @UseGuards(ReversePermissionGuard)
  reverseDispose(
    @Param('id') id: string,
    @Body() dto: ReverseDisposalDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.assetService.reverseDispose(id, dto.reason, userId, {
      reasonLabel: dto.reasonLabel,
      note: dto.note,
    });
  }

  @Post(':id/invoice-received')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  markInvoiceReceived(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.assetService.markInvoiceReceived(id, userId);
  }

  @Post(':id/copy')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  copy(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.assetService.copy(id, userId);
  }
}
