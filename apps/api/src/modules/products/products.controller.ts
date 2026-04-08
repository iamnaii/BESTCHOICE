import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth , ApiOperation} from '@nestjs/swagger';
import { ProductsService } from './products.service';
import { ProductsPricingService } from './products-pricing.service';
import { ProductsStockService } from './products-stock.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { CreateProductPriceDto, UpdateProductPriceDto } from './dto/product-price.dto';
import { TransferProductDto, DispatchTransferDto, BulkTransferDto } from './dto/transfer-product.dto';
import { ReserveProductDto } from './dto/reserve-product.dto';
import { RejectTransferDto } from './dto/reject-transfer.dto';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { BranchGuard } from '../auth/guards/branch.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@ApiTags('Products')
@ApiBearerAuth('JWT')
@Controller('products')
@UseGuards(JwtAuthGuard, RolesGuard, BranchGuard)
export class ProductsController {
  constructor(
    private productsService: ProductsService,
    private productsPricingService: ProductsPricingService,
    private productsStockService: ProductsStockService,
  ) {}

  @Get()
  @Roles('OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT', 'SALES')
  findAll(
    @Query() pagination: PaginationDto,
    @Query('search') search?: string,
    @Query('branchId') branchId?: string,
    @Query('status') status?: string,
    @Query('category') category?: string,
    @Query('brand') brand?: string,
    @Query('supplierId') supplierId?: string,
  ) {
    return this.productsService.findAll({
      search, branchId, status, category, brand, supplierId,
      page: pagination.page,
      limit: pagination.limit,
    });
  }

  @Get('stock')
  @Roles('OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT', 'SALES')
  getStock(
    @Query() pagination: PaginationDto,
    @Query('search') search?: string,
    @Query('branchId') branchId?: string,
    @Query('status') status?: string,
    @Query('category') category?: string,
    @Query('brand') brand?: string,
  ) {
    return this.productsStockService.getStock({
      search, branchId, status, category, brand,
      page: pagination.page,
      limit: pagination.limit,
    });
  }

  @Get('stock/dashboard')
  @Roles('OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT', 'SALES')
  getStockDashboard(@Query('branchId') branchId?: string) {
    return this.productsStockService.getStockDashboard(branchId);
  }

  @Get('brands')
  @Roles('OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT', 'SALES')
  getBrands() {
    return this.productsService.getBrands();
  }

  @Get('warranty/expiring')
  @Roles('OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT', 'SALES')
  getWarrantyExpiring(
    @Query('days') days?: string,
    @Query('branchId') branchId?: string,
  ) {
    return this.productsStockService.getWarrantyExpiring(
      days ? parseInt(days) : 30,
      branchId,
    );
  }

  @Get('supplier-performance')
  @Roles('OWNER', 'BRANCH_MANAGER')
  getSupplierPerformance() {
    return this.productsStockService.getSupplierPerformance();
  }

  // Static transfer routes MUST be before transfers/:transferId

  @Get('transfers/pending')
  @Roles('OWNER', 'BRANCH_MANAGER')
  getPendingTransfers(@Query('branchId') branchId?: string) {
    return this.productsStockService.getPendingTransfers(branchId);
  }

  @Get('transfers/in-transit')
  @Roles('OWNER', 'BRANCH_MANAGER')
  getInTransitTransfers(@Query('branchId') branchId?: string) {
    return this.productsStockService.getInTransitTransfers(branchId);
  }

  @Get('transfers/history')
  @Roles('OWNER', 'BRANCH_MANAGER')
  getTransferHistory(
    @Query() pagination: PaginationDto,
    @Query('branchId') branchId?: string,
    @Query('status') status?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.productsStockService.getTransferHistory({
      branchId, status, startDate, endDate,
      page: pagination.page,
      limit: pagination.limit,
    });
  }

  @Get('transfers/:transferId')
  @Roles('OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT', 'SALES')
  getTransferById(
    @Param('transferId') transferId: string,
    @CurrentUser() user: { role: string; branchId: string | null },
  ) {
    return this.productsStockService.getTransferById(transferId, user);
  }

  @Get(':id/workflow')
  @Roles('OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT', 'SALES')
  getWorkflowStatus(@Param('id') id: string) {
    return this.productsService.getWorkflowStatus(id);
  }

  @Get(':id')
  @Roles('OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT', 'SALES')
  findOne(@Param('id') id: string) {
    return this.productsService.findOne(id);
  }

  @Post()
  @Roles('OWNER', 'BRANCH_MANAGER')
  create(@Body() dto: CreateProductDto) {
    return this.productsService.create(dto);
  }

  @Patch(':id')
  @Roles('OWNER', 'BRANCH_MANAGER')
  update(@Param('id') id: string, @Body() dto: UpdateProductDto) {
    return this.productsService.update(id, dto);
  }

  @Delete(':id')
  @Roles('OWNER')
  remove(@Param('id') id: string) {
    return this.productsService.remove(id);
  }

  // === Price Endpoints ===

  @Post(':id/prices')
  @Roles('OWNER', 'BRANCH_MANAGER')
  addPrice(@Param('id') id: string, @Body() dto: CreateProductPriceDto) {
    return this.productsPricingService.addPrice(id, dto);
  }

  @Patch(':id/prices/:priceId')
  @Roles('OWNER', 'BRANCH_MANAGER')
  updatePrice(
    @Param('id') id: string,
    @Param('priceId') priceId: string,
    @Body() dto: UpdateProductPriceDto,
  ) {
    return this.productsPricingService.updatePrice(id, priceId, dto);
  }

  @Delete(':id/prices/:priceId')
  @Roles('OWNER', 'BRANCH_MANAGER')
  removePrice(@Param('id') id: string, @Param('priceId') priceId: string) {
    return this.productsPricingService.removePrice(id, priceId);
  }

  // === Reservation Endpoints ===

  @Post(':id/reserve')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  reserve(@Param('id') id: string, @Body() dto: ReserveProductDto) {
    return this.productsStockService.reserve(id, dto.reason);
  }

  @Post(':id/unreserve')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  unreserve(@Param('id') id: string) {
    return this.productsStockService.unreserve(id);
  }

  // === Transfer Endpoints ===

  @Post('bulk-transfer')
  @Roles('OWNER', 'BRANCH_MANAGER')
  bulkTransfer(
    @Body() dto: BulkTransferDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.productsStockService.bulkTransfer(dto, user.id);
  }

  @Post(':id/transfer')
  @Roles('OWNER', 'BRANCH_MANAGER')
  transfer(
    @Param('id') id: string,
    @Body() dto: TransferProductDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.productsStockService.transfer(id, dto, user.id);
  }

  @Post('transfers/:transferId/dispatch')
  @Roles('OWNER', 'BRANCH_MANAGER')
  dispatchTransfer(
    @Param('transferId') transferId: string,
    @Body() dto: DispatchTransferDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.productsStockService.dispatchTransfer(transferId, user.id, dto.trackingNote);
  }

  @Post('transfers/:transferId/confirm')
  @Roles('OWNER', 'BRANCH_MANAGER')
  confirmTransfer(
    @Param('transferId') transferId: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.productsStockService.confirmTransfer(transferId, user.id);
  }

  @Post('transfers/:transferId/reject')
  @Roles('OWNER', 'BRANCH_MANAGER')
  rejectTransfer(
    @Param('transferId') transferId: string,
    @CurrentUser() user: { id: string },
    @Body() dto: RejectTransferDto,
  ) {
    return this.productsStockService.rejectTransfer(transferId, user.id, dto.reason);
  }

}
