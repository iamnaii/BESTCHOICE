import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards } from '@nestjs/common';
import { ProductsService } from './products.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { CreateProductPriceDto, UpdateProductPriceDto } from './dto/product-price.dto';
import { TransferProductDto } from './dto/transfer-product.dto';
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
  ) {
    return this.productsService.findAll({ search, branchId, status, category, brand, supplierId });
  }

  @Get('stock')
  getStock(
    @Query('branchId') branchId?: string,
    @Query('status') status?: string,
    @Query('category') category?: string,
    @Query('brand') brand?: string,
  ) {
    return this.productsService.getStock({ branchId, status, category, brand });
  }

  @Get('brands')
  getBrands() {
    return this.productsService.getBrands();
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

  // === Transfer Endpoint ===

  @Post(':id/transfer')
  @Roles('OWNER', 'BRANCH_MANAGER')
  transfer(
    @Param('id') id: string,
    @Body() dto: TransferProductDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.productsService.transfer(id, dto, user.id);
  }
}
