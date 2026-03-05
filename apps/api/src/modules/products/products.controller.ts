import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards } from '@nestjs/common';
import { ProductsService } from './products.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { CreateProductPriceDto, UpdateProductPriceDto } from './dto/product-price.dto';
import { TransferProductDto, DispatchTransferDto } from './dto/transfer-product.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('products')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ProductsController {
  constructor(private productsService: ProductsService) {}

  @Get()
  findAll(
    @Query('search') search?: string,
    @Query('branchId') branchId?: string,
    @Query('status') status?: string,
    @Query('category') category?: string,
    @Query('brand') brand?: string,
    @Query('supplierId') supplierId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.productsService.findAll({
      search, branchId, status, category, brand, supplierId,
      page: page ? parseInt(page) : undefined,
      limit: limit ? parseInt(limit) : undefined,
    });
  }

  @Get('stock')
  getStock(
    @Query('search') search?: string,
    @Query('branchId') branchId?: string,
    @Query('status') status?: string,
    @Query('category') category?: string,
    @Query('brand') brand?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.productsService.getStock({
      search, branchId, status, category, brand,
      page: page ? parseInt(page) : undefined,
      limit: limit ? parseInt(limit) : undefined,
    });
  }

  @Get('stock/dashboard')
  getStockDashboard(@Query('branchId') branchId?: string) {
    return this.productsService.getStockDashboard(branchId);
  }

  @Get('brands')
  getBrands() {
    return this.productsService.getBrands();
  }

  @Get('transfers/pending')
  @Roles('OWNER', 'BRANCH_MANAGER')
  getPendingTransfers(@Query('branchId') branchId?: string) {
    return this.productsService.getPendingTransfers(branchId);
  }

  @Get('transfers/history')
  getTransferHistory(
    @Query('branchId') branchId?: string,
    @Query('status') status?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.productsService.getTransferHistory({
      branchId, status, startDate, endDate,
      page: page ? parseInt(page) : undefined,
      limit: limit ? parseInt(limit) : undefined,
    });
  }

  @Get('transfers/:transferId')
  getTransferById(@Param('transferId') transferId: string) {
    return this.productsService.getTransferById(transferId);
  }

  @Get(':id/workflow')
  getWorkflowStatus(@Param('id') id: string) {
    return this.productsService.getWorkflowStatus(id);
  }

  @Get(':id')
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
    return this.productsService.addPrice(id, dto);
  }

  @Patch(':id/prices/:priceId')
  @Roles('OWNER', 'BRANCH_MANAGER')
  updatePrice(
    @Param('id') id: string,
    @Param('priceId') priceId: string,
    @Body() dto: UpdateProductPriceDto,
  ) {
    return this.productsService.updatePrice(id, priceId, dto);
  }

  @Delete(':id/prices/:priceId')
  @Roles('OWNER', 'BRANCH_MANAGER')
  removePrice(@Param('id') id: string, @Param('priceId') priceId: string) {
    return this.productsService.removePrice(id, priceId);
  }

  // === Transfer Endpoints ===

  @Post(':id/transfer')
  @Roles('OWNER', 'BRANCH_MANAGER')
  transfer(
    @Param('id') id: string,
    @Body() dto: TransferProductDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.productsService.transfer(id, dto, user.id);
  }

  @Post('transfers/:transferId/dispatch')
  @Roles('OWNER', 'BRANCH_MANAGER')
  dispatchTransfer(
    @Param('transferId') transferId: string,
    @Body() dto: DispatchTransferDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.productsService.dispatchTransfer(transferId, user.id, dto.trackingNote);
  }

  @Post('transfers/:transferId/confirm')
  @Roles('OWNER', 'BRANCH_MANAGER')
  confirmTransfer(
    @Param('transferId') transferId: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.productsService.confirmTransfer(transferId, user.id);
  }

  @Post('transfers/:transferId/reject')
  @Roles('OWNER', 'BRANCH_MANAGER')
  rejectTransfer(
    @Param('transferId') transferId: string,
    @CurrentUser() user: { id: string },
    @Body('reason') reason?: string,
  ) {
    return this.productsService.rejectTransfer(transferId, user.id, reason);
  }

  @Get('transfers/in-transit')
  @Roles('OWNER', 'BRANCH_MANAGER')
  getInTransitTransfers(@Query('branchId') branchId?: string) {
    return this.productsService.getInTransitTransfers(branchId);
  }
}
