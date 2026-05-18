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
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { BranchGuard } from '../auth/guards/branch.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { QuotesService } from './quotes.service';
import { CreateQuoteDto } from './dto/create-quote.dto';
import { UpdateQuoteDto } from './dto/update-quote.dto';
import { ConvertQuoteDto } from './dto/convert-quote.dto';

type RequestUser = { id: string; role: string; branchId?: string | null };
type AuthRequest = Request & { user?: RequestUser };

@ApiTags('Quotes')
@ApiBearerAuth('JWT')
@Controller('quotes')
@UseGuards(JwtAuthGuard, RolesGuard, BranchGuard)
export class QuotesController {
  constructor(private readonly quotesService: QuotesService) {}

  @Get()
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
  @ApiOperation({ summary: 'ค้นหา / แสดงรายการใบเสนอราคา' })
  findAll(
    @Req() req: AuthRequest,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
    @Query('branchId') branchId?: string,
    @Query('customerId') customerId?: string,
    @Query('search') search?: string,
  ) {
    const user = req.user;
    if (!user) throw new Error('JWT user ไม่ถูกต้อง');
    return this.quotesService.findAll(
      {
        page: page ? Math.max(1, parseInt(page, 10) || 1) : undefined,
        limit: limit ? Math.min(100, parseInt(limit, 10) || 50) : undefined,
        status,
        branchId,
        customerId,
        search,
      },
      user,
    );
  }

  @Get(':id')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
  findOne(@Param('id') id: string, @Req() req: AuthRequest) {
    const user = req.user;
    if (!user) throw new Error('JWT user ไม่ถูกต้อง');
    return this.quotesService.findOne(id, user);
  }

  @Post()
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  @ApiOperation({ summary: 'สร้างใบเสนอราคาใหม่ (DRAFT)' })
  create(@Body() dto: CreateQuoteDto, @Req() req: AuthRequest) {
    const user = req.user;
    if (!user) throw new Error('JWT user ไม่ถูกต้อง');
    return this.quotesService.create(dto, user.id, user);
  }

  @Patch(':id')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  update(@Param('id') id: string, @Body() dto: UpdateQuoteDto, @Req() req: AuthRequest) {
    const user = req.user;
    if (!user) throw new Error('JWT user ไม่ถูกต้อง');
    return this.quotesService.update(id, dto, user);
  }

  @Post(':id/send')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  @ApiOperation({ summary: 'ส่งใบเสนอราคาให้ลูกค้า (DRAFT → SENT)' })
  send(@Param('id') id: string, @Req() req: AuthRequest) {
    const user = req.user;
    if (!user) throw new Error('JWT user ไม่ถูกต้อง');
    return this.quotesService.send(id, user);
  }

  @Post(':id/accept')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  @ApiOperation({ summary: 'ลูกค้ายอมรับใบเสนอราคา (SENT → ACCEPTED)' })
  accept(@Param('id') id: string, @Req() req: AuthRequest) {
    const user = req.user;
    if (!user) throw new Error('JWT user ไม่ถูกต้อง');
    return this.quotesService.accept(id, user);
  }

  @Post(':id/reject')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  @ApiOperation({ summary: 'ลูกค้าปฏิเสธใบเสนอราคา (SENT → REJECTED)' })
  reject(@Param('id') id: string, @Req() req: AuthRequest) {
    const user = req.user;
    if (!user) throw new Error('JWT user ไม่ถูกต้อง');
    return this.quotesService.reject(id, user);
  }

  @Post(':id/convert')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  @ApiOperation({ summary: 'แปลงใบเสนอราคาเป็นการขาย (ACCEPTED → CONVERTED + Sale)' })
  convert(
    @Param('id') id: string,
    @Body() dto: ConvertQuoteDto,
    @Req() req: AuthRequest,
  ) {
    const user = req.user;
    if (!user) throw new Error('JWT user ไม่ถูกต้อง');
    return this.quotesService.convert(id, dto, user.id, user);
  }

  @Get(':id/pdf')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
  @ApiOperation({ summary: 'ดาวน์โหลดใบเสนอราคา PDF' })
  async pdf(@Param('id') id: string, @Req() req: AuthRequest, @Res() res: Response) {
    const user = req.user;
    if (!user) throw new Error('JWT user ไม่ถูกต้อง');
    const buffer = await this.quotesService.generatePdf(id, user);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="quote-${id}.pdf"`);
    res.setHeader('Content-Length', String(buffer.length));
    res.send(buffer);
  }

  @Delete(':id')
  @Roles('OWNER', 'BRANCH_MANAGER')
  @ApiOperation({ summary: 'ลบใบเสนอราคา (DRAFT เท่านั้น)' })
  remove(@Param('id') id: string, @Req() req: AuthRequest) {
    const user = req.user;
    if (!user) throw new Error('JWT user ไม่ถูกต้อง');
    return this.quotesService.remove(id, user);
  }
}
