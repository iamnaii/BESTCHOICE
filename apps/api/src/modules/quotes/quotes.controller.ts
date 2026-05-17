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
import { Roles } from '../auth/decorators/roles.decorator';
import { QuotesService } from './quotes.service';
import { CreateQuoteDto } from './dto/create-quote.dto';
import { UpdateQuoteDto } from './dto/update-quote.dto';
import { ConvertQuoteDto } from './dto/convert-quote.dto';

type AuthRequest = Request & { user?: { id: string; role: string } };

@ApiTags('Quotes')
@ApiBearerAuth('JWT')
@Controller('quotes')
@UseGuards(JwtAuthGuard, RolesGuard)
export class QuotesController {
  constructor(private readonly quotesService: QuotesService) {}

  @Get()
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
  @ApiOperation({ summary: 'ค้นหา / แสดงรายการใบเสนอราคา' })
  findAll(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
    @Query('branchId') branchId?: string,
    @Query('customerId') customerId?: string,
    @Query('search') search?: string,
  ) {
    return this.quotesService.findAll({
      page: page ? Math.max(1, parseInt(page, 10) || 1) : undefined,
      limit: limit ? Math.min(100, parseInt(limit, 10) || 50) : undefined,
      status,
      branchId,
      customerId,
      search,
    });
  }

  @Get(':id')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
  findOne(@Param('id') id: string) {
    return this.quotesService.findOne(id);
  }

  @Post()
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  @ApiOperation({ summary: 'สร้างใบเสนอราคาใหม่ (DRAFT)' })
  create(@Body() dto: CreateQuoteDto, @Req() req: AuthRequest) {
    const userId = req.user?.id;
    if (!userId) throw new Error('JWT user ไม่ถูกต้อง');
    return this.quotesService.create(dto, userId);
  }

  @Patch(':id')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  update(@Param('id') id: string, @Body() dto: UpdateQuoteDto) {
    return this.quotesService.update(id, dto);
  }

  @Post(':id/send')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  @ApiOperation({ summary: 'ส่งใบเสนอราคาให้ลูกค้า (DRAFT → SENT)' })
  send(@Param('id') id: string) {
    return this.quotesService.send(id);
  }

  @Post(':id/accept')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  @ApiOperation({ summary: 'ลูกค้ายอมรับใบเสนอราคา (SENT → ACCEPTED)' })
  accept(@Param('id') id: string) {
    return this.quotesService.accept(id);
  }

  @Post(':id/reject')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  @ApiOperation({ summary: 'ลูกค้าปฏิเสธใบเสนอราคา (SENT → REJECTED)' })
  reject(@Param('id') id: string) {
    return this.quotesService.reject(id);
  }

  @Post(':id/convert')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  @ApiOperation({ summary: 'แปลงใบเสนอราคาเป็นการขาย (ACCEPTED → CONVERTED + Sale)' })
  convert(
    @Param('id') id: string,
    @Body() dto: ConvertQuoteDto,
    @Req() req: AuthRequest,
  ) {
    const userId = req.user?.id;
    if (!userId) throw new Error('JWT user ไม่ถูกต้อง');
    return this.quotesService.convert(id, dto, userId);
  }

  @Get(':id/pdf')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
  @ApiOperation({ summary: 'ดาวน์โหลดใบเสนอราคา PDF' })
  async pdf(@Param('id') id: string, @Res() res: Response) {
    const buffer = await this.quotesService.generatePdf(id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="quote-${id}.pdf"`);
    res.setHeader('Content-Length', String(buffer.length));
    res.send(buffer);
  }

  @Delete(':id')
  @Roles('OWNER', 'BRANCH_MANAGER')
  @ApiOperation({ summary: 'ลบใบเสนอราคา (DRAFT เท่านั้น)' })
  remove(@Param('id') id: string) {
    return this.quotesService.remove(id);
  }
}
