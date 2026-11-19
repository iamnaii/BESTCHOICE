import { PricingDeviceOrigin } from '@prisma/client';
import { BadRequestException } from '@nestjs/common';
import { Controller, Get, Post, Put, Delete, Param, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { PricingTemplatesService } from './pricing-templates.service';
import { PricingQuoteService, QUOTE_CATEGORIES, type QuoteCategory } from './pricing-quote.service';
import { CreatePricingTemplateDto, UpdatePricingTemplateDto } from './dto/pricing-template.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@ApiTags('Settings')
@ApiBearerAuth('JWT')
@Controller('pricing-templates')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PricingTemplatesController {
  constructor(
    private service: PricingTemplatesService,
    private quoteService: PricingQuoteService,
  ) {}

  @Get()
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  findAll(@Query('brand') brand?: string, @Query('category') category?: string, @Query('deviceOrigin') deviceOrigin?: string) {
    return this.service.findAll({ brand, category, deviceOrigin });
  }

  @Get('lookup')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  lookup(
    @Query('brand') brand: string,
    @Query('model') model: string,
    @Query('storage') storage?: string,
    @Query('category') category?: string,
    @Query('hasWarranty') hasWarranty?: string,
    @Query('deviceOrigin') deviceOrigin?: string,
  ) {
    const origin = deviceOrigin || 'UNSPECIFIED';
    if (!Object.values(PricingDeviceOrigin).includes(origin as PricingDeviceOrigin)) throw new BadRequestException('Invalid device origin');
    const hw = hasWarranty === 'true' ? true : hasWarranty === 'false' ? false : null;
    return this.service.lookup(brand, model, storage || null, category || 'PHONE_NEW', hw, origin as PricingDeviceOrigin);
  }

  /** หน้า "ราคาและเรทผ่อน" — ดาวน์ / ค่างวด / งวด ของทุกรุ่นจากตัวคำนวณกลาง · ไม่มีทุน กำไร ราคาส่ง GFIN (สเปคข้อ 6) */
  @Get('quotes')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  quotes(@Query('category') category?: string, @Query('origin') origin?: string, @Query('q') q?: string) {
    const c = category || 'PHONE_NEW';
    if (!QUOTE_CATEGORIES.includes(c as QuoteCategory)) throw new BadRequestException('ประเภทสินค้าไม่ถูกต้อง');
    const o = origin || 'THAI';
    if (o !== 'THAI' && o !== 'IMPORTED') throw new BadRequestException('เครื่องไทย/เครื่องนอกไม่ถูกต้อง');
    // ?q= ซ้ำ → Express ให้เป็น array (ตัวค้นหาเรียก string method → 500) — รับเฉพาะข้อความเดียว
    if (q !== undefined && typeof q !== 'string') throw new BadRequestException('คำค้นไม่ถูกต้อง');
    return this.quoteService.listQuotes({ category: c as QuoteCategory, origin: o, q: q?.slice(0, 80) });
  }

  @Get(':id')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @Roles('OWNER')
  create(@Body() dto: CreatePricingTemplateDto) {
    return this.service.create(dto);
  }

  @Post('import')
  @Roles('OWNER')
  bulkImport(@Body() body: { items: CreatePricingTemplateDto[]; deactivateIds?: string[] }) {
    if (!body || typeof body !== 'object' || !Array.isArray(body.items)) throw new BadRequestException('รายการนำเข้าต้องเป็นอาร์เรย์ไม่เกิน 100 แถว');
    return this.service.bulkImport(body.items, body.deactivateIds);
  }

  /** สเปค 2026-11-19 ข้อ 3.2 — เติมราคาขาย GFIN ให้เครื่องในสต๊อกที่ช่องว่าง · ?dryRun=true = นับอย่างเดียว */
  @Post('backfill-finance-price')
  @Roles('OWNER')
  backfillFinancePrice(@Query('dryRun') dryRun: string | undefined, @CurrentUser() user: { id: string }) {
    if (dryRun !== undefined && dryRun !== 'true' && dryRun !== 'false') {
      throw new BadRequestException('dryRun ต้องเป็น true หรือ false');
    }
    return this.service.backfillFinancePrice({ dryRun: dryRun === 'true', userId: user?.id ?? null });
  }

  @Put(':id')
  @Roles('OWNER')
  update(@Param('id') id: string, @Body() dto: UpdatePricingTemplateDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @Roles('OWNER')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
