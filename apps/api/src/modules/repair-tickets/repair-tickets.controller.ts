import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
  ParseUUIDPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { BranchGuard } from '../auth/guards/branch.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RepairTicketsService } from './repair-tickets.service';
import { CreateRepairTicketDto } from './dto/create-repair-ticket.dto';
import { UpdateRepairTicketDto } from './dto/update-repair-ticket.dto';
import { ListRepairTicketsDto } from './dto/list-repair-tickets.dto';
import { SendDto } from './dto/send.dto';
import { MarkRepairedDto } from './dto/mark-repaired.dto';
import { SendBackDto } from './dto/send-back.dto';
import { ReturnToCustomerDto } from './dto/return-to-customer.dto';
import { CancelDto } from './dto/cancel.dto';
import { ReplaceDto } from './dto/replace.dto';
import { WarrantyPreviewDto } from './dto/warranty-preview.dto';
import { WarrantyLookupDto } from './dto/warranty-lookup.dto';
import { LookupByImeiDto } from './dto/lookup-by-imei.dto';

@Controller('repair-tickets')
@UseGuards(JwtAuthGuard, RolesGuard, BranchGuard)
export class RepairTicketsController {
  constructor(private readonly svc: RepairTicketsService) {}

  @Post()
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  create(@Body() dto: CreateRepairTicketDto, @Req() req: any) {
    return this.svc.create(dto, req.user);
  }

  @Get()
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  list(@Query() dto: ListRepairTicketsDto, @Req() req: any) {
    return this.svc.findAll(dto, req.user);
  }

  // IMPORTANT: static routes must come before ':id' to avoid Nest treating
  // the route segment as a UUID param.
  @Get('warranty-preview')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  warrantyPreview(@Query() dto: WarrantyPreviewDto, @Req() req: any) {
    return this.svc.warrantyPreview(dto, req.user);
  }

  @Get('warranty-lookup')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES', 'ACCOUNTANT')
  warrantyLookup(@Query() dto: WarrantyLookupDto, @Req() req: any) {
    return this.svc.warrantyLookup(dto, req.user);
  }

  @Get('lookup-by-imei')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
  lookupByImei(@Query() dto: LookupByImeiDto, @Req() req: any) {
    return this.svc.lookupByImei(dto.imei, req.user);
  }

  @Get(':id')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  findOne(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    return this.svc.findOne(id, req.user);
  }

  @Patch(':id')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRepairTicketDto,
    @Req() req: any,
  ) {
    return this.svc.update(id, dto, req.user);
  }

  @Post(':id/send')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  send(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SendDto,
    @Req() req: any,
  ) {
    return this.svc.send(id, dto, req.user);
  }

  @Post(':id/mark-repaired')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  markRepaired(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MarkRepairedDto,
    @Req() req: any,
  ) {
    return this.svc.markRepaired(id, dto, req.user);
  }

  @Post(':id/send-back')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  sendBack(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SendBackDto,
    @Req() req: any,
  ) {
    return this.svc.sendBack(id, dto, req.user);
  }

  @Post(':id/return-to-customer')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  returnToCustomer(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReturnToCustomerDto,
    @Req() req: any,
  ) {
    return this.svc.returnToCustomer(id, dto, req.user);
  }

  @Post(':id/cancel')
  @Roles('OWNER', 'BRANCH_MANAGER')
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelDto,
    @Req() req: any,
  ) {
    return this.svc.cancel(id, dto, req.user);
  }

  @Post(':id/replace')
  @Roles('OWNER', 'BRANCH_MANAGER')
  replace(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReplaceDto,
    @Req() req: any,
  ) {
    return this.svc.replace(id, dto, req.user);
  }

  @Post(':id/recalc-warranty')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  recalcWarranty(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    return this.svc.recalcWarranty(id, req.user);
  }

  @Delete(':id')
  @Roles('OWNER')
  softDelete(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    return this.svc.softDelete(id, req.user);
  }
}
