import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import type { Readable } from 'stream';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ShopPettyCashService, type ShopPettyCashActor } from './shop-petty-cash.service';
import { RecordShopPettyCashDto, SetShopPettyCashLimitDto } from './dto/shop-petty-cash.dto';

const IMAGE_TYPE: Record<string, string> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

/**
 * เงินสดย่อยหน้าร้าน S11-1106 (ข้อ 20.2 · 2026-10-18) — หน้า /shop/petty-cash
 * อ่าน: OWNER / FINANCE_MANAGER / ACCOUNTANT / VIEWER · เติม/คืน: OWNER / FINANCE_MANAGER · ตั้งวงเงิน: OWNER
 * ไม่มี BranchGuard — เงินสดย่อยกองเดียวทั้งร้าน ไม่ผูกสาขา (คำตอบฝ่ายบัญชี 20.2: ไม่ระบุผู้ถือ)
 * รูปหลักฐานไม่บังคับ — ไม่ใช้ ParseFilePipe (fileIsRequired) · service ตรวจชนิด/ขนาด/byte แรกเองเมื่อมีไฟล์
 */
@ApiTags('shop-petty-cash')
@ApiBearerAuth()
@Controller('shop/petty-cash')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ShopPettyCashController {
  constructor(private readonly service: ShopPettyCashService) {}

  @Get('summary')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'VIEWER')
  @ApiOperation({ summary: 'ยอดคงเหลือ S11-1106 · วงเงิน · เติมได้อีก · สรุปเดือนนี้' })
  getSummary() {
    return this.service.getSummary();
  }

  @Get('movements')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'VIEWER')
  @ApiOperation({ summary: 'รายการเคลื่อนไหวของบัญชี S11-1106 ในเดือน (YYYY-MM · ไม่ส่ง = เดือนนี้) พร้อมยอดสะสม' })
  listMovements(@Query('month') month?: string) {
    return this.service.listMovements(month);
  }

  @Post('top-ups')
  @Roles('OWNER', 'FINANCE_MANAGER')
  @UseInterceptors(FileInterceptor('evidence'))
  @ApiOperation({ summary: 'เติมเงินสดย่อยจากธนาคารหน้าร้าน (Dr S11-1106 / Cr ธนาคาร) — ไม่เกินวงเงิน − คงเหลือ · หลักฐานไม่บังคับ' })
  topUp(@CurrentUser() user: ShopPettyCashActor, @Body() dto: RecordShopPettyCashDto, @UploadedFile() evidence?: Express.Multer.File) {
    return this.service.record('TOP_UP', dto, user, evidence);
  }

  @Post('returns')
  @Roles('OWNER', 'FINANCE_MANAGER')
  @UseInterceptors(FileInterceptor('evidence'))
  @ApiOperation({ summary: 'คืนเงินสดย่อยเข้าธนาคารหน้าร้าน (Dr ธนาคาร / Cr S11-1106) — ไม่เกินยอดคงเหลือ' })
  returnToBank(@CurrentUser() user: ShopPettyCashActor, @Body() dto: RecordShopPettyCashDto, @UploadedFile() evidence?: Express.Multer.File) {
    return this.service.record('RETURN', dto, user, evidence);
  }

  @Put('limit')
  @Roles('OWNER')
  @ApiOperation({ summary: 'ตั้งวงเงินเงินสดย่อย (ค่าตั้งค่า shop_petty_cash_limit) — OWNER เท่านั้น' })
  setLimit(@CurrentUser() user: ShopPettyCashActor, @Body() dto: SetShopPettyCashLimitDto) {
    return this.service.setLimit(dto.limit, user);
  }

  @Get('movements/:id/evidence')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'VIEWER')
  @ApiOperation({ summary: 'รูปหลักฐานของรายการเติม/คืน' })
  async getEvidence(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const file: { key: string; stream: Readable } = await this.service.getEvidence(id);
    const extension = file.key.split('.').pop() ?? '';
    res.setHeader('Content-Type', IMAGE_TYPE[extension] ?? 'application/octet-stream');
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('Cache-Control', 'private, max-age=300');
    file.stream.pipe(res);
  }
}
