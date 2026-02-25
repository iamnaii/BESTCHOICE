import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards } from '@nestjs/common';
import { PurchaseOrdersService } from './purchase-orders.service';
import { CreatePODto, UpdatePODto, ReceivePODto } from './dto/create-po.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('purchase-orders')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PurchaseOrdersController {
  constructor(private purchaseOrdersService: PurchaseOrdersService) {}

  @Get()
  findAll(
    @Query('status') status?: string,
    @Query('supplierId') supplierId?: string,
  ) {
    return this.purchaseOrdersService.findAll({ status, supplierId });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.purchaseOrdersService.findOne(id);
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

  @Post(':id/cancel')
  @Roles('OWNER', 'BRANCH_MANAGER')
  cancel(@Param('id') id: string) {
    return this.purchaseOrdersService.cancel(id);
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
}
