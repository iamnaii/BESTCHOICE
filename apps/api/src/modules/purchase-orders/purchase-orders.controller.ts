import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards } from '@nestjs/common';
import { PurchaseOrdersService } from './purchase-orders.service';
import { CreatePODto, UpdatePODto, ReceivePODto, GoodsReceivingDto, UpdatePaymentDto, RejectPODto } from './dto/create-po.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('purchase-orders')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PurchaseOrdersController {
  constructor(private purchaseOrdersService: PurchaseOrdersService) {}

  @Get()
  @Roles('OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT')
  findAll(
    @Query('status') status?: string,
    @Query('supplierId') supplierId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.purchaseOrdersService.findAll({
      status,
      supplierId,
      page: page ? parseInt(page) : undefined,
      limit: limit ? parseInt(limit) : undefined,
    });
  }

  @Get('accounts-payable')
  @Roles('OWNER', 'ACCOUNTANT')
  accountsPayable(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const parsedPage = page ? parseInt(page, 10) : undefined;
    const parsedLimit = limit ? Math.min(parseInt(limit, 10), 200) : undefined;
    return this.purchaseOrdersService.getAccountsPayable(
      parsedPage && !isNaN(parsedPage) ? parsedPage : undefined,
      parsedLimit && !isNaN(parsedLimit) ? parsedLimit : undefined,
    );
  }

  // === QC Confirmation (Step 4: สินค้าเข้าคลัง) ===
  // Static routes MUST be before :id parametric routes

  @Get('qc-pending')
  @Roles('OWNER', 'BRANCH_MANAGER')
  getQCPending(
    @Query('branchId') branchId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.purchaseOrdersService.getQCPending({
      branchId,
      page: page ? parseInt(page) : undefined,
      limit: limit ? parseInt(limit) : undefined,
    });
  }

  @Post('qc-confirm')
  @Roles('OWNER', 'BRANCH_MANAGER')
  confirmQC(@Body('productIds') productIds: string[]) {
    return this.purchaseOrdersService.confirmQC(productIds);
  }

  // === Parametric :id routes ===

  @Get(':id')
  @Roles('OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT')
  findOne(@Param('id') id: string) {
    return this.purchaseOrdersService.findOne(id);
  }

  @Get(':id/goods-receivings')
  @Roles('OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT')
  getGoodsReceivings(
    @Param('id') id: string,
    @Query('status') status?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.purchaseOrdersService.getGoodsReceivings(id, {
      status,
      startDate,
      endDate,
      page: page ? parseInt(page) : undefined,
      limit: limit ? parseInt(limit) : undefined,
    });
  }

  @Get(':id/goods-receivings/summary')
  @Roles('OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT')
  getReceivingSummary(
    @Param('id') id: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.purchaseOrdersService.getReceivingSummary(id, { startDate, endDate });
  }

  @Get(':id/goods-receivings/:receivingId')
  @Roles('OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT')
  getGoodsReceivingById(
    @Param('id') id: string,
    @Param('receivingId') receivingId: string,
  ) {
    return this.purchaseOrdersService.getGoodsReceivingById(id, receivingId);
  }

  @Post()
  @Roles('OWNER', 'BRANCH_MANAGER')
  create(
    @Body() dto: CreatePODto,
    @CurrentUser() user: { id: string },
  ) {
    return this.purchaseOrdersService.create(dto, user.id);
  }

  @Patch(':id')
  @Roles('OWNER', 'BRANCH_MANAGER')
  update(@Param('id') id: string, @Body() dto: UpdatePODto) {
    return this.purchaseOrdersService.update(id, dto);
  }

  @Post(':id/approve')
  @Roles('OWNER')
  approve(
    @Param('id') id: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.purchaseOrdersService.approve(id, user.id);
  }

  @Post(':id/reject')
  @Roles('OWNER')
  reject(
    @Param('id') id: string,
    @Body() dto: RejectPODto,
    @CurrentUser() user: { id: string },
  ) {
    return this.purchaseOrdersService.reject(id, user.id, dto.reason);
  }

  @Post(':id/cancel')
  @Roles('OWNER', 'BRANCH_MANAGER')
  cancel(@Param('id') id: string) {
    return this.purchaseOrdersService.cancel(id);
  }

  @Patch(':id/payment')
  @Roles('OWNER', 'BRANCH_MANAGER')
  updatePayment(@Param('id') id: string, @Body() dto: UpdatePaymentDto) {
    return this.purchaseOrdersService.updatePayment(id, dto);
  }

  @Post(':id/receive')
  @Roles('OWNER', 'BRANCH_MANAGER')
  receive(
    @Param('id') id: string,
    @Body() dto: ReceivePODto,
    @CurrentUser() user: { id: string; branchId: string },
  ) {
    return this.purchaseOrdersService.receive(id, dto, user.id, user.branchId);
  }

  @Post(':id/goods-receiving')
  @Roles('OWNER', 'BRANCH_MANAGER')
  goodsReceiving(
    @Param('id') id: string,
    @Body() dto: GoodsReceivingDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.purchaseOrdersService.goodsReceiving(id, dto, user.id);
  }
}
