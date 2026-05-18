import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { BranchGuard } from '../auth/guards/branch.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { BookingsService } from './bookings.service';
import { CreateBookingDto } from './dto/create-booking.dto';
import { UpdateBookingDto } from './dto/update-booking.dto';
import { PayDepositDto } from './dto/pay-deposit.dto';
import { CancelBookingDto } from './dto/cancel-booking.dto';
import { ConvertBookingDto } from './dto/convert-booking.dto';

type RequestUser = { id: string; role: string; branchId?: string | null };
type AuthRequest = Request & { user?: RequestUser };

@ApiTags('Bookings')
@ApiBearerAuth('JWT')
@Controller('bookings')
@UseGuards(JwtAuthGuard, RolesGuard, BranchGuard)
export class BookingsController {
  constructor(private readonly bookingsService: BookingsService) {}

  @Get()
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  @ApiOperation({ summary: 'ค้นหา / แสดงรายการใบจอง' })
  findAll(
    @Req() req: AuthRequest,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
    @Query('branchId') branchId?: string,
    @Query('customerId') customerId?: string,
    @Query('search') search?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const user = req.user;
    if (!user) throw new Error('JWT user ไม่ถูกต้อง');
    return this.bookingsService.findAll(
      {
        page: page ? Math.max(1, parseInt(page, 10) || 1) : undefined,
        limit: limit ? Math.min(100, parseInt(limit, 10) || 50) : undefined,
        status,
        branchId,
        customerId,
        search,
        from,
        to,
      },
      user,
    );
  }

  @Get(':id')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  findOne(@Param('id') id: string, @Req() req: AuthRequest) {
    const user = req.user;
    if (!user) throw new Error('JWT user ไม่ถูกต้อง');
    return this.bookingsService.findOne(id, user);
  }

  @Post()
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  @ApiOperation({ summary: 'สร้างใบจองใหม่ (PENDING_DEPOSIT)' })
  create(@Body() dto: CreateBookingDto, @Req() req: AuthRequest) {
    const user = req.user;
    if (!user) throw new Error('JWT user ไม่ถูกต้อง');
    return this.bookingsService.create(dto, user.id, user);
  }

  @Patch(':id')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  update(@Param('id') id: string, @Body() dto: UpdateBookingDto, @Req() req: AuthRequest) {
    const user = req.user;
    if (!user) throw new Error('JWT user ไม่ถูกต้อง');
    return this.bookingsService.update(id, dto, user);
  }

  @Post(':id/pay-deposit')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  @ApiOperation({ summary: 'บันทึกการรับมัดจำ (PENDING_DEPOSIT → PAID)' })
  payDeposit(
    @Param('id') id: string,
    @Body() dto: PayDepositDto,
    @Req() req: AuthRequest,
  ) {
    const user = req.user;
    if (!user) throw new Error('JWT user ไม่ถูกต้อง');
    return this.bookingsService.payDeposit(id, dto, user);
  }

  @Post(':id/cancel')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  @ApiOperation({ summary: 'ยกเลิกใบจอง (ก่อนหมดอายุ — คืนมัดจำ 100%)' })
  cancel(
    @Param('id') id: string,
    @Body() dto: CancelBookingDto,
    @Req() req: AuthRequest,
  ) {
    const user = req.user;
    if (!user) throw new Error('JWT user ไม่ถูกต้อง');
    return this.bookingsService.cancel(id, dto, user);
  }

  @Post(':id/convert')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  @ApiOperation({
    summary: 'แปลงใบจองเป็นการขาย (PAID → CONVERTED + Sale พร้อม downPayment)',
  })
  convert(
    @Param('id') id: string,
    @Body() dto: ConvertBookingDto,
    @Req() req: AuthRequest,
  ) {
    const user = req.user;
    if (!user) throw new Error('JWT user ไม่ถูกต้อง');
    return this.bookingsService.convertToSale(id, dto, user.id, user);
  }

  @Delete(':id')
  @Roles('OWNER', 'BRANCH_MANAGER')
  @ApiOperation({ summary: 'ลบใบจอง (PENDING_DEPOSIT เท่านั้น, soft-delete)' })
  remove(@Param('id') id: string, @Req() req: AuthRequest) {
    const user = req.user;
    if (!user) throw new Error('JWT user ไม่ถูกต้อง');
    return this.bookingsService.remove(id, user);
  }
}
